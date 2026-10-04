import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users, identities, enrolments } from "@/db/schema";
import { enrolAs } from "@/lib/roster";
import { canManageClass } from "@/lib/publish";
import { sendSetPasswordInvite } from "@/lib/recovery";
import { DEFAULT_EMAIL_DOMAIN, type ParsedRow, type ClassList } from "@/lib/d2l";

/**
 * Importing a D2L class list (Spec 17 §2 and §5).
 *
 * The file is never stored and never reaches here: the browser parses it and sends the rows it
 * derived. The preview writes nothing at all — it only counts what a commit would do — and a
 * commit creates accounts with no usable password, so nobody can sign in as a student who has not
 * chosen their own.
 */

export const emailDomain = () => process.env.D2L_EMAIL_DOMAIN?.trim() || DEFAULT_EMAIL_DOMAIN;

/** The class's faculty and admins, by the same check that guards the class's book. */
export const canImport = canManageClass;

export type RowPlan = ParsedRow & {
  /** What a commit would do with this row. */
  plan: "create" | "enrol existing" | "already in class";
  /** Set when the row cannot carry its D2L username because another account holds it. */
  warning?: string;
};

export type Preview = {
  rows: RowPlan[];
  skipped: { line: number; name: string; role: string }[]; // another role, listed with it
  problems: ClassList["problems"];
  counts: { willCreate: number; haveAccounts: number; alreadyInClass: number; skipped: number; problems: number };
  /** Students on the class who are not in this file. Listed, never removed. */
  missing: { name: string; email: string | null }[];
  domain: string;
};

async function lookup(emails: string[]) {
  if (!emails.length) return new Map<string, { userId: string; hasPassword: boolean }>();
  const rows = await db().select({ email: identities.subject, userId: identities.userId, hash: identities.passwordHash })
    .from(identities).where(and(eq(identities.provider, "password"), inArray(identities.subject, emails)));
  return new Map(rows.map((r) => [r.email, { userId: r.userId, hasPassword: r.hash != null }]));
}

/** Which D2L usernames are already spoken for, and by whom. */
async function usernameOwners(names: string[]) {
  if (!names.length) return new Map<string, string>();
  const rows = await db().select({ userId: users.id, name: users.d2lUsername })
    .from(users).where(inArray(users.d2lUsername, names));
  return new Map(rows.filter((r) => r.name).map((r) => [r.name as string, r.userId]));
}

/** Nothing is written here. */
export async function previewImport(sectionId: string, list: ClassList): Promise<Preview> {
  const students = list.students;
  const emails = students.map((r) => r.email);
  const known = await lookup(emails);
  const owners = await usernameOwners(students.map((r) => r.userName));
  const enrolled = new Set((await db().select({ userId: enrolments.userId }).from(enrolments)
    .where(eq(enrolments.sectionId, sectionId))).map((e) => e.userId));

  const rows: RowPlan[] = students.map((r) => {
    const k = known.get(r.email);
    const plan: RowPlan["plan"] = !k ? "create" : enrolled.has(k.userId) ? "already in class" : "enrol existing";
    const owner = owners.get(r.userName);
    const warning = owner && (!k || owner !== k.userId)
      ? "another account already uses this D2L username, so it will not be stored on this one"
      : undefined;
    return { ...r, plan, ...(warning ? { warning } : {}) };
  });

  const inFile = new Set(emails);
  const roster = await db().select({ name: users.displayName, email: identities.subject, userId: users.id })
    .from(enrolments)
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));
  const missing = roster.filter((s) => !s.email || !inFile.has(s.email)).map((s) => ({ name: s.name, email: s.email }));

  return {
    rows,
    skipped: list.others.map((r) => ({ line: r.line, name: r.name, role: r.role || "(blank)" })),
    problems: list.problems,
    counts: {
      willCreate: rows.filter((r) => r.plan === "create").length,
      haveAccounts: rows.filter((r) => r.plan !== "create").length,
      alreadyInClass: rows.filter((r) => r.plan === "already in class").length,
      skipped: list.others.length,
      problems: list.problems.length,
    },
    missing,
    domain: emailDomain(),
  };
}

export type CommitResult = {
  created: number;
  enrolled: number;
  alreadyInClass: number;
  invited: number;
  notSent: { email: string; reason: string }[];
  skippedUsernames: number;
};

/**
 * Create the accounts and enrol them. An existing account keeps its password untouched, which is
 * what makes a re-import safe: late students are added, nobody is duplicated, and nobody is
 * locked out of an account they already use.
 */
export async function commitImport(
  sectionId: string, list: ClassList,
  opts: { sendNow: boolean; baseUrl: string },
): Promise<CommitResult> {
  const students = list.students;
  const known = await lookup(students.map((r) => r.email));
  const owners = await usernameOwners(students.map((r) => r.userName));
  const enrolled = new Set((await db().select({ userId: enrolments.userId }).from(enrolments)
    .where(eq(enrolments.sectionId, sectionId))).map((e) => e.userId));

  const out: CommitResult = { created: 0, enrolled: 0, alreadyInClass: 0, invited: 0, notSent: [], skippedUsernames: 0 };
  const invite: { userId: string; email: string }[] = [];

  for (const r of students) {
    const k = known.get(r.email);
    // The username goes on the account unless another account already holds it — the index is
    // unique, and a clash is a roster problem to report, not a reason to lose the student.
    const owner = owners.get(r.userName);
    const free = !owner || (k && owner === k.userId);
    if (!free) out.skippedUsernames++;

    if (!k) {
      const [u] = await db().insert(users)
        .values({ displayName: r.name, ...(free ? { d2lUsername: r.userName } : {}) }).returning();
      // No usable password: `login` refuses a null hash, so the only way in is the invitation.
      await db().insert(identities).values({ userId: u.id, provider: "password", subject: r.email, passwordHash: null });
      await enrolAs(sectionId, u.id, "student");
      owners.set(r.userName, u.id);
      known.set(r.email, { userId: u.id, hasPassword: false });
      out.created++;
      invite.push({ userId: u.id, email: r.email });
      continue;
    }

    if (enrolled.has(k.userId)) out.alreadyInClass++;
    else { await enrolAs(sectionId, k.userId, "student"); enrolled.add(k.userId); out.enrolled++; }
    if (free) {
      const current = (await db().select({ name: users.d2lUsername }).from(users).where(eq(users.id, k.userId)).limit(1))[0];
      if (current && current.name !== r.userName) {
        await db().update(users).set({ d2lUsername: r.userName }).where(eq(users.id, k.userId));
        owners.set(r.userName, k.userId);
      }
    }
    // An account that never set a password still needs the link; one that has a password does not.
    if (!k.hasPassword) invite.push({ userId: k.userId, email: r.email });
  }

  if (opts.sendNow) {
    for (const i of invite) {
      const r = await sendSetPasswordInvite(i.userId, sectionId, i.email, opts.baseUrl);
      if (r.ok) out.invited++;
      else out.notSent.push({ email: i.email, reason: r.error ?? "send failed" });
    }
  }
  return out;
}

/** Everyone in the class who has no usable password yet — "Resend to everyone not set up". */
export async function notSetUp(sectionId: string) {
  const rows = await db().select({ userId: enrolments.userId, email: identities.subject, hash: identities.passwordHash })
    .from(enrolments)
    .innerJoin(identities, and(eq(identities.userId, enrolments.userId), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));
  return rows.filter((r) => r.hash == null && r.email).map((r) => ({ userId: r.userId, email: r.email }));
}
