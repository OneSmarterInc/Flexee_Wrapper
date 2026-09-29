import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sections, sectionContentPins } from "@/db/schema";
import { ownedSection } from "@/lib/roster";
import { isAdmin } from "@/lib/admin";
import { getBook } from "@/lib/content";
import { pinSectionToLatest } from "@/lib/versions";

// A class's book is hidden from its students until the class's faculty (or an admin) publish it.
// Faculty and admins can always open it, so they can prepare before publishing.

export type ClassResult = { ok: true } | { ok: false; error: string };

/** A class's faculty, or any admin, may choose, publish and unpublish its book. */
export async function canManageClass(userId: string, sectionId: string) {
  return !!(await ownedSection(userId, sectionId)) || (await isAdmin(userId));
}

export async function classBookState(sectionId: string) {
  const r = (await db().select({ bookId: sections.bookId, publishedAt: sections.bookPublishedAt })
    .from(sections).where(eq(sections.id, sectionId)).limit(1))[0];
  return r ? { bookId: r.bookId, published: !!r.publishedAt, publishedAt: r.publishedAt } : null;
}

/** Choose the class's book from the library. Only while the book is not yet published to students. */
export async function chooseClassBook(userId: string, sectionId: string, bookId: string): Promise<ClassResult> {
  if (!(await canManageClass(userId, sectionId))) return { ok: false, error: "Only this class's faculty or an administrator can change its book." };
  const state = await classBookState(sectionId);
  if (!state) return { ok: false, error: "That class no longer exists." };
  if (state.published) return { ok: false, error: "Unpublish the current book before choosing a different one, so students never see a book change under them." };
  if (state.bookId === bookId) return { ok: true };
  try { await getBook(bookId); } catch { return { ok: false, error: "That book is not in the library." }; }
  await db().update(sections).set({ bookId }).where(eq(sections.id, sectionId));
  await db().delete(sectionContentPins).where(eq(sectionContentPins.sectionId, sectionId)); // the old book's chapter versions
  await pinSectionToLatest(sectionId, bookId);
  return { ok: true };
}

export async function publishClassBook(userId: string, sectionId: string): Promise<ClassResult> {
  if (!(await canManageClass(userId, sectionId))) return { ok: false, error: "Only this class's faculty or an administrator can publish its book." };
  const state = await classBookState(sectionId);
  if (!state) return { ok: false, error: "That class no longer exists." };
  if (!state.published) await db().update(sections).set({ bookPublishedAt: new Date() }).where(eq(sections.id, sectionId));
  return { ok: true };
}

export async function unpublishClassBook(userId: string, sectionId: string): Promise<ClassResult> {
  if (!(await canManageClass(userId, sectionId))) return { ok: false, error: "Only this class's faculty or an administrator can unpublish its book." };
  await db().update(sections).set({ bookPublishedAt: null }).where(eq(sections.id, sectionId));
  return { ok: true };
}
