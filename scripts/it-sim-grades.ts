// Integration test: Spec 12 — simulation results in the gradebook. A sim in a class gets its own
// column, which starts as a participation record and becomes graded only when faculty say so.
// Proves each of the spec's nine rules against the real library code.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection } from "@/lib/roster";
import { addSimToClass, removeSimFromClass, simsForClass, recordCompletion } from "@/lib/sims";
import {
  gradebook, listLineItems, setScore, setCategories, applyStarterCategories, categoriesFor,
  ensureSimLineItem, simColumnsFor, setSimRule, setSimPoints, gradesForStudent, exportCsv,
  isParticipation, DEFAULT_SIM_POINTS,
} from "@/lib/gradebook";
// signPass is the same HMAC a sim's signBack uses, so a completion can be forged here without a
// checkout of the RapidSims repository — this suite tests the Wrapper's side of the contract.
import { signPass } from "@/lib/launchpass";

const { users, identities, enrolments, sims, simLaunches, simCompletions, lineItems, lineItemScores } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const near = (a: number | null, b: number, msg?: string) =>
  assert.ok(a != null && Math.abs(a - b) < 1e-9, msg ?? `expected ${b}, got ${a}`);

process.env.LAUNCH_SECRET = "spec12-secret";

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
async function enrol(sectionId: string, userId: string, role: "student" | "instructor") {
  const [e] = await db().insert(enrolments).values({ sectionId, userId, role }).returning();
  return e;
}
async function sim(id: string, title: string, number: number) {
  const [s] = await db().insert(sims)
    .values({ id, title, number, published: true, launchUrl: `https://${id}.example.app` }).returning();
  return s;
}
/** A completion as a sim really reports it: a launch on record, then a signed token to /api/complete. */
async function play(userId: string, simId: string, sectionId: string | null, asRole: "student" | "faculty" | "faculty_preview") {
  await db().insert(simLaunches).values({ userId, simId, sectionId, asRole });
  const now = Date.now();
  const token = signPass({
    sub: userId, sim: simId, course: sectionId, duration: 600,
    summary: "Finished", metrics: { choice: "x" }, iat: now, exp: now + 300000,
  });
  const r = await recordCompletion(token);
  assert.equal(r.ok, true, `completion refused: ${JSON.stringify(r)}`);
  return r;
}
const cellOf = (students: any[], enrolmentId: string, itemId: string) =>
  students.find((s) => s.enrolmentId === enrolmentId)!.cells[itemId];
const totalOf = (students: any[], enrolmentId: string) =>
  students.find((s) => s.enrolmentId === enrolmentId)!.total;
const catPct = (students: any[], enrolmentId: string, name: string) =>
  students.find((s) => s.enrolmentId === enrolmentId)!.categories.find((c: any) => c.name === name)?.pct ?? null;

const prof = await account("Prof", "prof@flexee.org");
const otherProf = await account("Other Prof", "other@flexee.org");
const sec = await createSection(prof.id, "mis3000", "Spring");
await db().delete(lineItems).where(eq(lineItems.sectionId, sec.id)); // start from a known, empty gradebook
await enrol(sec.id, prof.id, "instructor").catch(() => {});          // createSection already enrols the creator
const ada = await account("Ada", "ada@wright.edu");
const ben = await account("Ben", "ben@wright.edu");
const adaEnr = await enrol(sec.id, ada.id, "student");
const benEnr = await enrol(sec.id, ben.id, "student");

const disaster = await sim("rapid-01-disaster", "Disaster at Midland", 1);
const ladder = await sim("rapid-02-ladder", "The Ladder", 2);

// ---------------------------------------------------------------- rule 1 and the default

await t("rule 1 — adding a sim creates exactly one column, as a participation record", async () => {
  assert.equal((await addSimToClass(prof.id, sec.id, disaster.id)).ok, true);
  const items = await listLineItems(sec.id);
  const mine = items.filter((i) => i.refId === disaster.id);
  assert.equal(mine.length, 1);
  const col = mine[0];
  assert.equal(col.kind, "sim");
  assert.equal(col.title, "Disaster at Midland");
  assert.equal(col.scoreRule, "report", "a sim starts as a participation record");
  assert.equal(col.maxPoints, 0, "no points");
  assert.equal(col.categoryId, null, "no category");
  assert.ok(isParticipation(col));
  // adding it again changes nothing
  await addSimToClass(prof.id, sec.id, disaster.id);
  assert.equal((await listLineItems(sec.id)).filter((i) => i.refId === disaster.id).length, 1);
});

