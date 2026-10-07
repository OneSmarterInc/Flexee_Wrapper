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

// ---------------------------------------------------------------- access release (Spec 27 B1 §1)

export type ReleaseResult = { ok: true; changed: number; skippedWithdrawn: number } | { ok: false; error: string };

/**
 * Release (or un-release) a class's students, which is what lets them launch its simulations.
 *
 * The old platform called this `paid`; nothing here takes payment, and the money is settled on a
 * purchase order somewhere else. It is per student, per class — releasing someone releases every
 * simulation in that class, which is how the old platform had it and what the sims' consoles
 * expect from `accessReleased`.
 *
 * Only student enrolments are touched. Faculty and admins are never gated at launch, so releasing
 * them would store a fact nothing reads, and an instructor appearing in a "waiting" count would be
 * a bug a reader could not explain.
 *
 * "Release all" skips withdrawn students (Addendum B §1). Their own release record stays whatever
 * it was: being withdrawn already removes access, and restoring a student should not silently also
 * hand them a simulation nobody released. Named explicitly, they are still changed — a faculty
 * member who ticks one row means that row.
 */
export async function setAccessRelease(
  actorId: string,
  sectionId: string,
  opts: { released: boolean; enrolmentIds?: string[]; all?: boolean; note?: string },
): Promise<ReleaseResult> {
  const { canManageClass } = await import("@/lib/publish");
  if (!(await canManageClass(actorId, sectionId))) {
    return { ok: false, error: "Only this class's faculty or an administrator can release access." };
  }
  const picked = [...new Set((opts.enrolmentIds ?? []).filter(Boolean))];
  if (!opts.all && picked.length === 0) return { ok: false, error: "Choose at least one student." };

  const rows = await db().select({ id: enrolments.id, withdrawnAt: enrolments.withdrawnAt })
    .from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!opts.all) {
    // A row named that is not a student of this class is a mistake worth reporting rather than
    // skipping: it means the form and the page disagree about who is on the roster.
    const stray = picked.filter((id) => !byId.has(id));
    if (stray.length) return { ok: false, error: "Some of those students are not in this class." };
  }

  const target = opts.all ? rows.filter((r) => r.withdrawnAt == null) : picked.map((id) => byId.get(id)!);
  const skippedWithdrawn = opts.all ? rows.filter((r) => r.withdrawnAt != null).length : 0;
  if (target.length === 0) return { ok: true, changed: 0, skippedWithdrawn };

  const note = (opts.note ?? "").trim().slice(0, 300) || null;
  await db().update(enrolments)
    .set(opts.released
      ? { releasedAt: new Date(), releasedBy: actorId, ...(note ? { releasedNote: note } : {}) }
      // Un-release clears the act, not the paperwork: the note records a purchase order that is
      // still a fact about this enrolment, and the old platform's set_paid left it alone too.
      : { releasedAt: null, releasedBy: null })
    .where(inArray(enrolments.id, target.map((r) => r.id)));
  return { ok: true, changed: target.length, skippedWithdrawn };
}

/** How many of a class's active students are still waiting on a release. For the count on the page. */
export async function waitingOnRelease(sectionId: string) {
  const rows = await db().select({ id: enrolments.id }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student"),
               sql`${enrolments.withdrawnAt} is null`, sql`${enrolments.releasedAt} is null`,
               // The Demo Student is always released at launch, so counting it here would show a
               // class as waiting on somebody who can already play.
               sql`${enrolments.isDemo} = false`));
  return rows.length;
}
