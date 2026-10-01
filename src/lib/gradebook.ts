import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lineItems, lineItemScores, exams, examAttempts, enrolments, users, identities, gradingCategories, letterScales } from "@/db/schema";
import {
  categoryPercent, coursePercent, countedScore, letterFor, parseBands, show, starterCategoryFor,
  weightsTotal, weightsValid, STARTER_CATEGORIES, type CountedAttempt, type LetterBand, type Scored,
} from "@/lib/grading";

function blueprintMax(blueprintJson: string): number {
  const bp = JSON.parse(blueprintJson);
  if (bp.mode === "fixed") return bp.ids.length;
  return bp.rules.reduce((s: number, r: any) => s + r.count, 0); // 1 point per question
}

// Make sure every exam in the section has a gradebook column (idempotent).
export async function ensureExamLineItems(sectionId: string) {
  const exs = await db().select().from(exams).where(eq(exams.sectionId, sectionId));
  const existing = new Set((await db().select({ refId: lineItems.refId }).from(lineItems)
    .where(and(eq(lineItems.sectionId, sectionId), eq(lineItems.kind, "exam")))).map((r) => r.refId));
  for (const e of exs) {
    if (existing.has(e.id)) continue;
    await db().insert(lineItems).values({ sectionId, kind: "exam", refId: e.id, title: e.title, maxPoints: blueprintMax(e.blueprintJson), weight: 1 })
      .onConflictDoNothing();
  }
}

export async function listLineItems(sectionId: string) {
  await ensureExamLineItems(sectionId);
  return db().select().from(lineItems).where(eq(lineItems.sectionId, sectionId)).orderBy(lineItems.position, lineItems.createdAt);
}

// The score that reaches the gradebook for an exam, per enrolment, under that exam's
// counted-attempt rule (highest | latest | average | first). Every attempt stays on record;
// this only chooses which one to read, so changing the rule recomputes the cell.
async function examScores(examId: string, rule: CountedAttempt): Promise<Map<string, number>> {
  const atts = await db().select().from(examAttempts).where(eq(examAttempts.examId, examId));
  const byEnr = new Map<string, typeof atts>();
  for (const a of atts) { const l = byEnr.get(a.enrolmentId) ?? []; l.push(a); byEnr.set(a.enrolmentId, l); }
  const out = new Map<string, number>();
  for (const [enrolmentId, list] of byEnr) {
    const counted = countedScore(list, rule);
    if (counted) out.set(enrolmentId, counted.score);
  }
  return out;
}

/** Every attempt a student has on an exam, oldest first, with the counted one marked. */
export async function attemptsForStudent(examId: string, enrolmentId: string, rule: CountedAttempt) {
  const mine = (await db().select().from(examAttempts)
    .where(and(eq(examAttempts.examId, examId), eq(examAttempts.enrolmentId, enrolmentId))))
    .sort((a, b) => +(a.submittedAt ?? a.startedAt) - +(b.submittedAt ?? b.startedAt));
  const counted = countedScore(mine, rule);
  // "average" is a computed figure, not one of the attempts, so nothing is marked for it
  let countedId: string | null = null;
  if (counted && rule !== "average") {
    const match = mine.find((a) => a.submittedAt && a.score === counted.score && a.maxPoints === counted.maxPoints);
    countedId = match?.id ?? null;
  }
  return { attempts: mine, counted, countedId };
}

export async function categoriesFor(sectionId: string) {
  return db().select().from(gradingCategories).where(eq(gradingCategories.sectionId, sectionId))
    .orderBy(gradingCategories.position, gradingCategories.createdAt);
}

export async function letterBandsFor(sectionId: string) {
  const row = (await db().select().from(letterScales).where(eq(letterScales.sectionId, sectionId)).limit(1))[0];
  return parseBands(row?.bandsJson);
}

export type Cell = { points: number | null; max: number };
export type CategoryResult = { id: string; name: string; weight: number; dropLowest: number; pct: number | null };

