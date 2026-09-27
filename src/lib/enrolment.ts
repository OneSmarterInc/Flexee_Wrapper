import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { enrolments, sections, bookmarks } from "@/db/schema";

export async function enrolmentForBook(userId: string, bookId: string) {
  const rows = await db()
    .select({ id: enrolments.id, role: enrolments.role, sectionId: sections.id })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(sections.bookId, bookId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function userEnrolments(userId: string) {
  return db()
    .select({ enrolmentId: enrolments.id, bookId: sections.bookId, sectionName: sections.name })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(eq(enrolments.userId, userId));
}

// Enrol into the (first) section that adopts this book — the cheap "one section,
// everyone in it" posture. Idempotent.
export async function enrolInBook(userId: string, bookId: string) {
  const sec = await db().select().from(sections).where(eq(sections.bookId, bookId)).limit(1);
  if (!sec[0]) throw new Error(`No section adopts book "${bookId}". Run the seed.`);
  await db()
    .insert(enrolments)
    .values({ sectionId: sec[0].id, userId })
    .onConflictDoNothing();
  return enrolmentForBook(userId, bookId);
}

export async function getBookmark(enrolmentId: string, bookId: string) {
  const rows = await db()
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.enrolmentId, enrolmentId), eq(bookmarks.bookId, bookId)))
    .limit(1);
  return rows[0] ?? null;
}
