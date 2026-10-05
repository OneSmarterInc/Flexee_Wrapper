import "server-only";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sections } from "@/db/schema";
import { getBook, getEntry } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { courseContextForBook } from "@/lib/course-context";

/**
 * Spec 21 rule 4: the browser's title says where you are before you read anything.
 *
 * The root layout holds the template "%s — Flexee", so everything here returns only the part in
 * front of it. Three shapes, from the spec's decision 6:
 *
 *   a course page   "Gradebook — Spring Section A — Flexee"
 *   a reader page   "Systems Planning — Analysis and Design of Information Systems — Flexee"
 *   anywhere else   "Sign in — Flexee"
 *
 * The class's own name, never a course code: two sections of MIS 3250 are two different classes and
 * a tab saying "MIS 3250" tells a person with eleven tabs open nothing. Where the class cannot be
 * resolved — not signed in, not enrolled, a class that is gone — the page's own name is used alone
 * rather than an error or a placeholder, because a title is not the place to report a problem.
 */

async function classNameFor(sectionId: string) {
  const rows = await db().select({ name: sections.name }).from(sections)
    .where(eq(sections.id, sectionId)).limit(1);
  return rows[0]?.name ?? null;
}

/** A page inside one class, addressed by section id: /teach/[section]/… and /admin/[section]. */
export async function classPageTitle(page: string, params: Promise<{ section: string }>): Promise<Metadata> {
  const { section } = await params;
  const name = await classNameFor(section).catch(() => null);
  return { title: name ? `${page} — ${name}` : page };
}

/** A page inside one class, addressed by book id: the student's /[book]/… pages. */
export async function bookPageTitle(page: string, params: Promise<{ book: string }>): Promise<Metadata> {
  const { book } = await params;
  const user = await currentUser().catch(() => null);
  const ctx = user ? await courseContextForBook(user.id, book).catch(() => null) : null;
  return { title: ctx ? `${page} — ${ctx.className}` : page };
}

/** The reader itself, which is named for what is on the page rather than for the class. */
export async function entryPageTitle(params: Promise<{ book: string; entry: string }>): Promise<Metadata> {
  const { book, entry } = await params;
  const b = await getBook(book).catch(() => null);
  const e = await getEntry(book, entry).catch(() => null);
  const chapter = e?.manifest.title;
  if (!chapter) return { title: b?.title ?? "Reader" };
  return { title: b ? `${chapter} — ${b.title}` : chapter };
}
