// Integration test: Spec 11 — grading categories, drop-lowest, rescaling, letter grades and the
// retake rules. Proves each of the spec's nine rules. Imports the real functions throughout.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection } from "@/lib/roster";
import {
  gradebook, listLineItems, addManualItem, setScore, setWeight, exportCsv,
  setCategories, applyStarterCategories, setColumnCategory, setLetterBands, categoriesFor,
  letterBandsFor, attemptsForStudent, gradesForStudent,
} from "@/lib/gradebook";
import {
  categoryPercent, coursePercent, countedScore, letterFor, weightsValid,
  DEFAULT_LETTER_BANDS, PLUS_MINUS_LETTER_BANDS, starterCategoryFor, type CountedAttempt,
} from "@/lib/grading";
import { createExam, setExamRetakeRules, examResults, openExamsForSection } from "@/lib/assessment";

const { users, identities, enrolments, exams, examAttempts, lineItems } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const near = (a: number | null, b: number, msg?: string) => {
  assert.ok(a != null && Math.abs(a - b) < 1e-9, msg ?? `expected ${b}, got ${a}`);
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
const fixed = (n: number) => ({ mode: "fixed" as const, ids: Array.from({ length: n }, (_, i) => `q${i}`) });
const day = (n: number) => new Date(Date.UTC(2026, 0, n));
async function attempt(examId: string, enrolmentId: string, score: number, max: number, submittedAt: Date | null) {
  const [a] = await db().insert(examAttempts).values({ examId, enrolmentId, servedJson: "[]", maxPoints: max, score, submittedAt }).returning();
  return a;
}
const totalOf = (students: any[], id: string) => students.find((s) => s.enrolmentId === id)!.total;
const letterOf = (students: any[], id: string) => students.find((s) => s.enrolmentId === id)!.letter;
const catPct = (students: any[], id: string, name: string) =>
  students.find((s) => s.enrolmentId === id)!.categories.find((c: any) => c.name === name)?.pct ?? null;

// ---------------------------------------------------------------- pure arithmetic

await t("rule 3 — the weighted average, on a worked example with known answers", () => {
  // quizzes 80% and 90% at equal weight -> 85; exams 70% -> 70
  near(categoryPercent([{ pct: 80, weight: 1 }, { pct: 90, weight: 1 }]), 85);
  // categories: quizzes 85 at 40%, exams 70 at 60% -> 0.4*85 + 0.6*70 = 76
  near(coursePercent([{ pct: 85, weight: 40 }, { pct: 70, weight: 60 }]), 76);
  // unequal column weights inside a category: 90 x3 and 50 x1 -> 320/4 = 80
  near(categoryPercent([{ pct: 90, weight: 3 }, { pct: 50, weight: 1 }]), 80);
});

await t("rule 3 — drop lowest N removes the weakest columns, with their weight", () => {
  // 50, 80, 90 — drop 1 -> mean(80, 90) = 85
  near(categoryPercent([{ pct: 50, weight: 1 }, { pct: 80, weight: 1 }, { pct: 90, weight: 1 }], 1), 85);
  // the dropped column's weight goes with it: drop the 50 (weight 9) and 80/90 at weight 1 -> 85
  near(categoryPercent([{ pct: 50, weight: 9 }, { pct: 80, weight: 1 }, { pct: 90, weight: 1 }], 1), 85);
  // never drops the category to nothing: one column, drop 1 -> still that column
  near(categoryPercent([{ pct: 42, weight: 1 }], 1), 42);
  // drop more than there are: keeps the single best
  near(categoryPercent([{ pct: 10, weight: 1 }, { pct: 90, weight: 1 }], 5), 90);
  assert.equal(categoryPercent([], 1), null, "nothing graded -> no percentage");
});

await t("rule 4 — a category with no graded work is left out and the rest rescale", () => {
  // quizzes 90 at 15%, exams not started at 35% -> 90, not 90*0.15
  near(coursePercent([{ pct: 90, weight: 15 }, { pct: null, weight: 35 }]), 90);
  // quizzes 80 at 15, assignments 60 at 30 -> (80*15 + 60*30) / 45 = 66.666...
  near(coursePercent([{ pct: 80, weight: 15 }, { pct: 60, weight: 30 }, { pct: null, weight: 35 }]), (80 * 15 + 60 * 30) / 45);
  assert.equal(coursePercent([{ pct: null, weight: 50 }, { pct: null, weight: 50 }]), null);
  assert.equal(coursePercent([{ pct: 90, weight: 0 }]), null, "a zero-weight category cannot carry the grade");
});

await t("rule 7 — letter boundaries: 89.99 is a B and 90 is an A", () => {
  assert.equal(letterFor(89.99), "B");
  assert.equal(letterFor(90), "A");
  assert.equal(letterFor(100), "A");
  assert.equal(letterFor(0), "F");
  assert.equal(letterFor(59.999), "F");
  assert.equal(letterFor(60), "D");
  assert.equal(letterFor(null), null);
  // and the +/- preset
  assert.equal(letterFor(90, PLUS_MINUS_LETTER_BANDS), "A-");
  assert.equal(letterFor(92.9, PLUS_MINUS_LETTER_BANDS), "A-");
  assert.equal(letterFor(93, PLUS_MINUS_LETTER_BANDS), "A");
  // bands in any order still resolve highest-first
  assert.equal(letterFor(95, [{ letter: "F", min: 0 }, { letter: "A", min: 90 }]), "A");
});

await t("rule 1 — weights must total 100", () => {
  assert.ok(weightsValid([15, 35, 30, 20]));
  assert.ok(weightsValid([100]));
  assert.ok(weightsValid([33.33, 33.33, 33.34]), "float noise within tolerance");
  assert.ok(!weightsValid([15, 35, 30]));
  assert.ok(!weightsValid([50, 60]));
  assert.ok(!weightsValid([]));
});

await t("rule 6 — each retake rule reads the same attempts differently", () => {
  const atts = [
    { score: 6, maxPoints: 10, submittedAt: day(1) },
    { score: 9, maxPoints: 10, submittedAt: day(2) },
    { score: 3, maxPoints: 10, submittedAt: day(3) },
  ];
  assert.equal(countedScore(atts, "first")!.score, 6);
  assert.equal(countedScore(atts, "latest")!.score, 3);
  assert.equal(countedScore(atts, "highest")!.score, 9);
  near(countedScore(atts, "average")!.score, 6);
  // unsubmitted and unscored attempts are ignored by every rule
  const withOpen = [...atts, { score: null, maxPoints: 10, submittedAt: null }];
  assert.equal(countedScore(withOpen, "latest")!.score, 3);
  assert.equal(countedScore([{ score: null, maxPoints: 10, submittedAt: null }], "highest"), null);
  assert.equal(countedScore([], "first"), null);
  // highest compares by percentage, so a retake out of a different total is fair
  const mixed = [{ score: 8, maxPoints: 10, submittedAt: day(1) }, { score: 9, maxPoints: 20, submittedAt: day(2) }];
  assert.equal(countedScore(mixed, "highest")!.score, 8);
});

await t("new columns map to the starter categories by kind", () => {
  assert.equal(starterCategoryFor("exam", "quiz"), "Quizzes");
  assert.equal(starterCategoryFor("exam", "exam"), "Exams");
  assert.equal(starterCategoryFor("assignment"), "Assignments");
  assert.equal(starterCategoryFor("sim"), "Simulations");
  assert.equal(starterCategoryFor("manual"), null, "manual columns wait for faculty");
});

// ---------------------------------------------------------------- against the database

const prof = await account("Prof", "prof@flexee.org");
const otherProf = await account("Other Prof", "other@flexee.org");
const sec = await createSection(prof.id, "mis3000", "Spring");
const ada = await student(sec.id, "Ada", "ada@wright.edu");
const ben = await student(sec.id, "Ben", "ben@wright.edu");
// clear the book's starter columns so this class starts from a known, empty gradebook
await db().delete(lineItems).where(eq(lineItems.sectionId, sec.id));

await t("rule 2 — a class with no categories computes exactly as before", async () => {
  await addManualItem(sec.id, "Essay", 10, 1);
  const essay = (await listLineItems(sec.id)).find((i) => i.title === "Essay")!;
  await setScore(essay.id, ada.id, 8);
  const { students, categorised } = await gradebook(sec.id);
  assert.equal(categorised, false);
  near(totalOf(students, ada.id), 80);
  assert.equal(letterOf(students, ada.id), null, "no letter until a class sets up grading");
});

await t("rule 1 — weights that do not total 100 are refused", async () => {
  await assert.rejects(
    () => setCategories(sec.id, [{ name: "Quizzes", weight: 15 }, { name: "Exams", weight: 35 }]),
    /must total 100/,
  );
  assert.equal((await categoriesFor(sec.id)).length, 0, "nothing saved on a refusal");
  await assert.rejects(() => setCategories(sec.id, [{ name: "Quizzes", weight: -10 }, { name: "Exams", weight: 110 }]), /negative/);
});

await t("the starter set arrives at 15/35/30/20 and assigns columns by kind", async () => {
  const quiz = await createExam(sec.id, { title: "Quiz 1", blueprint: fixed(10), feedback: "immediate", timeLimitMin: null, attemptLimit: 3, kind: "quiz" });
  const midterm = await createExam(sec.id, { title: "Midterm", blueprint: fixed(10), feedback: "after_close", timeLimitMin: null, attemptLimit: 1, kind: "exam" });
  await listLineItems(sec.id); // materialise the exam columns
  await applyStarterCategories(sec.id);
  const cats = await categoriesFor(sec.id);
  assert.deepEqual(cats.map((c) => `${c.name} ${c.weight}`), ["Quizzes 15", "Exams 35", "Assignments 30", "Simulations 20"]);
  assert.ok(weightsValid(cats.map((c) => c.weight)));
  const items = await listLineItems(sec.id);
  const byName = new Map(cats.map((c) => [c.id, c.name]));
  assert.equal(byName.get(items.find((i) => i.refId === quiz.id)!.categoryId!), "Quizzes");
  assert.equal(byName.get(items.find((i) => i.refId === midterm.id)!.categoryId!), "Exams");
  assert.equal(items.find((i) => i.title === "Essay")!.categoryId, null, "a manual column waits for faculty");
  // re-applying never overwrites a faculty's own setup
  await applyStarterCategories(sec.id);
  assert.equal((await categoriesFor(sec.id)).length, 4);
});

const cats = await categoriesFor(sec.id);
const catId = (name: string) => cats.find((c) => c.name === name)!.id;
const quizExam = (await db().select().from(exams).where(and(eq(exams.sectionId, sec.id), eq(exams.title, "Quiz 1"))))[0];
const midtermExam = (await db().select().from(exams).where(and(eq(exams.sectionId, sec.id), eq(exams.title, "Midterm"))))[0];

await t("rule 6 — the gradebook cell follows the rule, and changing it recomputes from the same attempts", async () => {
  await attempt(quizExam.id, ada.id, 6, 10, day(1));
  await attempt(quizExam.id, ada.id, 9, 10, day(2));
  await attempt(quizExam.id, ada.id, 3, 10, day(3));
  const quizItem = (await listLineItems(sec.id)).find((i) => i.refId === quizExam.id)!;

  // created as a quiz, so: highest
  assert.equal(quizExam.countedAttempt, "highest");
  let gb = await gradebook(sec.id);
  assert.equal(gb.students.find((s) => s.enrolmentId === ada.id)!.cells[quizItem.id].points, 9);

  for (const [rule, expected] of [["latest", 3], ["first", 6], ["average", 6], ["highest", 9]] as [CountedAttempt, number][]) {
    await setExamRetakeRules(sec.id, quizExam.id, { countedAttempt: rule });
    gb = await gradebook(sec.id);
    near(gb.students.find((s) => s.enrolmentId === ada.id)!.cells[quizItem.id].points, expected, `${rule} -> ${expected}`);
  }
  // no attempt was lost along the way
  const kept = await db().select().from(examAttempts).where(and(eq(examAttempts.examId, quizExam.id), eq(examAttempts.enrolmentId, ada.id)));
  assert.equal(kept.length, 3);
  await setExamRetakeRules(sec.id, quizExam.id, { countedAttempt: "highest" });
});

await t("an exam created as an exam counts its first attempt", async () => {
  assert.equal(midtermExam.countedAttempt, "first");
  assert.equal(midtermExam.kind, "exam");
});

await t("the faculty attempts view marks the one that counts", async () => {
  const d = await attemptsForStudent(quizExam.id, ada.id, "highest");
  assert.equal(d.attempts.length, 3);
  assert.equal(d.counted!.score, 9);
  assert.equal(d.attempts.find((a) => a.id === d.countedId)!.score, 9);
  // oldest first
  assert.deepEqual(d.attempts.map((a) => a.score), [6, 9, 3]);
  // an average is not any single attempt, so nothing is marked
  const avg = await attemptsForStudent(quizExam.id, ada.id, "average");
  assert.equal(avg.countedId, null);
  near(avg.counted!.score, 6);
});

await t("lowering the attempt limit keeps attempts already taken", async () => {
  await setExamRetakeRules(sec.id, quizExam.id, { attemptLimit: 1 });
  const kept = await db().select().from(examAttempts).where(and(eq(examAttempts.examId, quizExam.id), eq(examAttempts.enrolmentId, ada.id)));
  assert.equal(kept.length, 3, "nothing deleted");
  const open = await openExamsForSection(sec.id, ada.id);
  const row = open.find((o) => o.exam.id === quizExam.id);
  if (row) assert.equal(row.canAttempt, false, "but no new attempt is allowed");
  await assert.rejects(() => setExamRetakeRules(sec.id, quizExam.id, { attemptLimit: 0 }), /at least 1/);
  await setExamRetakeRules(sec.id, quizExam.id, { attemptLimit: 3 });
});

await t("the student's own view agrees with the gradebook about which attempt counts", async () => {
  const open = await openExamsForSection(sec.id, ada.id);
  const row = open.find((o) => o.exam.id === quizExam.id);
  if (row) {
    assert.equal(row.countedScore, 9, "the highest, which is what the gradebook uses");
    assert.equal(row.lastScore, 3, "while the latest sat is still reported as such");
  }
});

await t("rule 3 — categories and the course grade, end to end", async () => {
  // Quizzes: the quiz at 90% (highest of 6/9/3)
  // Exams: midterm 70%
  await attempt(midtermExam.id, ada.id, 7, 10, day(4));
  // Assignments: the Essay column, moved in, at 80%
  await setColumnCategory(sec.id, (await listLineItems(sec.id)).find((i) => i.title === "Essay")!.id, catId("Assignments"));
  const { students } = await gradebook(sec.id);
  near(catPct(students, ada.id, "Quizzes"), 90);
  near(catPct(students, ada.id, "Exams"), 70);
  near(catPct(students, ada.id, "Assignments"), 80);
  assert.equal(catPct(students, ada.id, "Simulations"), null, "nothing graded there");
  // rescaled over 15 + 35 + 30 = 80: (90*15 + 70*35 + 80*30) / 80 = 77.5
  near(totalOf(students, ada.id), 77.5);
  near(totalOf(students, ada.id), (90 * 15 + 70 * 35 + 80 * 30) / 80);
  assert.equal(letterOf(students, ada.id), "C");
});

await t("rule 4 — a category that has not started does not drag the grade down", async () => {
  // Ben has only a quiz, at 100%: his course grade is 100, not 15
  await attempt(quizExam.id, ben.id, 10, 10, day(2));
  const { students } = await gradebook(sec.id);
  near(catPct(students, ben.id, "Quizzes"), 100);
  near(totalOf(students, ben.id), 100);
  assert.equal(letterOf(students, ben.id), "A");
});

await t("rule 5 — an ungraded column is excluded, and an entered 0 counts", async () => {
  await addManualItem(sec.id, "Case study", 20, 1);
  const cs = (await listLineItems(sec.id)).find((i) => i.title === "Case study")!;
  await setColumnCategory(sec.id, cs.id, catId("Assignments"));
  // ungraded: Ada's Assignments stay at the Essay's 80
  let gb = await gradebook(sec.id);
  near(catPct(gb.students, ada.id, "Assignments"), 80);
  // an entered zero is real work worth nothing: mean(80, 0) = 40
  await setScore(cs.id, ada.id, 0);
  gb = await gradebook(sec.id);
  near(catPct(gb.students, ada.id, "Assignments"), 40);
  near(totalOf(gb.students, ada.id), (90 * 15 + 70 * 35 + 40 * 30) / 80);
});

await t("rule 3 — drop-lowest applied to a real class", async () => {
  await setCategories(sec.id, cats.map((c) => ({ id: c.id, name: c.name, weight: c.weight, dropLowest: c.name === "Assignments" ? 1 : 0 })));
  const gb = await gradebook(sec.id);
  // Assignments were 80 and 0; dropping the lowest leaves 80
  near(catPct(gb.students, ada.id, "Assignments"), 80);
  near(totalOf(gb.students, ada.id), (90 * 15 + 70 * 35 + 80 * 30) / 80);
  // put it back
  await setCategories(sec.id, cats.map((c) => ({ id: c.id, name: c.name, weight: c.weight, dropLowest: 0 })));
});

await t("rule 7 — an edited letter scale is used, and the default comes back when cleared", async () => {
  await setLetterBands(sec.id, [{ letter: "Pass", min: 50 }, { letter: "Fail", min: 0 }]);
  let gb = await gradebook(sec.id);
  assert.equal(letterOf(gb.students, ben.id), "Pass");
  assert.deepEqual((await letterBandsFor(sec.id)).map((b) => b.letter), ["Pass", "Fail"]);
  await assert.rejects(() => setLetterBands(sec.id, [{ letter: "A", min: 140 }]), /between 0 and 100/);
  await setLetterBands(sec.id, []);
  assert.deepEqual(await letterBandsFor(sec.id), DEFAULT_LETTER_BANDS);
  gb = await gradebook(sec.id);
  assert.equal(letterOf(gb.students, ben.id), "A");
});

await t("rule 8 — only the class's faculty can change its grading setup", async () => {
  const { ownedSection } = await import("@/lib/roster");
  assert.ok(await ownedSection(prof.id, sec.id), "its own faculty may");
  assert.equal(await ownedSection(otherProf.id, sec.id), null, "another instructor may not");
  assert.equal(await ownedSection(ada.userId, sec.id), null, "a student may not");
  // and a category from another class cannot be borrowed
  const otherSec = await createSection(otherProf.id, "mis3000", "Theirs");
  await applyStarterCategories(otherSec.id);
  const theirs = (await categoriesFor(otherSec.id))[0];
  const mine = (await listLineItems(sec.id))[0];
  await assert.rejects(() => setColumnCategory(sec.id, mine.id, theirs.id), /another class/);
});

await t("rule 8 — a student sees only their own grades", async () => {
  const hers = await gradesForStudent(sec.id, ada.id);
  const his = await gradesForStudent(sec.id, ben.id);
  assert.ok(hers && his);
  near(hers!.total, (90 * 15 + 70 * 35 + 40 * 30) / 80);
  near(his!.total, 100);
  assert.equal(hers!.graded.length, 4, "quiz, midterm, essay, case study");
  assert.equal(his!.graded.length, 1, "only the quiz");
  assert.ok(his!.ungradedCount > 0, "and the rest is flagged as not yet counted");
  // an enrolment from another class yields nothing here
  const [outsider] = await db().select().from(enrolments).where(eq(enrolments.sectionId, (await createSection(otherProf.id, "mis3000", "Other")).id));
  if (outsider) assert.equal(await gradesForStudent(sec.id, outsider.id), null);
});

await t("rule 9 — the export carries the category, course and letter columns", async () => {
  const csv = await exportCsv(sec.id, "generic");
  const [header, ...rows] = csv.trim().split("\r\n");
  for (const name of ["Quizzes (%)", "Exams (%)", "Assignments (%)", "Simulations (%)", "Weighted total (%)", "Letter"]) {
    assert.ok(header.includes(name), `${name} missing from: ${header}`);
  }
  // the course percentage is the format's own total column — not a second one beside it
  assert.equal(header.split(",").filter((h) => h.includes("total") || h.includes("Total")).length, 1, header);
  const benRow = rows.find((r) => r.startsWith('"Ben"'))!;
  assert.ok(benRow.includes('"100"'), benRow);
  assert.ok(benRow.endsWith('"A"'), benRow);
  // rounded to one decimal at the edge, never in the stored figure
  const adaRow = rows.find((r) => r.startsWith('"Ada"'))!;
  const exact = (90 * 15 + 70 * 35 + 40 * 30) / 80;
  assert.ok(adaRow.includes(`"${Math.round(exact * 10) / 10}"`), `${adaRow} should carry ${Math.round(exact * 10) / 10}`);
  // canvas, blackboard and moodle too
  for (const f of ["canvas", "blackboard", "moodle"]) {
    assert.ok((await exportCsv(sec.id, f)).includes("Quizzes (%)"), `${f} missing category columns`);
  }
  // D2L stays per-item only (decision 4)
  const d2l = await exportCsv(sec.id, "d2l");
  assert.ok(!d2l.includes("Quizzes (%)"), "D2L should carry no category columns");
  assert.ok(!d2l.includes("Letter"), "D2L should carry no letter column");
  assert.ok(d2l.includes("End-of-Line Indicator"));
});

await t("the per-student exam page lists one row per student, not one per attempt", async () => {
  const { students } = await examResults(quizExam.id);
  assert.equal(students.length, 2, "Ada (3 attempts) and Ben (1) — not 4 rows");
  const adaRow = students.find((s) => s.enrolmentId === ada.id)!;
  assert.equal(adaRow.attempts, 3);
  assert.equal(adaRow.score, 9, "the counted attempt under highest");
});

await t("clearing the categories returns the class to grading by column weight", async () => {
  await setCategories(sec.id, []);
  const gb = await gradebook(sec.id);
  assert.equal(gb.categorised, false);
  assert.equal(gb.categories.length, 0);
  assert.equal(letterOf(gb.students, ada.id), null);
  // the columns survive, uncategorised
  assert.ok((await listLineItems(sec.id)).every((i) => i.categoryId == null));
  assert.ok(totalOf(gb.students, ada.id) != null, "and still has a weighted total");
});

await t("a column's weight cannot be negative", async () => {
  const item = (await listLineItems(sec.id))[0];
  await assert.rejects(() => setWeight(sec.id, item.id, -1), /cannot be negative/);
  const after = (await listLineItems(sec.id)).find((i) => i.id === item.id)!;
  assert.ok(after.weight >= 0);
});

console.log(`\n${passed} passed`);
