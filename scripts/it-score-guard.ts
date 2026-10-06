// Integration test: Spec 23's first code commit — what a score may be, and which columns accept a
// typed one.
//
// The NaN case is the reason this exists. Before it, the gradebook's score box was a plain text
// input and the action did Number(raw) behind only a non-empty guard, so typing "abc" into one cell
// stored NaN — and because a course total is a weighted mean over the cells, that one keystroke
// turned the student's whole course total into NaN. Reproduced here, then held shut.
import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection, canGradeSection, gradableSection } from "@/lib/roster";
import { setScore, cleanPoints, ScoreRefused, acceptsHandEntry, handEntryRefusal,
         gradebook, listLineItems, addManualItem, setCategories, categoriesFor,
         setSimRule } from "@/lib/gradebook";

const { users, identities, enrolments, sections, lineItems, lineItemScores, sims, classSims,
        exams, examAttempts, assignments } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}

const admin = await account("Ada Admin", "admin@flexee.invalid");
await setAdminByEmail("admin@flexee.invalid");
const prof = await account("Pat Professor", "prof@flexee.invalid");
const other = await account("Other Professor", "prof2@flexee.invalid");
const stu = await account("Sam Student", "student@flexee.invalid");

const sec = await createSection(prof.id, "sad", "Spring Section A", "2027 Spring", { teach: true });
const [enr] = await db().insert(enrolments)
  .values({ sectionId: sec.id, userId: stu.id, role: "student" }).returning();
await db().update(sections).set({ bookPublishedAt: new Date() }).where(eq(sections.id, sec.id));

// One manual column of its own, with a known maximum.
await addManualItem(sec.id, "Studio session", 10, 1);
const manual = (await listLineItems(sec.id)).find((i) => i.title === "Studio session")!;
console.log(`\na manual column out of ${manual.maxPoints}`);

const pointsOf = async (lineItemId: string) =>
  (await db().select().from(lineItemScores)
    .where(and(eq(lineItemScores.lineItemId, lineItemId), eq(lineItemScores.enrolmentId, enr.id))).limit(1))[0]?.points ?? null;

// --------------------------------------------------------------------------- what a score may be

await t("cleanPoints rounds to two decimals and refuses what cannot be a score", () => {
  assert.equal(cleanPoints(8), 8);
  assert.equal(cleanPoints(0), 0);
  assert.equal(cleanPoints(10.5551), 10.56);
  assert.equal(cleanPoints(10.555), 10.56);
  assert.equal(cleanPoints(7.004), 7);
  // over the maximum is a decision for the caller, not for the cleaner (decision 2)
  assert.equal(cleanPoints(150), 150);
  for (const bad of [NaN, Infinity, -Infinity, -0.01, -4]) {
    assert.equal(cleanPoints(bad), null, String(bad));
  }
});

await t("setScore refuses NaN, and the course total survives it", async () => {
  await setScore(manual.id, enr.id, 8);
  const before = (await gradebook(sec.id)).students[0];
  assert.equal(before.cells[manual.id].points, 8);
  assert.equal(before.total, 80);

  // The exact call the old action made for a cell containing "abc".
  await assert.rejects(() => setScore(manual.id, enr.id, Number("abc")), ScoreRefused);

  const after = (await gradebook(sec.id)).students[0];
  assert.equal(after.cells[manual.id].points, 8, "the refused write changed the cell");
  assert.equal(after.total, 80, "the course total moved");
  assert.ok(!Number.isNaN(after.total!), "the course total is NaN — the bug is back");
});

await t("setScore refuses a negative score, and Infinity", async () => {
  for (const bad of [-1, -0.5, Infinity, -Infinity]) {
    await assert.rejects(() => setScore(manual.id, enr.id, bad), ScoreRefused, String(bad));
  }
  assert.equal(await pointsOf(manual.id), 8, "one of them was written anyway");
});

await t("setScore allows over the maximum, because bonus marks are deliberate", async () => {
  await setScore(manual.id, enr.id, 12);
  assert.equal(await pointsOf(manual.id), 12);
  assert.equal((await gradebook(sec.id)).students[0].total, 120);
  await setScore(manual.id, enr.id, 8);        // put it back for the checks below
});

await t("a stored score is rounded on the way in, not on the way out", async () => {
  await setScore(manual.id, enr.id, 7.129);
  assert.equal(await pointsOf(manual.id), 7.13, "the row kept full float precision");
  await setScore(manual.id, enr.id, 8);
});

// ------------------------------------------------------------- which columns accept a typed score

await t("a manual column accepts a typed score", () => {
  assert.equal(handEntryRefusal(manual), null);
  assert.equal(acceptsHandEntry(manual), true);
});

