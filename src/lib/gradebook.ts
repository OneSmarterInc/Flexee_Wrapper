import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lineItems, lineItemScores, exams, examAttempts, enrolments, users, identities } from "@/db/schema";

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

// Latest submitted attempt score for an exam, per enrolment.
async function examScores(examId: string): Promise<Map<string, number>> {
  const atts = await db().select().from(examAttempts).where(eq(examAttempts.examId, examId));
  const byEnr = new Map<string, { score: number; at: Date }>();
  for (const a of atts) {
    if (!a.submittedAt || a.score == null) continue;
    const cur = byEnr.get(a.enrolmentId);
    if (!cur || a.submittedAt > cur.at) byEnr.set(a.enrolmentId, { score: a.score, at: a.submittedAt });
  }
  return new Map([...byEnr].map(([k, v]) => [k, v.score]));
}

export type Cell = { points: number | null; max: number };
export async function gradebook(sectionId: string) {
  const items = await listLineItems(sectionId);
  const roster = await db().select({ enrolmentId: enrolments.id, name: users.displayName, email: identities.subject })
    .from(enrolments).innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));

  // derived exam scores + manual/override scores
  const derived = new Map<string, Map<string, number>>(); // lineItemId -> enrolmentId -> points
  for (const it of items) if (it.kind === "exam" && it.refId) derived.set(it.id, await examScores(it.refId));
  const overrides = items.length ? await db().select().from(lineItemScores).where(inArray(lineItemScores.lineItemId, items.map((i) => i.id))) : [];
  const ovMap = new Map<string, number>();
  for (const o of overrides) ovMap.set(`${o.lineItemId}:${o.enrolmentId}`, o.points);

  const students = roster.map((s) => {
    const cells: Record<string, Cell> = {};
    let wsum = 0, wpct = 0;
    for (const it of items) {
      let pts: number | null = ovMap.has(`${it.id}:${s.enrolmentId}`)
        ? ovMap.get(`${it.id}:${s.enrolmentId}`)!
        : (it.kind === "exam" ? (derived.get(it.id)?.get(s.enrolmentId) ?? null) : null);
      cells[it.id] = { points: pts, max: it.maxPoints };
      if (pts != null && it.maxPoints > 0) { wsum += it.weight; wpct += (pts / it.maxPoints) * it.weight; }
    }
    const total = wsum > 0 ? Math.round((wpct / wsum) * 1000) / 10 : null; // weighted % over graded items
    const graded = items.filter((it) => cells[it.id].points != null).length;
    return { ...s, cells, total, graded };
  });
  return { items, students };
}

export async function addManualItem(sectionId: string, title: string, maxPoints: number, weight: number) {
  await db().insert(lineItems).values({ sectionId, kind: "manual", title, maxPoints, weight });
}
export async function setWeight(sectionId: string, lineItemId: string, weight: number) {
  await db().update(lineItems).set({ weight }).where(and(eq(lineItems.id, lineItemId), eq(lineItems.sectionId, sectionId)));
}
export async function setScore(lineItemId: string, enrolmentId: string, points: number) {
  await db().insert(lineItemScores).values({ lineItemId, enrolmentId, points, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [lineItemScores.lineItemId, lineItemScores.enrolmentId], set: { points, updatedAt: new Date() } });
}

// --- CSV export ---
const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
export async function exportCsv(sectionId: string, format: string): Promise<string> {
  const { items, students } = await gradebook(sectionId);
  const rows: string[] = [];
  const itemTitles = items.map((i) => i.title);
  const cellPts = (s: any, it: any) => s.cells[it.id].points == null ? "" : String(s.cells[it.id].points);

  if (format === "canvas") {
    rows.push(["Student", "ID", "SIS User ID", "SIS Login ID", "Section", ...itemTitles.map((t, i) => `${t} (${items[i].maxPoints})`), "Total"].map(esc).join(","));
    rows.push(["    Points Possible", "", "", "", "", ...items.map((i) => String(i.maxPoints)), "100"].map(esc).join(","));
    for (const s of students) rows.push([s.name, "", "", s.email ?? "", "", ...items.map((it) => cellPts(s, it)), s.total ?? ""].map(esc).join(","));
  } else if (format === "d2l") {
    // Brightspace/D2L: key column + "Item Points Grade <Numeric MaxPoints:M>" + end-of-line
    rows.push(["Username", ...items.map((i) => `${i.title} Points Grade <Numeric MaxPoints:${i.maxPoints}>`), "End-of-Line Indicator"].map(esc).join(","));
    for (const s of students) rows.push([s.email ?? s.name, ...items.map((it) => cellPts(s, it)), "#"].map(esc).join(","));
  } else if (format === "blackboard") {
    rows.push(["Last Name", "First Name", "Username", ...itemTitles, "Weighted Total"].map(esc).join(","));
    for (const s of students) {
      const [first, ...rest] = (s.name ?? "").split(" "); const last = rest.join(" ") || first;
      rows.push([last, first, s.email ?? "", ...items.map((it) => cellPts(s, it)), s.total ?? ""].map(esc).join(","));
    }
  } else if (format === "moodle") {
    rows.push(["First name", "Last name", "Email address", ...itemTitles, "Course total"].map(esc).join(","));
    for (const s of students) {
      const [first, ...rest] = (s.name ?? "").split(" ");
      rows.push([first, rest.join(" "), s.email ?? "", ...items.map((it) => cellPts(s, it)), s.total ?? ""].map(esc).join(","));
    }
  } else { // generic
    rows.push(["Student", "Email", ...itemTitles.map((t, i) => `${t} / ${items[i].maxPoints}`), "Weighted total (%)"].map(esc).join(","));
    for (const s of students) rows.push([s.name, s.email ?? "", ...items.map((it) => cellPts(s, it)), s.total ?? ""].map(esc).join(","));
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
