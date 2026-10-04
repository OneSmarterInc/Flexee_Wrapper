import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { enrolments, sections, bookmarks } from "@/db/schema";

// The enrolment through which this user may open this book, or null if they may not.
// Faculty can always open their class's book (to prepare it); a student only once the class's
// faculty have published it. Every book page goes through here.
export async function enrolmentForBook(userId: string, bookId: string) {
  const rows = await db()
    .select({ id: enrolments.id, role: enrolments.role, sectionId: sections.id, publishedAt: sections.bookPublishedAt })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(sections.bookId, bookId)));
  const pick = rows.find((r) => r.role === "instructor") ?? rows.find((r) => r.role !== "instructor" && r.publishedAt);
  return pick ? { id: pick.id, role: pick.role, sectionId: pick.sectionId } : null;
}

export async function userEnrolments(userId: string) {
  return db()
    .select({ enrolmentId: enrolments.id, bookId: sections.bookId, sectionName: sections.name })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(eq(enrolments.userId, userId));
}

/** The user's classes, for their home page: what the class is, their role, and whether its book is open. */
export async function userClasses(userId: string) {
  const rows = await db()
    .select({ sectionId: sections.id, name: sections.name, term: sections.term, bookId: sections.bookId,
              role: enrolments.role, publishedAt: sections.bookPublishedAt })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(eq(enrolments.userId, userId));
  return rows.map((r) => ({ ...r, published: !!r.publishedAt, canOpen: r.role === "instructor" || !!r.publishedAt }))
    .sort((a, b) => (b.term ?? "").localeCompare(a.term ?? "") || a.name.localeCompare(b.name));
}

/**
 * One class this person is a student in, or null. It is what a set-your-password invitation names
 * when it is not being sent from a class's own page — a student imported into one class should
 * see that class in the email rather than nothing.
 */
export async function firstStudentSection(userId: string) {
  const r = await db().select({ sectionId: enrolments.sectionId }).from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.role, "student"))).limit(1);
  return r[0]?.sectionId ?? null;
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