await t("an exam column does not, and says it is calculated from the attempts", async () => {
  const [exam] = await db().insert(exams).values({
    sectionId: sec.id, title: "Chapter 1 quiz", status: "open", feedback: "after_close", attemptLimit: 1,
    blueprintJson: JSON.stringify({ mode: "fixed", ids: [] }),
  }).returning();
  await db().insert(examAttempts).values({
    examId: exam.id, enrolmentId: enr.id, servedJson: "[]", maxPoints: 20, score: 12, submittedAt: new Date(),
  });
  const item = (await listLineItems(sec.id)).find((i) => i.kind === "exam")!;
  assert.equal(acceptsHandEntry(item), false);
  assert.equal(handEntryRefusal(item), "Calculated from the exam's attempts.");
});

await t("an assignment column does not, and says it comes from the submission", async () => {
  const [a] = await db().insert(assignments).values({
    sectionId: sec.id, title: "Worksheet 1", points: 10, createdBy: prof.id, published: true,
  }).returning();
  await db().insert(lineItems).values({
    sectionId: sec.id, kind: "assignment", refId: a.id, title: a.title, maxPoints: a.points, weight: 1,
  });
  const item = (await listLineItems(sec.id)).find((i) => i.kind === "assignment")!;
  assert.equal(acceptsHandEntry(item), false);
  assert.equal(handEntryRefusal(item), "Comes from the submission's grade.");
});

await t("a simulation column follows its rule, with the exact wording for completion", async () => {
  await db().insert(sims).values({ id: "mvcfn2", title: "MVCFN II", launchUrl: "https://x.invalid", published: true });
  await db().insert(classSims).values({ sectionId: sec.id, simId: "mvcfn2", addedBy: prof.id });
  const [col] = await db().insert(lineItems).values({
    sectionId: sec.id, kind: "sim", refId: "mvcfn2", title: "MVCFN II", maxPoints: 0, weight: 1, scoreRule: "report",
  }).returning();

  // report: a participation record, no score at all
  assert.equal(acceptsHandEntry({ kind: "sim", scoreRule: "report" }), false);
  assert.equal(handEntryRefusal({ kind: "sim", scoreRule: "report" }), "A participation record carries no score.");
  // the default when the column has none recorded is report, not an accident
  assert.equal(acceptsHandEntry({ kind: "sim", scoreRule: null }), false);

  // completion: the one the page used to let faculty type into (decision 1)
  await setSimRule(sec.id, col.id, "completion");
  const completion = (await listLineItems(sec.id)).find((i) => i.id === col.id)!;
  assert.equal(acceptsHandEntry(completion), false);
  assert.equal(handEntryRefusal(completion),
    "Calculated from completion. Change the rule to 'faculty marks' to enter scores.");

  // faculty marks: yes
  await setSimRule(sec.id, col.id, "manual");
  const marked = (await listLineItems(sec.id)).find((i) => i.id === col.id)!;
  assert.equal(acceptsHandEntry(marked), true);
  assert.equal(handEntryRefusal(marked), null);
});

await t("every column in the class is classified, with no silent default", async () => {
  const items = await listLineItems(sec.id);
  assert.ok(items.length >= 4, `${items.length} columns`);
  for (const it of items) {
    const no = handEntryRefusal(it);
    assert.ok(no === null || (typeof no === "string" && no.length > 10), `${it.kind}: ${no}`);
    assert.equal(acceptsHandEntry(it), no === null);
  }
  const kinds = [...new Set(items.map((i) => i.kind))].sort();
  console.log(`      ${items.length} columns across ${kinds.join(", ")}`);
});

// ------------------------------------------------------------------------------- who may grade it

await t("canGradeSection admits the class's faculty and any admin, and nobody else", async () => {
  assert.equal(await canGradeSection(prof.id, sec.id), true, "the class's faculty");
  assert.equal(await canGradeSection(admin.id, sec.id), true, "an administrator");
  assert.equal(await canGradeSection(other.id, sec.id), false, "another class's faculty");
  assert.equal(await canGradeSection(stu.id, sec.id), false, "a student in the class");
});

await t("gradableSection gives the class back, so a page can name it", async () => {
  assert.equal((await gradableSection(prof.id, sec.id))?.name, "Spring Section A");
  assert.equal((await gradableSection(admin.id, sec.id))?.name, "Spring Section A");
  assert.equal(await gradableSection(other.id, sec.id), null);
  assert.equal(await gradableSection(admin.id, "11111111-2222-3333-4444-555555555555"), null);
});

// ---------------------------------------------------------- a column created with a category

await t("addManualItem takes a category, and still works without one", async () => {
  await setCategories(sec.id, [{ name: "Studio", weight: 60 }, { name: "Exams", weight: 40 }]);
  const cats = await categoriesFor(sec.id);
  const studio = cats.find((c) => c.name === "Studio")!;

  const withCat = await addManualItem(sec.id, "Studio 2", 20, 1, studio.id);
  assert.equal(withCat.categoryId, studio.id);
  assert.equal(withCat.maxPoints, 20);
  assert.equal(withCat.kind, "manual");

  const without = await addManualItem(sec.id, "Studio 3", 5, 1);
  assert.equal(without.categoryId, null, "an uncategorised column is still the default");
});

console.log(`\n${passed} checks passed`);
