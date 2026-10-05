import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { retiredBooks, sections, users } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { listBooks, type BookManifest } from "@/lib/content";

/**
 * Spec 22 §1: retire a book. Soft, reversible, admin-only.
 *
 * A retired book disappears from the pickers — the class-creation form, the upload form, the LTI
 * "add this book" list, and the panel that changes a class's book. It does not disappear from
 * anywhere that is naming a book a class already uses: `listBooks()` is unchanged and still finds
 * it, so a class on a retired book shows its title rather than a raw id.
 *
 * Nothing is deleted. The reading path resolves a book by id through `getBook` and never consults
 * a list, so a class already using the book keeps working exactly as before — which is the whole
 * point of retiring rather than removing.
 */
export type Result = { ok: true } | { ok: false; error: string };

const ADMIN_ONLY = "Only an administrator can retire or restore a book.";

/** The ids an administrator has retired. */
export async function retiredIds(): Promise<Set<string>> {
  const rows = await db().select({ bookId: retiredBooks.bookId }).from(retiredBooks);
  return new Set(rows.map((r) => r.bookId));
}

export async function isRetired(bookId: string) {
  return (await db().select({ bookId: retiredBooks.bookId }).from(retiredBooks)
    .where(eq(retiredBooks.bookId, bookId)).limit(1)).length > 0;
}

/**
 * The books a picker may offer: every book in the library that is not retired.
 *
 * Every picker calls this and nothing else does. The separation is the point — `listBooks()` has
 * to keep returning a retired book so the class lists can still name it, and a single filtered
 * function used by both would quietly turn every such class's title into an id.
 */
export async function listBooksForPicker(opts: { keep?: string | null } = {}): Promise<BookManifest[]> {
  const [books, retired] = await Promise.all([listBooks(), retiredIds()]);
  // `keep` is the book the class already uses. A picker that changes a class's book has to offer
  // its current one as the selected option, retired or not, or the form would silently default to
  // some other book — and the panel beside it names the book from this same list, so dropping it
  // would turn the title into a raw id.
  return books.filter((b) => !retired.has(b.id) || b.id === opts.keep);
}

/** The books in the library, with each one's retirement and the classes that use it. */
export async function libraryShelf() {
  const [books, retired] = await Promise.all([listBooks(), retiredRows()]);
  const counts = await classCounts(books.map((b) => b.id));
  const by = new Map(retired.map((r) => [r.bookId, r]));
  return books.map((b) => ({
    book: b,
    retired: by.get(b.id) ?? null,
    classes: counts.get(b.id) ?? 0,
  }));
}

async function retiredRows() {
  return db().select({
    bookId: retiredBooks.bookId, retiredAt: retiredBooks.retiredAt,
    retiredBy: retiredBooks.retiredBy, byName: users.displayName,
  }).from(retiredBooks).leftJoin(users, eq(users.id, retiredBooks.retiredBy));
}

/** How many classes use each of these books. */
export async function classCounts(bookIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!bookIds.length) return out;
  const rows = await db().select({ bookId: sections.bookId }).from(sections)
    .where(inArray(sections.bookId, bookIds));
  for (const r of rows) out.set(r.bookId, (out.get(r.bookId) ?? 0) + 1);
  return out;
}

/**
 * What retiring this book would mean, for the confirmation shown before it happens.
 *
 * The sentence says the count and then says the classes keep working, because the count on its own
 * reads like a warning that something is about to break.
 */
export async function retireCost(bookId: string) {
  const classes = (await classCounts([bookId])).get(bookId) ?? 0;
  return {
    classes,
    sentence: classes === 0
      ? "No classes use this book."
      : `${classes} class${classes === 1 ? "" : "es"} use${classes === 1 ? "s" : ""} this book; ` +
        "they will keep working.",
  };
}

export async function retireBook(userId: string, bookId: string): Promise<Result> {
  if (!(await isAdmin(userId))) return { ok: false, error: ADMIN_ONLY };
  const books = await listBooks();
  if (!books.some((b) => b.id === bookId)) return { ok: false, error: "That book is not in the library." };
  await db().insert(retiredBooks).values({ bookId, retiredBy: userId }).onConflictDoNothing();
  return { ok: true };
}

export async function restoreBook(userId: string, bookId: string): Promise<Result> {
  if (!(await isAdmin(userId))) return { ok: false, error: ADMIN_ONLY };
  await db().delete(retiredBooks).where(eq(retiredBooks.bookId, bookId));
  return { ok: true };
}
