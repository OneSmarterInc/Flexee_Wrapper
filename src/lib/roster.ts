import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbOrTx } from "@/db";
import { sections, enrolments, users, identities, rosterInvites } from "@/db/schema";
import { pinSectionToLatest } from "@/lib/versions";
import { applyGradebookStarter } from "@/lib/gradebook";

function code() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export type ClassRole = "student" | "instructor";

// Create a class (section) for one book. `teach` enrols the creator as its instructor; an admin
// setting up a class for someone else leaves it off and adds faculty afterwards.
export async function createSection(userId: string, bookId: string, name: string, term?: string, opts: { teach?: boolean } = {}) {
  const teach = opts.teach ?? true;
  const [sec] = await db().insert(sections).values({
    bookId, name, term: term ?? null, joinCode: code(), createdBy: userId,
    bookPublishedAt: null, // a new class's book stays hidden from students until its faculty publish it
  }).returning();
  if (teach) await db().insert(enrolments).values({ sectionId: sec.id, userId, role: "instructor" }).onConflictDoNothing();
  await pinSectionToLatest(sec.id, bookId); // snapshot the reading set at adoption
  await applyGradebookStarter(sec.id, bookId); // seed the editable starter gradebook
  return sec;
}

// Sections this user teaches (has an instructor enrolment in).
export async function teachingSections(userId: string) {
  return db()
    .select({ id: sections.id, name: sections.name, bookId: sections.bookId, joinCode: sections.joinCode, term: sections.term })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(enrolments.role, "instructor")));
}

// Return the section only if this user is one of its instructors (access guard).
export async function ownedSection(userId: string, sectionId: string) {
  const rows = await db()
    .select({ id: sections.id, name: sections.name, bookId: sections.bookId, joinCode: sections.joinCode })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(enrolments.sectionId, sectionId), eq(enrolments.role, "instructor")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Spec 23 decision 7: who may grade a class — its faculty, or any administrator.
 *
 * `ownedSection` is faculty-of-this-class only, and the places that also admit an admin were each
 * doing that check inline. One function, so a new page cannot forget half of it.
 */
export async function gradableSection(userId: string, sectionId: string) {
  const mine = await ownedSection(userId, sectionId);
  if (mine) return mine;
  const { isAdmin } = await import("@/lib/admin");
  if (!(await isAdmin(userId))) return null;
  const rows = await db()
    .select({ id: sections.id, name: sections.name, bookId: sections.bookId, joinCode: sections.joinCode })
    .from(sections).where(eq(sections.id, sectionId)).limit(1);
  return rows[0] ?? null;
}

export async function canGradeSection(userId: string, sectionId: string) {
  return (await gradableSection(userId, sectionId)) !== null;
}

export async function sectionRoster(sectionId: string) {
  return db()
    .select({
      enrolmentId: enrolments.id, role: enrolments.role, userId: enrolments.userId,
      name: users.displayName, email: identities.subject,
      d2lUsername: users.d2lUsername,
      // Spec 19: the class list keeps withdrawn rows and hides them behind a toggle, so the
      // roster reports the state rather than filtering it.
      withdrawnAt: enrolments.withdrawnAt,
      isDemo: enrolments.isDemo,
    })
    .from(enrolments)
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(eq(enrolments.sectionId, sectionId));
}

export async function pendingInvites(sectionId: string) {
  const where = eq(rosterInvites.sectionId, sectionId);
  try {
    return await db().select().from(rosterInvites).where(where);
  } catch (error) {
    let current = error;
    for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
      const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (candidate.code === "42703" && typeof candidate.message === "string" && candidate.message.includes("role")) {
        // Migration 0012 has not run yet. Older invites were all for students.
        const rows = await db().select({
          id: rosterInvites.id, sectionId: rosterInvites.sectionId, email: rosterInvites.email,
          name: rosterInvites.name, createdAt: rosterInvites.createdAt,
        }).from(rosterInvites).where(where);
        return rows.map((row) => ({ ...row, role: "student" }));
      }
      current = candidate.cause;
    }
    throw error;
  }
}

export async function regenerateJoinCode(sectionId: string) {
  await db().update(sections).set({ joinCode: code() }).where(eq(sections.id, sectionId));
}

