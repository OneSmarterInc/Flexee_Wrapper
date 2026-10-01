// Integration test: the gradebook (lib/gradebook) — exam columns appearing on their own, manual
// columns, per-column weights, which attempt reaches a cell, the weighted total over graded work
// only, and the CSV exports. This imports the real functions rather than mirroring them, so a
// change in src/lib/gradebook.ts shows up here.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection } from "@/lib/roster";
import { gradebook, listLineItems, addManualItem, setWeight, setScore, exportCsv } from "@/lib/gradebook";

const { users, identities, enrolments, exams, examAttempts, lineItemScores } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
async function student(sectionId: string, name: string, email: string) {
  const u = await account(name, email);
  const [e] = await db().insert(enrolments).values({ sectionId, userId: u.id, role: "student" }).returning();
  return e;
}
const fixed = (n: number) => JSON.stringify({ mode: "fixed", ids: Array.from({ length: n }, (_, i) => `q${i}`) });
async function exam(sectionId: string, title: string, questions: number) {
  const [e] = await db().insert(exams).values({ sectionId, title, blueprintJson: fixed(questions), status: "closed" }).returning();
  return e;
}
async function attempt(examId: string, enrolmentId: string, score: number, max: number, submittedAt: Date) {
  const [a] = await db().insert(examAttempts).values({ examId, enrolmentId, servedJson: "[]", maxPoints: max, score, submittedAt }).returning();
  return a;
}
const rowFor = (students: any[], enrolmentId: string) => students.find((s) => s.enrolmentId === enrolmentId)!;
const cellOf = (students: any[], enrolmentId: string, itemId: string) => rowFor(students, enrolmentId).cells[itemId];
const totalOf = (students: any[], enrolmentId: string) => rowFor(students, enrolmentId).total;

const prof = await account("Prof", "prof@flexee.org");
const sec = await createSection(prof.id, "mis3000", "GB");
const ada = await student(sec.id, "Ada", "ada@wright.edu");
const ben = await student(sec.id, "Ben", "ben@wright.edu");

const midterm = await exam(sec.id, "Midterm", 4);
const quiz = await exam(sec.id, "Quiz", 2);
const day = (n: number) => new Date(Date.UTC(2026, 0, n));
await attempt(midterm.id, ada.id, 3, 4, day(1));
await attempt(quiz.id, ada.id, 2, 2, day(1));
await attempt(midterm.id, ben.id, 2, 4, day(1));
await attempt(quiz.id, ben.id, 1, 2, day(1));

await t("every exam in the class gets a gradebook column, once", async () => {
  const items = await listLineItems(sec.id);
  const examItems = items.filter((i) => i.kind === "exam");
  assert.equal(examItems.length, 2);
  assert.deepEqual(examItems.map((i) => i.title).sort(), ["Midterm", "Quiz"]);
  assert.equal(examItems.find((i) => i.title === "Midterm")!.maxPoints, 4);
  assert.equal((await listLineItems(sec.id)).filter((i) => i.kind === "exam").length, 2, "idempotent");
});

await addManualItem(sec.id, "Participation", 10, 1);
const items = await listLineItems(sec.id);
const byTitle = new Map(items.map((i) => [i.title, i]));
const participation = byTitle.get("Participation")!;

await t("a manual column takes a typed score", async () => {
  await setScore(participation.id, ada.id, 9);
  await setScore(participation.id, ben.id, 7);
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, ada.id, participation.id).points, 9);
  assert.equal(cellOf(students, ben.id, participation.id).max, 10);
});

await t("the weighted total is the mean of column percentages, weighted per column", async () => {
  await setWeight(sec.id, byTitle.get("Midterm")!.id, 2);
  await setWeight(sec.id, byTitle.get("Quiz")!.id, 1);
  await setWeight(sec.id, participation.id, 1);
  const { students } = await gradebook(sec.id);
  // Ada: 75% x2, 100% x1, 90% x1 over weight 4 -> 85
  assert.equal(totalOf(students, ada.id), 85);
  // Ben: 50% x2, 50% x1, 70% x1 over weight 4 -> 55
  assert.equal(totalOf(students, ben.id), 55);
});