export async function gradebook(sectionId: string) {
  const items = await listLineItems(sectionId);
  const roster = await db().select({ enrolmentId: enrolments.id, name: users.displayName, email: identities.subject })
    .from(enrolments).innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));

  const [categories, bands] = await Promise.all([categoriesFor(sectionId), letterBandsFor(sectionId)]);
  const categorised = categories.length > 0;

  // derived exam scores (under each exam's own counted-attempt rule) + manual/override scores
  const examRows = items.some((i) => i.kind === "exam")
    ? await db().select().from(exams).where(eq(exams.sectionId, sectionId)) : [];
  const examById = new Map(examRows.map((e) => [e.id, e]));
  const derived = new Map<string, Map<string, number>>(); // lineItemId -> enrolmentId -> points
  for (const it of items) {
    if (it.kind !== "exam" || !it.refId) continue;
    const rule = (examById.get(it.refId)?.countedAttempt ?? "latest") as CountedAttempt;
    derived.set(it.id, await examScores(it.refId, rule));
  }
  const overrides = items.length ? await db().select().from(lineItemScores).where(inArray(lineItemScores.lineItemId, items.map((i) => i.id))) : [];
  const ovMap = new Map<string, number>();
  for (const o of overrides) ovMap.set(`${o.lineItemId}:${o.enrolmentId}`, o.points);

  const students = roster.map((s) => {
    const cells: Record<string, Cell> = {};
    const scored: { item: typeof items[number]; pct: number }[] = [];
    for (const it of items) {
      const pts: number | null = ovMap.has(`${it.id}:${s.enrolmentId}`)
        ? ovMap.get(`${it.id}:${s.enrolmentId}`)!
        : (it.kind === "exam" ? (derived.get(it.id)?.get(s.enrolmentId) ?? null) : null);
      cells[it.id] = { points: pts, max: it.maxPoints };
      if (pts != null && it.maxPoints > 0) scored.push({ item: it, pct: (pts / it.maxPoints) * 100 });
    }
    const graded = items.filter((it) => cells[it.id].points != null).length;

    if (!categorised) {
      // No categories: exactly as before — one weighted mean over every graded column.
      const flat: Scored[] = scored.map((c) => ({ pct: c.pct, weight: c.item.weight }));
      return { ...s, cells, total: categoryPercent(flat), graded, categories: [] as CategoryResult[], letter: null as string | null };
    }

    const perCategory: CategoryResult[] = categories.map((cat) => {
      const mine: Scored[] = scored.filter((c) => c.item.categoryId === cat.id).map((c) => ({ pct: c.pct, weight: c.item.weight }));
      return { id: cat.id, name: cat.name, weight: cat.weight, dropLowest: cat.dropLowest, pct: categoryPercent(mine, cat.dropLowest) };
    });
    const total = coursePercent(perCategory);
    return { ...s, cells, total, graded, categories: perCategory, letter: letterFor(total, bands) };
  });
  return { items, students, categories, bands, categorised };
}

/**
 * Spec 11: one student's own view of their grades. Reuses gradebook() so the arithmetic a
 * student sees is the same arithmetic their faculty see — never a second implementation.
 */
export async function gradesForStudent(sectionId: string, enrolmentId: string) {
  const { items, students, categories, bands, categorised } = await gradebook(sectionId);
  const mine = students.find((s) => s.enrolmentId === enrolmentId);
  if (!mine) return null;
  const graded = items
    .filter((it) => mine.cells[it.id].points != null)
    .map((it) => ({
      id: it.id, title: it.title, kind: it.kind, weight: it.weight, categoryId: it.categoryId,
      points: mine.cells[it.id].points as number, max: it.maxPoints,
      pct: it.maxPoints > 0 ? ((mine.cells[it.id].points as number) / it.maxPoints) * 100 : null,
    }));
  const ungradedCount = items.length - graded.length;
  return {
    graded, ungradedCount, categorised, categories,
    perCategory: mine.categories, total: mine.total, letter: mine.letter, bands,
  };
}

export async function addManualItem(sectionId: string, title: string, maxPoints: number, weight: number) {
  await db().insert(lineItems).values({ sectionId, kind: "manual", title, maxPoints, weight });
}
export async function setWeight(sectionId: string, lineItemId: string, weight: number) {
  if (!Number.isFinite(weight) || weight < 0) throw new Error("A column's weight cannot be negative.");
  await db().update(lineItems).set({ weight }).where(and(eq(lineItems.id, lineItemId), eq(lineItems.sectionId, sectionId)));
}

// --- Spec 11: grading setup ---

/** Replace a class's categories. Weights must total 100. Columns in deleted categories fall back
 *  to uncategorised (ON DELETE SET NULL), which is the no-categories behaviour for them. */