/**
 * Delete one enrolment, and with it, by cascade, that student's bookmarks, submissions and their
 * files, exam attempts and their responses, line-item scores and assistant threads in this class.
 *
 * **Spec 19: not for a screen to call.** It used to sit behind a one-click Remove with no warning;
 * `removeStudents` in src/lib/class-actions.ts is the way in now — it counts what will go, demands
 * a typed phrase when any attempt, submission or score exists, takes the simulation records that
 * hang off the user rather than the enrolment, and writes the actions log. This remains as the
 * primitive that does the deleting, and as what the LTI and clean-up paths use.
 */
export async function removeEnrolment(sectionId: string, enrolmentId: string) {
  await db().delete(enrolments).where(and(eq(enrolments.id, enrolmentId), eq(enrolments.sectionId, sectionId)));
}

export async function enrollByCode(userId: string, joinCode: string) {
  const sec = (await db().select().from(sections).where(eq(sections.joinCode, joinCode.toUpperCase().trim())).limit(1))[0];
  if (!sec) return null;
  // `onConflictDoNothing` already leaves a withdrawal standing (decision 3): joining again with
  // the code does not undo being withdrawn, and the caller reports it.
  await db().insert(enrolments).values({ sectionId: sec.id, userId }).onConflictDoNothing();
  const row = (await db().select({ withdrawnAt: enrolments.withdrawnAt }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, userId))).limit(1))[0];
  return { ...sec, withdrawn: row?.withdrawnAt != null };
}

// Enrol (or re-role) a user in a class. Faculty are never demoted by a later student list:
// adding someone as instructor raises their role; adding an instructor as student leaves them instructor.
// `isDemo` is only ever raised, never lowered: a class list that lists someone as a demo once
// keeps them a demo, and a later list that leaves the flag off does not quietly promote the
// account faculty have been signing into. `tx` lets an import write this inside its transaction.
export async function enrolAs(sectionId: string, userId: string, role: ClassRole,
                              opts: { tx?: DbOrTx; isDemo?: boolean } = {}) {
  const x = opts.tx ?? db();
  // Spec 19 decision 3: `withdrawn_at` is deliberately NOT in the update set. A re-import, a join
  // by code and an LTI roster sync all leave a withdrawal standing — restoring someone is an act a
  // member of staff takes on purpose, not a side effect of a sync running overnight.
  await x.insert(enrolments).values({ sectionId, userId, role, isDemo: opts.isDemo ?? false })
    .onConflictDoUpdate({
      target: [enrolments.sectionId, enrolments.userId],
      set: {
        role: sql`case when ${enrolments.role} = 'instructor' then 'instructor' else ${role} end`,
        ...(opts.isDemo ? { isDemo: true } : {}),
      },
    });
}

// Commit a cleaned roster: existing users become enrolments immediately; unknown
// emails become invites that convert on first sign-in, with the same role.
export async function commitRoster(sectionId: string, rows: { email: string; name?: string }[], role: ClassRole = "student") {
  let enrolled = 0, invited = 0;
  const emails = rows.map((r) => r.email.toLowerCase().trim()).filter(Boolean);
  if (!emails.length) return { enrolled, invited };
  const known = await db()
    .select({ userId: identities.userId, email: identities.subject })
    .from(identities)
    .where(and(eq(identities.provider, "password"), inArray(identities.subject, emails)));
  const knownMap = new Map(known.map((k) => [k.email, k.userId]));
  for (const r of rows) {
    const email = r.email.toLowerCase().trim();
    if (!email) continue;
    const uid = knownMap.get(email);
    if (uid) {
      await enrolAs(sectionId, uid, role);
      enrolled++;
    } else {
      await db().insert(rosterInvites).values({ sectionId, email, name: r.name ?? null, role })
        .onConflictDoUpdate({
          target: [rosterInvites.sectionId, rosterInvites.email],
          set: { role: sql`case when ${rosterInvites.role} = 'instructor' then 'instructor' else ${role} end` },
        });
      invited++;
    }
  }
  return { enrolled, invited };
}

// On sign-in, turn this user's outstanding invites into enrolments.
export async function claimInvites(userId: string, email: string) {
  const e = email.toLowerCase().trim();
  const invites = await db().select().from(rosterInvites).where(eq(rosterInvites.email, e));
  if (!invites.length) return 0;
  for (const inv of invites) {
    await enrolAs(inv.sectionId, userId, (inv.role as ClassRole) || "student");
  }
  await db().delete(rosterInvites).where(inArray(rosterInvites.id, invites.map((i) => i.id)));
  return invites.length;
}