const col = () => simColumnsFor(sec.id).then((m) => m.get(disaster.id)!);

await t("a participation column is excluded from every total", async () => {
  const c = await col();
  await play(ada.id, disaster.id, sec.id, "student");
  const { students } = await gradebook(sec.id);
  const cell = cellOf(students, adaEnr.id, c.id);
  assert.ok(cell.completedAt, "the completion shows");
  assert.equal(cell.points, null, "but carries no score");
  assert.equal(totalOf(students, adaEnr.id), null, "and no total appears from it alone");
  assert.equal(students.find((s) => s.enrolmentId === adaEnr.id)!.graded, 0);
});

// ---------------------------------------------------------------- rule 2

await t("rule 2 — a student completion fills the cell; faculty and preview launches do not", async () => {
  await setSimRule(sec.id, (await col()).id, "completion");
  const c = await col();
  let gb = await gradebook(sec.id);
  assert.equal(cellOf(gb.students, adaEnr.id, c.id).points, DEFAULT_SIM_POINTS, "Ada played it");
  assert.equal(cellOf(gb.students, benEnr.id, c.id).points, null, "Ben has not");

  // a faculty play and a preview play, both in this class
  await play(prof.id, disaster.id, sec.id, "faculty");
  await play(prof.id, disaster.id, sec.id, "faculty_preview");
  gb = await gradebook(sec.id);
  assert.equal(gb.students.length, 2, "the roster is students only");
  assert.ok(!gb.students.some((s) => s.name === "Prof"), "a faculty completion never becomes a grade");

  // a completion with no class does not count
  const cal = await account("Cal", "cal@wright.edu");
  const calEnr = await enrol(sec.id, cal.id, "student");
  await play(cal.id, disaster.id, null, "student");
  gb = await gradebook(sec.id);
  assert.equal(cellOf(gb.students, calEnr.id, c.id).points, null, "a completion with no class scores nothing");
  await db().delete(enrolments).where(eq(enrolments.id, calEnr.id));
});

// ---------------------------------------------------------------- rules 3 and 4

await t("rule 3 — a sim added after students played it is already filled", async () => {
  // Ben plays The Ladder before it is ever added to the class
  await play(ben.id, ladder.id, sec.id, "student");
  assert.equal((await addSimToClass(prof.id, sec.id, ladder.id)).ok, true);
  const lcol = (await simColumnsFor(sec.id)).get(ladder.id)!;
  await setSimRule(sec.id, lcol.id, "completion");
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, benEnr.id, lcol.id).points, DEFAULT_SIM_POINTS, "backfilled with no extra step");
  assert.ok(cellOf(students, benEnr.id, lcol.id).completedAt);
  assert.equal(cellOf(students, adaEnr.id, lcol.id).points, null);
});

await t("rule 4 — a second completion does not change completion credit", async () => {
  const c = await col();
  const before = cellOf((await gradebook(sec.id)).students, adaEnr.id, c.id);
  await play(ada.id, disaster.id, sec.id, "student");   // she plays it again
  const after = cellOf((await gradebook(sec.id)).students, adaEnr.id, c.id);
  assert.equal(after.points, before.points);
  assert.equal(+after.completedAt!, +before.completedAt!, "the first completion is the one that counts");
  const all = await db().select().from(simCompletions)
    .where(and(eq(simCompletions.simId, disaster.id), eq(simCompletions.userId, ada.id)));
  assert.ok(all.length >= 2, "and both completions are still on record");
});

// ---------------------------------------------------------------- rules 5 and 6

await t("rule 5 — a faculty-typed score is never overwritten by a completion", async () => {
  const lcol = (await simColumnsFor(sec.id)).get(ladder.id)!;
  await setScore(lcol.id, adaEnr.id, 4);               // typed before Ada has played
  await play(ada.id, ladder.id, sec.id, "student");    // now she plays it
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, adaEnr.id, lcol.id).points, 4, "the typed mark stands");
  assert.ok(cellOf(students, adaEnr.id, lcol.id).completedAt, "and the completion is still recorded");
  // Ben's derived score is untouched by Ada's override
  assert.equal(cellOf(students, benEnr.id, lcol.id).points, DEFAULT_SIM_POINTS);
});

