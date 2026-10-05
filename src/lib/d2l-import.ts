import "server-only";
import { and, eq, inArray, not, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import type { DbOrTx } from "@/db";
import { users, identities, enrolments } from "@/db/schema";
import { enrolAs } from "@/lib/roster";
import { canManageClass } from "@/lib/publish";
import { sendSetPasswordInvite } from "@/lib/recovery";
import { DEFAULT_EMAIL_DOMAIN, type ParsedRow, type ClassList } from "@/lib/d2l";

/**
 * Importing a D2L class list (Spec 17 §2 and §5, Spec 18 §1 and §3).
 *
 * The file is never stored and never reaches here: the browser reads it and sends the text, which
 * is parsed in memory and dropped. The preview writes nothing at all — it only counts what a
 * commit would do — and a commit creates accounts with no usable password, so nobody can sign in
 * as a student who has not chosen their own.
 *
 * **A person is found by D2L username first, then by the derived email** (Spec 18). The other way
 * round silently created a second account for every student whose address had changed: the
 * rehearsal import under a test domain left real students holding `@rehearsal.invalid` addresses,
 * and the real import then found nobody by email and made each of them a twin. Nothing threw, and
 * the grade export ended up carrying one Username key twice — so D2L would have taken one row and
 * discarded the other student's marks.
 */

export const emailDomain = () => process.env.D2L_EMAIL_DOMAIN?.trim() || DEFAULT_EMAIL_DOMAIN;

/** The class's faculty and admins, by the same check that guards the class's book. */
export const canImport = canManageClass;

export type RowPlan = ParsedRow & {
  /** What a commit would do with this row. */
  plan: "create" | "enrol existing" | "already in class";
  /** How the existing account was found, when one was. */
  matchedBy?: "username" | "email";
  /** The address on file, when it is not the one this file derives. */
  emailOnFile?: string;
  /** True when the matched account already has a password, so it needs no invitation. */
  hasPassword?: boolean;
  /** Something faculty should see about this row before confirming. */
  warning?: string;
  /** Spec 19: this person was withdrawn from the class, and an import does not undo that. */
  withdrawn?: boolean;
};

export type Preview = {
  rows: RowPlan[];
  skipped: { line: number; name: string; role: string }[]; // another role, listed with it
  problems: ClassList["problems"];
  counts: {
    willCreate: number; haveAccounts: number; alreadyInClass: number;
    skipped: number; problems: number; demo: number; withdrawn: number; willEmail: number;
  };
  /** Students on the class who are not in this file. Listed, never removed. */
  missing: { name: string; email: string | null }[];
  domain: string;
};

type Match = { userId: string; email: string | null; hasPassword: boolean };

/** Everyone this file might be about, found both ways in one pass. */
async function candidates(list: ClassList, x: DbOrTx = db()) {
  const emails = [...new Set(list.students.map((r) => r.email).filter(Boolean))];
  const names = [...new Set(list.students.map((r) => r.userName).filter(Boolean))];
  const match = [
    ...(names.length ? [inArray(users.d2lUsername, names)] : []),
    ...(emails.length ? [inArray(identities.subject, emails)] : []),
  ];
  const rows = match.length
    ? await x.select({ userId: users.id, d2l: users.d2lUsername, email: identities.subject, hash: identities.passwordHash })
        .from(users)
        .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
        .where(or(...match))
    : [];
  const byUsername = new Map<string, Match>();
  const byEmail = new Map<string, Match>();
  for (const r of rows) {
    const m: Match = { userId: r.userId, email: r.email, hasPassword: r.hash != null };
    if (r.d2l) byUsername.set(r.d2l, m);
    if (r.email) byEmail.set(r.email, m);
  }
  return { byUsername, byEmail };
}

/**
 * Decide what each row means, without writing anything. The preview and the commit both go
 * through this, so what faculty are shown is what happens.
 */
function planRows(list: ClassList, found: Awaited<ReturnType<typeof candidates>>, enrolled: Set<string>,
                  withdrawn: Set<string> = new Set()) {
  const rows: RowPlan[] = [];
  const problems = [...list.problems];
  for (const r of list.students) {
    const byU = found.byUsername.get(r.userName);
    const byE = found.byEmail.get(r.email);
    // Two different accounts, one holding the username and the other the derived address. There is
    // no answer here that is not a guess, so it is a problem row and nothing is written for it.
    if (byU && byE && byU.userId !== byE.userId) {
      problems.push({
        line: r.line, reason: "two accounts match this row",
        detail: "one holds this D2L username, another holds the derived email — merge them first",
      });
      continue;
    }
    const m = byU ?? byE;
    const plan: RowPlan["plan"] = !m ? "create" : enrolled.has(m.userId) ? "already in class" : "enrol existing";
    const emailOnFile = m && m.email && m.email !== r.email ? m.email : undefined;
    const owner = found.byUsername.get(r.userName);
    const clash = owner && (!m || owner.userId !== m.userId)
      ? "another account already uses this D2L username, so it will not be stored on this one"
      : undefined;
    rows.push({
      ...r, plan,
      ...(m && withdrawn.has(m.userId) ? { withdrawn: true } : {}),
      ...(m ? { matchedBy: byU ? "username" as const : "email" as const, hasPassword: m.hasPassword } : {}),
      ...(emailOnFile ? { emailOnFile } : {}),
      ...(clash ? { warning: clash } : {}),
    });
  }
  return { rows, problems };
}

/**
 * Who a commit would email. A demo account never is, however faculty confirm; an account whose
 * address on file differs from the derived one is not either, because the derived address may
 * belong to nobody and the one on file is not ours to guess at; and an account that already has a
 * password needs no invitation.
 */
export const wouldEmail = (r: RowPlan) => !r.demo && !r.emailOnFile && !r.hasPassword && !r.withdrawn;

/** Nothing is written here. */
export async function previewImport(sectionId: string, list: ClassList): Promise<Preview> {
  const found = await candidates(list);
  const enrolRows = await db().select({ userId: enrolments.userId, withdrawnAt: enrolments.withdrawnAt })
    .from(enrolments).where(eq(enrolments.sectionId, sectionId));
  const enrolled = new Set(enrolRows.map((e) => e.userId));
  const withdrawn = new Set(enrolRows.filter((e) => e.withdrawnAt != null).map((e) => e.userId));
  const { rows, problems } = planRows(list, found, enrolled, withdrawn);

  const inFile = new Set(list.students.map((r) => r.email));
  const roster = await db().select({ name: users.displayName, email: identities.subject })
    .from(enrolments)
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));
  const missing = roster.filter((s) => !s.email || !inFile.has(s.email)).map((s) => ({ name: s.name, email: s.email }));

  return {
    rows,
    skipped: list.others.map((r) => ({ line: r.line, name: r.name, role: r.role || "(blank)" })),
    problems,
    counts: {
      willCreate: rows.filter((r) => r.plan === "create").length,
      haveAccounts: rows.filter((r) => r.plan !== "create").length,
      alreadyInClass: rows.filter((r) => r.plan === "already in class").length,
      skipped: list.others.length,
      problems: problems.length,
      demo: rows.filter((r) => r.demo).length,
      withdrawn: rows.filter((r) => r.withdrawn).length,
      willEmail: rows.filter(wouldEmail).length,
    },
    missing,
    domain: emailDomain(),
  };
}