export async function setCategories(
  sectionId: string,
  rows: { id?: string; name: string; weight: number; dropLowest?: number }[],
) {
  const kept = rows.filter((r) => r.name.trim() !== "");
  if (!kept.length) { // clearing the setup returns the class to today's behaviour
    await db().delete(gradingCategories).where(eq(gradingCategories.sectionId, sectionId));
    return;
  }
  if (kept.some((r) => !Number.isFinite(r.weight) || r.weight < 0)) throw new Error("A category's weight cannot be negative.");
  if (kept.some((r) => (r.dropLowest ?? 0) < 0)) throw new Error("Drop-lowest cannot be negative.");
  if (!weightsValid(kept.map((r) => r.weight))) {
    throw new Error(`Category weights must total 100% — they total ${show(weightsTotal(kept.map((r) => r.weight)))}%.`);
  }
  const existing = await categoriesFor(sectionId);
  const keepIds = new Set(kept.map((r) => r.id).filter(Boolean) as string[]);
  for (const e of existing) if (!keepIds.has(e.id)) await db().delete(gradingCategories).where(eq(gradingCategories.id, e.id));
  let pos = 0;
  for (const r of kept) {
    const values = { name: r.name.trim(), weight: r.weight, dropLowest: r.dropLowest ?? 0, position: pos++ };
    if (r.id && existing.some((e) => e.id === r.id)) {
      await db().update(gradingCategories).set(values).where(and(eq(gradingCategories.id, r.id), eq(gradingCategories.sectionId, sectionId)));
    } else {
      await db().insert(gradingCategories).values({ sectionId, ...values });
    }
  }
}

/** Offer the starter set to a class that has none, assigning existing columns by kind. */
export async function applyStarterCategories(sectionId: string) {
  if ((await categoriesFor(sectionId)).length) return; // never overwrite a faculty's own setup
  let pos = 0;
  for (const c of STARTER_CATEGORIES) {
    await db().insert(gradingCategories).values({ sectionId, name: c.name, weight: c.weight, dropLowest: 0, position: pos++ });
  }
  const cats = await categoriesFor(sectionId);
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const items = await db().select().from(lineItems).where(eq(lineItems.sectionId, sectionId));
  const examRows = await db().select().from(exams).where(eq(exams.sectionId, sectionId));
  const examKind = new Map(examRows.map((e) => [e.id, e.kind]));
  for (const it of items) {
    if (it.categoryId) continue;
    const want = starterCategoryFor(it.kind, it.refId ? examKind.get(it.refId) : undefined);
    const categoryId = want ? byName.get(want) ?? null : null;
    if (categoryId) await db().update(lineItems).set({ categoryId }).where(eq(lineItems.id, it.id));
  }
}

/** Move one column into a category, or out of all of them with null. */
export async function setColumnCategory(sectionId: string, lineItemId: string, categoryId: string | null) {
  if (categoryId) {
    const owned = (await db().select({ id: gradingCategories.id }).from(gradingCategories)
      .where(and(eq(gradingCategories.id, categoryId), eq(gradingCategories.sectionId, sectionId))).limit(1))[0];
    if (!owned) throw new Error("That category belongs to another class.");
  }
  await db().update(lineItems).set({ categoryId }).where(and(eq(lineItems.id, lineItemId), eq(lineItems.sectionId, sectionId)));
}

/** Replace a class's letter scale. An empty list restores the default A/B/C/D/F. */
export async function setLetterBands(sectionId: string, bands: LetterBand[]) {
  const clean = bands
    .filter((b) => b.letter.trim() !== "" && Number.isFinite(Number(b.min)))
    .map((b) => ({ letter: b.letter.trim(), min: Number(b.min) }))
    .sort((a, b) => b.min - a.min);
  if (!clean.length) {
    await db().delete(letterScales).where(eq(letterScales.sectionId, sectionId));
    return;
  }
  if (clean.some((b) => b.min < 0 || b.min > 100)) throw new Error("A letter's minimum must be between 0 and 100.");
  const bandsJson = JSON.stringify(clean);
  await db().insert(letterScales).values({ sectionId, bandsJson, updatedAt: new Date() })
    .onConflictDoUpdate({ target: letterScales.sectionId, set: { bandsJson, updatedAt: new Date() } });
}
export async function setScore(lineItemId: string, enrolmentId: string, points: number) {
  await db().insert(lineItemScores).values({ lineItemId, enrolmentId, points, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [lineItemScores.lineItemId, lineItemScores.enrolmentId], set: { points, updatedAt: new Date() } });
}

