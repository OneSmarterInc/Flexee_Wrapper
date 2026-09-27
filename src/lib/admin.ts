import "server-only";
import { and, eq, sql, count } from "drizzle-orm";
import { db } from "@/db";
import { users, identities, sections, enrolments, rosterInvites } from "@/db/schema";

// Admins run the institution: they create classes and add faculty and students to any class.
// Being an admin does not make someone a teacher; a class's instructors are its enrolments with
// role 'instructor'.

export async function isAdmin(userId: string | null | undefined) {
  if (!userId) return false;
  const r = await db().select({ role: users.systemRole }).from(users).where(eq(users.id, userId)).limit(1);
  return r[0]?.role === "admin";
}

/** Make an existing account an admin, by the email it signs in with. Returns false if no such account. */
export async function setAdminByEmail(email: string, admin = true) {
  const e = email.toLowerCase().trim();
  const r = await db().select({ userId: identities.userId }).from(identities)
    .where(and(eq(identities.provider, "password"), eq(identities.subject, e))).limit(1);
  if (!r[0]) return false;
  await db().update(users).set({ systemRole: admin ? "admin" : "user" }).where(eq(users.id, r[0].userId));
  return true;
}

/** Every class, newest term first, with its instructors' names and head counts. */
export async function allClasses() {
  const secs = await db().select().from(sections);
  const counts = await db()
    .select({ sectionId: enrolments.sectionId, role: enrolments.role, n: count() })
    .from(enrolments).groupBy(enrolments.sectionId, enrolments.role);
  const invites = await db()
    .select({ sectionId: rosterInvites.sectionId, n: count() })
    .from(rosterInvites).groupBy(rosterInvites.sectionId);
  const faculty = await db()
    .select({ sectionId: enrolments.sectionId, name: users.displayName })
    .from(enrolments).innerJoin(users, eq(users.id, enrolments.userId))
    .where(eq(enrolments.role, "instructor"));
  const byRole = (id: string, role: string) => Number(counts.find((c) => c.sectionId === id && c.role === role)?.n ?? 0);
  return secs.map((s) => ({
    id: s.id, name: s.name, term: s.term ?? "No term", bookId: s.bookId, joinCode: s.joinCode,
    bookPublished: !!s.bookPublishedAt,
    instructors: faculty.filter((f) => f.sectionId === s.id).map((f) => f.name),
    students: byRole(s.id, "student"),
    pendingInvites: Number(invites.find((i) => i.sectionId === s.id)?.n ?? 0),
  })).sort((a, b) => (b.term.localeCompare(a.term)) || a.name.localeCompare(b.name));
}

export async function classById(sectionId: string) {
  return (await db().select().from(sections).where(eq(sections.id, sectionId)).limit(1))[0] ?? null;
}

export async function removeInvite(sectionId: string, inviteId: string) {
  await db().delete(rosterInvites).where(and(eq(rosterInvites.id, inviteId), eq(rosterInvites.sectionId, sectionId)));
}

/** Parse pasted or uploaded people: one per line, "email" or "email, name" (a header row is skipped). */
export function parsePeople(text: string): { email: string; name?: string }[] {
  const out: { email: string; name?: string }[] = []; const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const [a, ...rest] = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ""));
    const email = (a || "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) continue; // skips headers and junk
    seen.add(email);
    out.push({ email, name: rest.join(" ").trim() || undefined });
  }
  return out;
}