export type CommitResult = {
  created: number;
  enrolled: number;
  alreadyInClass: number;
  demo: number;
  invited: number;
  notSent: { email: string; reason: string }[];
  skippedUsernames: number;
  emailDiffers: number;
  /** Rows the import left withdrawn (decision 3). Restoring is a deliberate act. */
  withdrawn: number;
  problems: ClassList["problems"];
};

/**
 * Create the accounts and enrol them, **all or nothing**: every row is written inside one
 * transaction, so a failure part way through leaves the class exactly as it was rather than half
 * a roster. The invitations are sent afterwards, outside it — an email that fails must not undo
 * accounts that were created correctly.
 *
 * An existing account keeps its password and its address untouched, which is what makes a
 * re-import safe: late students are added, nobody is duplicated, and nobody is locked out of an
 * account they already use.
 */
export async function commitImport(
  sectionId: string, list: ClassList,
  opts: { sendNow: boolean; baseUrl: string },
): Promise<CommitResult> {
  const out: CommitResult = {
    created: 0, enrolled: 0, alreadyInClass: 0, demo: 0, invited: 0,
    notSent: [], skippedUsernames: 0, emailDiffers: 0, withdrawn: 0, problems: [],
  };
  const invite: { userId: string; email: string }[] = [];

  await db().transaction(async (tx) => {
    const found = await candidates(list, tx);
    const enrolRows = await tx.select({ userId: enrolments.userId, withdrawnAt: enrolments.withdrawnAt })
      .from(enrolments).where(eq(enrolments.sectionId, sectionId));
    const enrolled = new Set(enrolRows.map((e) => e.userId));
    // Spec 19 decision 3: a re-import leaves a withdrawal standing and reports it.
    const withdrawn = new Set(enrolRows.filter((e) => e.withdrawnAt != null).map((e) => e.userId));
    const { rows, problems } = planRows(list, found, enrolled, withdrawn);
    out.problems = problems;

    for (const r of rows) {
      const m = r.matchedBy === "username" ? found.byUsername.get(r.userName) : found.byEmail.get(r.email);
      if (r.demo) out.demo++;
      if (r.emailOnFile) out.emailDiffers++;
      if (r.withdrawn) out.withdrawn++;
      // The username goes on the account unless another account already holds it — the index is
      // unique, and a clash is a roster problem to report, not a reason to lose the student.
      const owner = found.byUsername.get(r.userName);
      const free = !owner || (m && owner.userId === m.userId);
      if (!free) out.skippedUsernames++;

      if (!m) {
        const [u] = await tx.insert(users)
          .values({ displayName: r.name, ...(free ? { d2lUsername: r.userName } : {}) }).returning();
        // No usable password: `login` refuses a null hash, so the only way in is the invitation.
        await tx.insert(identities).values({ userId: u.id, provider: "password", subject: r.email, passwordHash: null });
        await enrolAs(sectionId, u.id, "student", { tx, isDemo: r.demo });
        const made: Match = { userId: u.id, email: r.email, hasPassword: false };
        if (free) found.byUsername.set(r.userName, made);
        found.byEmail.set(r.email, made);
        out.created++;
        if (wouldEmail(r)) invite.push({ userId: u.id, email: r.email });
        continue;
      }

      if (enrolled.has(m.userId)) {
        out.alreadyInClass++;
        // A role that changed to Demo Student still has to take effect on the existing enrolment.
        if (r.demo) await enrolAs(sectionId, m.userId, "student", { tx, isDemo: true });
      } else {
        await enrolAs(sectionId, m.userId, "student", { tx, isDemo: r.demo });
        enrolled.add(m.userId);
        out.enrolled++;
      }
      if (free) {
        const current = (await tx.select({ name: users.d2lUsername }).from(users).where(eq(users.id, m.userId)).limit(1))[0];
        if (current && current.name !== r.userName) {
          await tx.update(users).set({ d2lUsername: r.userName }).where(eq(users.id, m.userId));
          found.byUsername.set(r.userName, m);
        }
      }
      if (wouldEmail(r)) invite.push({ userId: m.userId, email: r.email });
    }
  });

  if (opts.sendNow) {
    for (const i of invite) {
      const r = await sendSetPasswordInvite(i.userId, sectionId, i.email, opts.baseUrl);
      if (r.ok) out.invited++;
      else out.notSent.push({ email: i.email, reason: r.error ?? "send failed" });
    }
  }
  return out;
}

/**
 * Everyone in the class who has no usable password yet — "Resend to everyone not set up".
 * Demo enrolments are left out: they are never emailed, however they are reached.
 */
export async function notSetUp(sectionId: string) {
  const rows = await db().select({ userId: enrolments.userId, email: identities.subject, hash: identities.passwordHash })
    .from(enrolments)
    .innerJoin(identities, and(eq(identities.userId, enrolments.userId), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student"), not(enrolments.isDemo),
               isNull(enrolments.withdrawnAt)));   // Spec 19: a withdrawn student waits for nothing
  return rows.filter((r) => r.hash == null && r.email).map((r) => ({ userId: r.userId, email: r.email }));
}

/** Which of a class's students are demo accounts, for the screens that label them. */
export async function demoUserIds(sectionId: string) {
  const rows = await db().select({ userId: enrolments.userId }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.isDemo, true)));
  return new Set(rows.map((r) => r.userId));
}
