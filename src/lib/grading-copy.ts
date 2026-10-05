import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  gradingCategories, letterScales, lineItems, lineItemScores, sections, enrolments,
} from "@/db/schema";
import { canManageClass } from "@/lib/publish";
import { isAdmin } from "@/lib/admin";
import { logAction } from "@/lib/class-actions";
import { activeStudent } from "@/lib/withdraw";
import { norm } from "@/lib/render";

/**
 * Copying a grading setup from one class to another (Spec 19 §3).
 *
 * What a setup *is* was the third report before this build: **per class** — the categories with
 * their weights and drop-lowest, the letter scale, and which column sits in which category — and
 * **per exam or quiz** — the retake rules, which belong to the exam and are not copied.
 *
 * The wrinkle the report found: copied categories are new rows with new ids, so
 * `line_items.category_id` cannot be carried over. Every column in the target is re-matched to a
 * copied category **by name**, and the ones that match nothing are reported rather than lost —
 * they end up uncategorised, which is a column a faculty member can see and place.
 */

/** Headings are matched the way the renderer matches them: by meaning, not by punctuation. */
const sameName = (a: string, b: string) => norm(a) === norm(b);

export type CopyPreview = {
  from: { sectionId: string; name: string };
  to: { sectionId: string; name: string };
  categories: { name: string; weight: number; dropLowest: number }[];
  /** Columns in the target, and the copied category each would land in. */
  matched: { title: string; category: string }[];
  /** Columns that match no copied category. They are listed, not lost. */
  unmatched: string[];
  /** The target's categories and scale that would be replaced. */
  replacing: { categories: number; hasScale: boolean };
  /** Decision 5: how many students' totals this would change. */
  studentsAffected: number;
  letterBands: number;
};

/** Classes a person may copy from: the ones they teach, or any, for an admin. */
export async function copyableClasses(userId: string, exceptSectionId: string) {
  const all = await db().select({ id: sections.id, name: sections.name, term: sections.term }).from(sections);
  if (await isAdmin(userId)) return all.filter((s) => s.id !== exceptSectionId);
  const mine = await db().select({ sectionId: enrolments.sectionId }).from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.role, "instructor")));
  const ids = new Set(mine.map((m) => m.sectionId));
  return all.filter((s) => ids.has(s.id) && s.id !== exceptSectionId);
}

async function setupOf(sectionId: string) {
  const cats = await db().select().from(gradingCategories)
    .where(eq(gradingCategories.sectionId, sectionId)).orderBy(asc(gradingCategories.position));
  const scale = (await db().select().from(letterScales)
    .where(eq(letterScales.sectionId, sectionId)).limit(1))[0];
  return { cats, scale };
}

export type PreviewResult = { ok: true; preview: CopyPreview } | { ok: false; error: string };

