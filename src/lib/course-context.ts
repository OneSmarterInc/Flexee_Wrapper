import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sections, enrolments } from "@/db/schema";
import { getBook } from "@/lib/content";
import { enrolmentForBook } from "@/lib/enrolment";

/**
 * Spec 14: what the course header says — the book, the class and your role in it.
 *
 * Resolved from whichever the URL gives us: a book id under /[book]/, or a section id under
 * /teach/[section]/. Returns null when there is nothing to show (no sign-in, no enrolment, a book
 * or class that is gone), and the header then renders nothing rather than an error.
 */
export type CourseContext = {
  bookId: string;
  title: string;
  subtitle: string | null;
  className: string;
  term: string | null;
  role: "Student" | "Faculty";
  homeHref: string;
};

async function fromSection(userId: string, sectionId: string): Promise<CourseContext | null> {
  const rows = await db()
    .select({ name: sections.name, term: sections.term, bookId: sections.bookId, role: enrolments.role })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(enrolments.sectionId, sectionId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const book = await getBook(r.bookId).catch(() => null);
  if (!book) return null;
  return {
    bookId: r.bookId,
    title: book.title,
    subtitle: book.subtitle ?? null,
    className: r.name,
    term: r.term ?? null,
    role: r.role === "instructor" ? "Faculty" : "Student",
    homeHref: r.role === "instructor" ? `/teach/${sectionId}` : `/${r.bookId}`,
  };
}

export async function courseContextForSection(userId: string, sectionId: string) {
  return fromSection(userId, sectionId);
}

export async function courseContextForBook(userId: string, bookId: string): Promise<CourseContext | null> {
  const enr = await enrolmentForBook(userId, bookId);
  if (!enr) return null;
  const ctx = await fromSection(userId, enr.sectionId);
  // under /[book]/ the reader is reading the book, so home is the book even for faculty
  return ctx ? { ...ctx, homeHref: `/${bookId}` } : null;
}
