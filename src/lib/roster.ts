import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
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

export async function sectionRoster(sectionId: string) {
  return db()
    .select({
      enrolmentId: enrolments.id, role: enrolments.role,
      name: users.displayName, email: identities.subject,
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

export async function removeEnrolment(sectionId: string, enrolmentId: string) {
  await db().delete(enrolments).where(and(eq(enrolments.id, enrolmentId), eq(enrolments.sectionId, sectionId)));
}

export async function enrollByCode(userId: string, joinCode: string) {
  const sec = (await db().select().from(sections).where(eq(sections.joinCode, joinCode.toUpperCase().trim())).limit(1))[0];
  if (!sec) return null;
  await db().insert(enrolments).values({ sectionId: sec.id, userId }).onConflictDoNothing();
  return sec;
}

// Enrol (or re-role) a user in a class. Faculty are never demoted by a later student list:
// adding someone as instructor raises their role; adding an instructor as student leaves them instructor.
async function enrolAs(sectionId: string, userId: string, role: ClassRole) {
  await db().insert(enrolments).values({ sectionId, userId, role })
    .onConflictDoUpdate({
      target: [enrolments.sectionId, enrolments.userId],
      set: { role: sql`case when ${enrolments.role} = 'instructor' then 'instructor' else ${role} end` },
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
