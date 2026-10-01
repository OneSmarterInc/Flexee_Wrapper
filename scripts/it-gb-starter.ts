// Integration test: the starter gradebook (lib/gradebook, applyGradebookStarter) — the editable
// floor a class begins with, per book. Imports the real function so the starter sets themselves are
// under test, not a copy of them.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyGradebookStarter, listLineItems, setWeight, addManualItem } from "@/lib/gradebook";

const { sections, lineItems } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

let n = 0;
async function section(bookId: string, name: string) {
  const [s] = await db().insert(sections).values({ bookId, name, joinCode: `GB${n++}` }).returning();
  return s;
}
const columns = (sectionId: string) =>
  db().select().from(lineItems).where(eq(lineItems.sectionId, sectionId));

await t("MIS 3000 starts with two 50/50 columns", async () => {
  const sec = await section("mis3000", "MIS");
  await applyGradebookStarter(sec.id, "mis3000");
  const cols = await columns(sec.id);
  assert.equal(cols.length, 2);
  assert.deepEqual(cols.map((c) => c.title).sort(), ["Book & exams", "Excel worksheets"]);
  assert.ok(cols.every((c) => c.weight === 1), "equal weights");
  assert.ok(cols.every((c) => c.maxPoints === 100), "out of 100");
  assert.ok(cols.every((c) => c.kind === "manual"), "manual columns faculty can edit");
  assert.deepEqual(cols.sort((a, b) => a.position - b.position).map((c) => c.title),
    ["Excel worksheets", "Book & exams"], "in the order the starter lists them");
});

await t("SAD starts with its book and its simulation", async () => {
  const sec = await section("sad", "SAD");
  await applyGradebookStarter(sec.id, "sad");
  const cols = await columns(sec.id);
  assert.equal(cols.length, 2);
  assert.deepEqual(cols.map((c) => c.title).sort(), ["Book", "MVCFN simulation"]);
});

await t("re-applying the starter changes nothing", async () => {
  const sec = await section("mis3000", "Twice");
  await applyGradebookStarter(sec.id, "mis3000");
  await applyGradebookStarter(sec.id, "mis3000");
  assert.equal((await columns(sec.id)).length, 2);
});

await t("a class that already has manual columns is never re-seeded", async () => {
  const sec = await section("mis3000", "Edited");
  await addManualItem(sec.id, "Faculty's own column", 50, 1);
  await applyGradebookStarter(sec.id, "mis3000");
  const cols = await columns(sec.id);
  assert.equal(cols.length, 1);
  assert.equal(cols[0].title, "Faculty's own column");
});

await t("faculty can re-weight a starter column", async () => {
  const sec = await section("mis3000", "Reweighted");
  await applyGradebookStarter(sec.id, "mis3000");
  const excel = (await columns(sec.id)).find((c) => c.title === "Excel worksheets")!;
  await setWeight(sec.id, excel.id, 3); // 75/25
  const after = (await columns(sec.id)).find((c) => c.id === excel.id)!;
  assert.equal(after.weight, 3);
});

await t("faculty can delete a starter column", async () => {
  const sec = await section("mis3000", "Pruned");
  await applyGradebookStarter(sec.id, "mis3000");
  const book = (await columns(sec.id)).find((c) => c.title === "Book & exams")!;
  await db().delete(lineItems).where(and(eq(lineItems.sectionId, sec.id), eq(lineItems.id, book.id)));
  assert.deepEqual((await columns(sec.id)).map((c) => c.title), ["Excel worksheets"]);
});

await t("a book with no starter set opens an empty gradebook for faculty to fill", async () => {
  const sec = await section("otherbook", "X");
  await applyGradebookStarter(sec.id, "otherbook");
  assert.equal((await columns(sec.id)).length, 0);
  assert.equal((await listLineItems(sec.id)).length, 0);
});

console.log(`\n${passed} passed`);