await t("rule 6 — under manual, completions create no score", async () => {
  const lcol = (await simColumnsFor(sec.id)).get(ladder.id)!;
  await setSimRule(sec.id, lcol.id, "manual");
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, benEnr.id, lcol.id).points, null, "Ben completed it but has no mark");
  assert.ok(cellOf(students, benEnr.id, lcol.id).completedAt, "the completion date still shows");
  assert.equal(cellOf(students, adaEnr.id, lcol.id).points, 4, "a typed mark still counts");
});

// ---------------------------------------------------------------- rule 7

await t("rule 7 — removing the sim from the class keeps the column and its scores", async () => {
  const c = await col();
  assert.equal((await removeSimFromClass(prof.id, sec.id, disaster.id)).ok, true);
  assert.ok(!(await simsForClass(sec.id, false)).some((x) => x.id === disaster.id), "no longer in the class");
  const still = (await listLineItems(sec.id)).find((i) => i.refId === disaster.id);
  assert.ok(still, "the column survives");
  assert.equal(still!.scoreRule, "completion", "with its rule");
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, adaEnr.id, c.id).points, DEFAULT_SIM_POINTS, "and its scores");
  await addSimToClass(prof.id, sec.id, disaster.id); // put it back for the rest
});

// ---------------------------------------------------------------- rule 8

await t("rule 8 — a graded sim column counts in Simulations and in the course grade", async () => {
  await applyStarterCategories(sec.id);
  const cats = await categoriesFor(sec.id);
  const simsCat = cats.find((c) => c.name === "Simulations")!;
  // switching to a graded rule moves it into Simulations
  const c = await col();
  await setSimRule(sec.id, c.id, "report");
  assert.equal((await col()).categoryId, null, "report takes it out of its category");
  await setSimRule(sec.id, c.id, "completion");
  assert.equal((await col()).categoryId, simsCat.id, "a graded sim lands in Simulations");

  // Ada: Simulations 100% (10/10 on Disaster). Nothing else graded, so the course grade rescales to it.
  const lcol = (await simColumnsFor(sec.id)).get(ladder.id)!;
  await setSimRule(sec.id, lcol.id, "report");         // keep the other one out of the way
  const { students } = await gradebook(sec.id);
  near(catPct(students, adaEnr.id, "Simulations"), 100);
  near(totalOf(students, adaEnr.id), 100);
  assert.equal(students.find((s) => s.enrolmentId === adaEnr.id)!.letter, "A");
});

await t("switching back to report takes it out of the totals and keeps typed marks", async () => {
  const lcol = (await simColumnsFor(sec.id)).get(ladder.id)!;
  // Ada has a typed 4 on The Ladder, which is now a participation column
  let gb = await gradebook(sec.id);
  assert.equal(cellOf(gb.students, adaEnr.id, lcol.id).points, null, "no score while it is a record");
  near(catPct(gb.students, adaEnr.id, "Simulations"), 100, "and it does not drag Simulations down");
  // the typed mark was kept, not deleted
  const kept = await db().select().from(lineItemScores)
    .where(and(eq(lineItemScores.lineItemId, lcol.id), eq(lineItemScores.enrolmentId, adaEnr.id)));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].points, 4);
  // and it reappears when the column is graded again
  await setSimRule(sec.id, lcol.id, "manual");
  gb = await gradebook(sec.id);
  assert.equal(cellOf(gb.students, adaEnr.id, lcol.id).points, 4, "the mark comes back");
  await setSimRule(sec.id, lcol.id, "report");
});

await t("points: default 10, editable, and refused while the column is a record", async () => {
  const c = await col();
  assert.equal(c.maxPoints, DEFAULT_SIM_POINTS);
  await setSimPoints(sec.id, c.id, 25);
  assert.equal((await col()).maxPoints, 25);
  const { students } = await gradebook(sec.id);
  assert.equal(cellOf(students, adaEnr.id, c.id).points, 25, "completion awards the new points in full");
  near(catPct(students, adaEnr.id, "Simulations"), 100);
  await assert.rejects(() => setSimPoints(sec.id, c.id, 0), /at least 1/);
  const lcol = (await simColumnsFor(sec.id)).get(ladder.id)!;
  await assert.rejects(() => setSimPoints(sec.id, lcol.id, 5), /grading rule/);
  await setSimPoints(sec.id, c.id, DEFAULT_SIM_POINTS);
});

