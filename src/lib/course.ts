import "server-only";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { announcements, sectionSyllabus, scheduleItems, sections, enrolments } from "@/db/schema";

// --- announcements ---
export async function listAnnouncements(sectionId: string) {
  return db().select().from(announcements).where(eq(announcements.sectionId, sectionId)).orderBy(desc(announcements.createdAt));
}
export async function addAnnouncement(sectionId: string, title: string, body: string) {
  await db().insert(announcements).values({ sectionId, title, body });
}
export async function deleteAnnouncement(sectionId: string, id: string) {
  await db().delete(announcements).where(and(eq(announcements.id, id), eq(announcements.sectionId, sectionId)));
}

// --- syllabus ---
export async function getSyllabus(sectionId: string) {
  return (await db().select().from(sectionSyllabus).where(eq(sectionSyllabus.sectionId, sectionId)).limit(1))[0] ?? null;
}
export async function setSyllabus(sectionId: string, content: string) {
  await db().insert(sectionSyllabus).values({ sectionId, content, updatedAt: new Date() })
    .onConflictDoUpdate({ target: sectionSyllabus.sectionId, set: { content, updatedAt: new Date() } });
}

// --- schedule ---
export async function listSchedule(sectionId: string) {
  return db().select().from(scheduleItems).where(eq(scheduleItems.sectionId, sectionId)).orderBy(asc(scheduleItems.dueAt));
}
export async function upcoming(sectionId: string, limit = 5) {
  const rows = await db().select().from(scheduleItems)
    .where(and(eq(scheduleItems.sectionId, sectionId), gte(scheduleItems.dueAt, new Date())))
    .orderBy(asc(scheduleItems.dueAt)).limit(limit);
  return rows;
}
export async function addScheduleItem(sectionId: string, v: { title: string; dueAt: Date | null; kind: string | null; note: string | null }) {
  await db().insert(scheduleItems).values({ sectionId, ...v });
}
export async function deleteScheduleItem(sectionId: string, id: string) {
  await db().delete(scheduleItems).where(and(eq(scheduleItems.id, id), eq(scheduleItems.sectionId, sectionId)));
}

// --- dashboard: the sections a person teaches, grouped by term ---
export async function teachingByTerm(userId: string) {
  const rows = await db()
    .select({ id: sections.id, name: sections.name, bookId: sections.bookId, joinCode: sections.joinCode, term: sections.term })
    .from(enrolments).innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(enrolments.role, "instructor")));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.term || "No term"; const g = groups.get(k) ?? []; g.push(r); groups.set(k, g); }
  // most recent-looking term first: put "No term" last, otherwise reverse-alpha (2027 before 2026)
  return [...groups.entries()].sort((a, b) => (a[0] === "No term" ? 1 : b[0] === "No term" ? -1 : b[0].localeCompare(a[0])))
    .map(([term, sections]) => ({ term, sections }));
}