export async function previewCopy(userId: string, fromId: string, toId: string): Promise<PreviewResult> {
  if (fromId === toId) return { ok: false, error: "That is the same class." };
  if (!(await canManageClass(userId, toId))) {
    return { ok: false, error: "Only this class's faculty or an administrator can change its grading setup." };
  }
  const allowed = await copyableClasses(userId, toId);
  if (!allowed.some((s) => s.id === fromId)) {
    return { ok: false, error: "You can only copy from a class you teach." };
  }
  const [from, to] = await Promise.all([
    db().select({ name: sections.name }).from(sections).where(eq(sections.id, fromId)).limit(1),
    db().select({ name: sections.name }).from(sections).where(eq(sections.id, toId)).limit(1),
  ]);
  if (!from[0] || !to[0]) return { ok: false, error: "That class no longer exists." };

  const source = await setupOf(fromId);
  if (!source.cats.length && !source.scale) {
    return { ok: false, error: "That class has no grading setup to copy." };
  }
  const target = await setupOf(toId);
  const columns = await db().select({ id: lineItems.id, title: lineItems.title })
    .from(lineItems).where(eq(lineItems.sectionId, toId));

  const matched: { title: string; category: string }[] = [];
  const unmatched: string[] = [];
  for (const col of columns) {
    const hit = source.cats.find((c) => sameName(c.name, col.title));
    if (hit) matched.push({ title: col.title, category: hit.name });
    else unmatched.push(col.title);
  }

  // Decision 5: whose totals move. Any student with a score in this class, because the course
  // percentage is computed from the categories that are about to be replaced.
  const ids = columns.map((c) => c.id);
  const scored = ids.length
    ? await db().select({ enrolmentId: lineItemScores.enrolmentId }).from(lineItemScores)
        .innerJoin(enrolments, eq(enrolments.id, lineItemScores.enrolmentId))
        .where(and(inArray(lineItemScores.lineItemId, ids), eq(enrolments.sectionId, toId), activeStudent()))
    : [];
  const studentsAffected = new Set(scored.map((s) => s.enrolmentId)).size;

  return {
    ok: true,
    preview: {
      from: { sectionId: fromId, name: from[0].name },
      to: { sectionId: toId, name: to[0].name },
      categories: source.cats.map((c) => ({ name: c.name, weight: c.weight, dropLowest: c.dropLowest })),
      matched, unmatched,
      replacing: { categories: target.cats.length, hasScale: !!target.scale },
      studentsAffected,
      letterBands: source.scale ? (JSON.parse(source.scale.bandsJson) as unknown[]).length : 0,
    },
  };
}

export type CopyResult = { ok: true; preview: CopyPreview } | { ok: false; error: string };

/**
 * Replace the target's categories and letter scale with the source's, and re-match its columns.
 *
 * Allowed when scores exist (decision 5), behind a typed confirmation: the course totals really do
 * change, so the preview says how many students that is and the person types the target class's
 * name to say they meant it.
 */
export async function copySetup(
  userId: string, fromId: string, toId: string, opts: { confirm?: string } = {},
): Promise<CopyResult> {
  const p = await previewCopy(userId, fromId, toId);
  if (!p.ok) return p;
  const preview = p.preview;
  if (preview.studentsAffected > 0 && opts.confirm?.trim() !== preview.to.name.trim()) {
    return {
      ok: false,
      error: `${preview.studentsAffected} student${preview.studentsAffected === 1 ? "'s" : "s'"} course ` +
        `total${preview.studentsAffected === 1 ? "" : "s"} will change. Type the class's name — ` +
        `"${preview.to.name}" — to confirm.`,
    };
  }
  const source = await setupOf(fromId);

  await db().transaction(async (tx) => {
    // The columns' category links go first: the rows they point at are about to be replaced, and
    // ON DELETE SET NULL would do this anyway — doing it deliberately keeps the order readable.
    const columns = await tx.select({ id: lineItems.id, title: lineItems.title })
      .from(lineItems).where(eq(lineItems.sectionId, toId));
    if (columns.length) {
      await tx.update(lineItems).set({ categoryId: null }).where(eq(lineItems.sectionId, toId));
    }
    await tx.delete(gradingCategories).where(eq(gradingCategories.sectionId, toId));
    const made = new Map<string, string>();
    let pos = 0;
    for (const c of source.cats) {
      const [row] = await tx.insert(gradingCategories)
        .values({ sectionId: toId, name: c.name, weight: c.weight, dropLowest: c.dropLowest, position: pos++ })
        .returning();
      made.set(c.name, row.id);
    }
    for (const col of columns) {
      const hit = source.cats.find((c) => sameName(c.name, col.title));
      if (hit) await tx.update(lineItems).set({ categoryId: made.get(hit.name)! }).where(eq(lineItems.id, col.id));
    }
    await tx.delete(letterScales).where(eq(letterScales.sectionId, toId));
    if (source.scale) {
      await tx.insert(letterScales).values({ sectionId: toId, bandsJson: source.scale.bandsJson, updatedAt: new Date() });
    }
  });

  await logAction(toId, userId, "copy_grading", preview.categories.length, {
    categories: preview.categories.length,
    matched: preview.matched.length,
    unmatched: preview.unmatched.length,
    students: preview.studentsAffected,
  });
  return { ok: true, preview };
}