// ---------------------------------------------------------------- rule 9

await t("rule 9 — only the class's faculty can change a sim's points or rule", async () => {
  const c = await col();
  const otherSec = await createSection(otherProf.id, "mis3000", "Theirs");
  // the guard is the section: another instructor's section id does not reach this column
  await assert.rejects(() => setSimRule(otherSec.id, c.id, "manual"), /No such column/);
  await assert.rejects(() => setSimPoints(otherSec.id, c.id, 50), /No such simulation column/);
  assert.equal((await col()).scoreRule, "completion", "unchanged");
  assert.equal((await col()).maxPoints, DEFAULT_SIM_POINTS, "unchanged");
  // and adding or removing a sim is faculty-only, as before
  assert.equal((await addSimToClass(ada.id, sec.id, ladder.id)).ok, false);
  assert.equal((await removeSimFromClass(ada.id, sec.id, disaster.id)).ok, false);
});

await t("a rule only applies to a sim column, and must be one of the three", async () => {
  const manual = (await listLineItems(sec.id)).find((i) => i.kind === "manual")
    ?? (await db().insert(lineItems).values({ sectionId: sec.id, kind: "manual", title: "Essay", maxPoints: 10 }).returning())[0];
  const simCol = await col();
  await assert.rejects(() => setSimRule(sec.id, manual.id, "completion"), /only applies to a simulation/);
  await assert.rejects(() => setSimRule(sec.id, simCol.id, "nonsense" as any), /Unknown rule/);
});

// ---------------------------------------------------------------- student view and export

await t("My grades shows participation apart from graded work", async () => {
  const g = await gradesForStudent(sec.id, adaEnr.id);
  assert.ok(g);
  const ladderRow = g!.participation.find((p) => p.title === "The Ladder");
  assert.ok(ladderRow, "The Ladder is listed as participation");
  assert.ok(ladderRow!.completedAt, "and Ada completed it");
  assert.ok(!g!.graded.some((x) => x.title === "The Ladder"), "never mixed into graded work");
  assert.ok(g!.graded.some((x) => x.title === "Disaster at Midland"), "the graded sim is graded work");
  // Ben has not played Disaster, so for him it is simply not yet graded
  const gb = await gradesForStudent(sec.id, benEnr.id);
  assert.ok(!gb!.graded.some((x) => x.title === "Disaster at Midland"));
  assert.ok(gb!.participation.some((p) => p.title === "The Ladder" && p.completedAt));
});

await t("the export carries participation as Completed or blank, and D2L stays per-item", async () => {
  const csv = await exportCsv(sec.id, "generic");
  const [header, ...rows] = csv.trim().split("\r\n");
  assert.ok(header.includes("The Ladder (participation)"), header);
  assert.ok(header.includes("Disaster at Midland / 10"), header);
  const adaRow = rows.find((r) => r.startsWith('"Ada"'))!;
  assert.ok(adaRow.includes('"Completed"'), adaRow);
  const benRow = rows.find((r) => r.startsWith('"Ben"'))!;
  assert.ok(benRow.includes('"Completed"'), "Ben completed The Ladder too");
  // canvas leaves a participation column's Points Possible blank
  const canvas = (await exportCsv(sec.id, "canvas")).split("\r\n");
  assert.ok(canvas[0].includes("The Ladder (participation)"), canvas[0]);
  // D2L carries no category or letter columns, per Spec 11
  const d2l = await exportCsv(sec.id, "d2l");
  assert.ok(!d2l.includes("Simulations (%)"), "D2L stays per-item");
  assert.ok(!d2l.includes("Letter"));
  assert.ok(d2l.includes("End-of-Line Indicator"));
});

await t("a sim column in a class with no Simulations category stays uncategorised", async () => {
  await setCategories(sec.id, [{ name: "Exams", weight: 100 }]);  // no Simulations category
  const c = await col();
  await setSimRule(sec.id, c.id, "report");
  await setSimRule(sec.id, c.id, "completion");
  assert.equal((await col()).categoryId, null, "nowhere to put it, so it waits for faculty");
  const { students } = await gradebook(sec.id);
  assert.equal(totalOf(students, adaEnr.id), null, "and it counts towards nothing until moved");
});

console.log(`\n${passed} passed`);