await t("an exam cell takes the latest submitted attempt, and keeps the earlier one", async () => {
  const retake = await attempt(midterm.id, ada.id, 4, 4, day(5));
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, ada.id, byTitle.get("Midterm")!.id).points, 4);
  const mine = (await db().select().from(examAttempts).where(eq(examAttempts.examId, midterm.id)))
    .filter((a) => a.enrolmentId === ada.id);
  assert.equal(mine.length, 2, "both attempts still on record");
  await db().delete(examAttempts).where(eq(examAttempts.id, retake.id));
});

await t("an unsubmitted attempt does not reach the gradebook", async () => {
  const [open] = await db().insert(examAttempts)
    .values({ examId: quiz.id, enrolmentId: ben.id, servedJson: "[]", maxPoints: 2, score: null }).returning();
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, ben.id, byTitle.get("Quiz")!.id).points, 1);
  await db().delete(examAttempts).where(eq(examAttempts.id, open.id));
});

const final = await exam(sec.id, "Final", 4);
const finalItem = (await listLineItems(sec.id)).find((i) => i.refId === final.id)!;

await t("a new class starts with its book's starter columns, unscored", async () => {
  const { items: all, students } = await gradebook(sec.id);
  const starters = all.filter((i) => i.kind === "manual" && i.title !== "Participation");
  assert.deepEqual(starters.map((i) => i.title).sort(), ["Book & exams", "Excel worksheets"]);
  for (const s of starters) assert.equal(rowFor(students, ada.id).cells[s.id].points, null);
});

await t("an ungraded column is left out instead of counting as zero", async () => {
  const { items: all, students } = await gradebook(sec.id);
  const row = rowFor(students, ada.id);
  assert.equal(row.total, 85, "total unchanged by an ungraded column");
  assert.equal(row.cells[finalItem.id].points, null);
  assert.equal(row.graded, 3, "Midterm, Quiz and Participation only");
  // two starter columns + Midterm + Quiz + Participation + Final
  assert.equal(all.length, 6);
});

await t("an entered zero counts, and drags the total down", async () => {
  await setScore(finalItem.id, ada.id, 0);
  const { students } = await gradebook(sec.id);
  // Ada: 75% x2, 100% x1, 90% x1, 0% x1 over weight 5 -> 68
  assert.equal(totalOf(students, ada.id), 68);
  await db().delete(lineItemScores)
    .where(and(eq(lineItemScores.lineItemId, finalItem.id), eq(lineItemScores.enrolmentId, ada.id)));
});

await t("a student with nothing graded has no total rather than a zero", async () => {
  const cal = await student(sec.id, "Cal", "cal@wright.edu");
  const { students } = await gradebook(sec.id);
  const row = rowFor(students, cal.id);
  assert.equal(row.total, null);
  assert.equal(row.graded, 0);
  await db().delete(enrolments).where(eq(enrolments.id, cal.id));
});

await t("the generic export carries every column and the weighted total", async () => {
  const csv = await exportCsv(sec.id, "generic");
  const [header, ...rows] = csv.trim().split("\r\n");
  assert.ok(header.includes("Weighted total (%)"), header);
  assert.ok(header.includes("Midterm / 4"), header);
  assert.ok(header.includes("Participation / 10"), header);
  const adaRow = rows.find((r) => r.startsWith('"Ada"'))!;
  assert.ok(adaRow.includes('"85"'), adaRow);
  assert.ok(adaRow.includes('"ada@wright.edu"'), adaRow);
});

await t("each LMS format carries its own total column, and D2L stays per-item", async () => {
  const canvas = (await exportCsv(sec.id, "canvas")).split("\r\n");
  assert.ok(canvas[0].includes("Total"), canvas[0]);
  assert.ok(canvas[1].includes('"    Points Possible"'), canvas[1]);
  assert.ok((await exportCsv(sec.id, "blackboard")).includes("Weighted Total"));
  assert.ok((await exportCsv(sec.id, "moodle")).includes("Course total"));
  const d2l = await exportCsv(sec.id, "d2l");
  assert.ok(d2l.includes("End-of-Line Indicator"));
  assert.ok(d2l.includes("Points Grade <Numeric MaxPoints:4>"));
});

await t("a class with no columns and no students yields nothing to grade", async () => {
  // inserted directly: a book with no starter set and no manifest to pin
  const [empty] = await db().insert(schema.sections)
    .values({ bookId: "otherbook", name: "Empty", joinCode: "EMPTY1" }).returning();
  const { items: none, students: roster } = await gradebook(empty.id);
  assert.equal(none.length, 0);
  assert.equal(roster.length, 0);
});

console.log(`\n${passed} passed`);