// --- CSV export ---
const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
export async function exportCsv(sectionId: string, format: string): Promise<string> {
  const { items, students, categories, categorised } = await gradebook(sectionId);
  const rows: string[] = [];
  const itemTitles = items.map((i) => i.title);
  const cellPts = (s: any, it: any) => s.cells[it.id].points == null ? "" : String(s.cells[it.id].points);
  // Spec 11: a class with categories also exports each category's percentage and the letter.
  // Each format's existing total column already carries the course percentage, so it is not
  // repeated. Rounded here, at the edge — never in the stored figures.
  // D2L stays per-item only (decision 4), so it ignores both.
  const catHeaders = categorised ? categories.map((c) => `${c.name} (%)`) : [];
  const catCells = (s: any) => categorised ? s.categories.map((c: any) => show(c.pct)) : [];
  const letterHeader = categorised ? ["Letter"] : [];
  const letterCell = (s: any) => categorised ? [s.letter ?? ""] : [];

  if (format === "canvas") {
    rows.push(["Student", "ID", "SIS User ID", "SIS Login ID", "Section", ...itemTitles.map((t, i) => `${t} (${items[i].maxPoints})`), ...catHeaders, "Total", ...letterHeader].map(esc).join(","));
    rows.push(["    Points Possible", "", "", "", "", ...items.map((i) => String(i.maxPoints)), ...catHeaders.map(() => ""), "100", ...letterHeader.map(() => "")].map(esc).join(","));
    for (const s of students) rows.push([s.name, "", "", s.email ?? "", "", ...items.map((it) => cellPts(s, it)), ...catCells(s), show(s.total), ...letterCell(s)].map(esc).join(","));
  } else if (format === "d2l") {
    // Brightspace/D2L: key column + "Item Points Grade <Numeric MaxPoints:M>" + end-of-line
    rows.push(["Username", ...items.map((i) => `${i.title} Points Grade <Numeric MaxPoints:${i.maxPoints}>`), "End-of-Line Indicator"].map(esc).join(","));
    for (const s of students) rows.push([s.email ?? s.name, ...items.map((it) => cellPts(s, it)), "#"].map(esc).join(","));
  } else if (format === "blackboard") {
    rows.push(["Last Name", "First Name", "Username", ...itemTitles, ...catHeaders, "Weighted Total", ...letterHeader].map(esc).join(","));
    for (const s of students) {
      const [first, ...rest] = (s.name ?? "").split(" "); const last = rest.join(" ") || first;
      rows.push([last, first, s.email ?? "", ...items.map((it) => cellPts(s, it)), ...catCells(s), show(s.total), ...letterCell(s)].map(esc).join(","));
    }
  } else if (format === "moodle") {
    rows.push(["First name", "Last name", "Email address", ...itemTitles, ...catHeaders, "Course total", ...letterHeader].map(esc).join(","));
    for (const s of students) {
      const [first, ...rest] = (s.name ?? "").split(" ");
      rows.push([first, rest.join(" "), s.email ?? "", ...items.map((it) => cellPts(s, it)), ...catCells(s), show(s.total), ...letterCell(s)].map(esc).join(","));
    }
  } else { // generic
    rows.push(["Student", "Email", ...itemTitles.map((t, i) => `${t} / ${items[i].maxPoints}`), ...catHeaders, "Weighted total (%)", ...letterHeader].map(esc).join(","));
    for (const s of students) rows.push([s.name, s.email ?? "", ...items.map((it) => cellPts(s, it)), ...catCells(s), show(s.total), ...letterCell(s)].map(esc).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

// Starter gradebook per course: the editable floor. A section begins with these weighted
// columns (the 50/50 rollup), which faculty rename, re-split, or replace. Later the syllabus
// extractor fills this same slot with the real per-assignment columns.
const GRADEBOOK_STARTERS: Record<string, { title: string; weight: number }[]> = {
  mis3000: [{ title: "Excel worksheets", weight: 1 }, { title: "Book & exams", weight: 1 }],
  sad: [{ title: "Book", weight: 1 }, { title: "MVCFN simulation", weight: 1 }],
};

export async function applyGradebookStarter(sectionId: string, bookId: string) {
  const starter = GRADEBOOK_STARTERS[bookId];
  if (!starter) return;
  const existing = await db().select().from(lineItems).where(and(eq(lineItems.sectionId, sectionId), eq(lineItems.kind, "manual")));
  if (existing.length) return; // idempotent — never re-seed a section that already has manual columns
  let pos = 0;
  for (const s of starter) {
    await db().insert(lineItems).values({ sectionId, kind: "manual", title: s.title, maxPoints: 100, weight: s.weight, position: pos++ });
  }
}
