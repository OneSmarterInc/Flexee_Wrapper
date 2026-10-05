// Integration test: Spec 22 §1 and rule 1 — retiring a book.
//
// The thing worth proving is not that a flag can be set. It is that retiring takes the book out of
// every picker and out of nothing else: a class already using it keeps working, the class lists
// still show its title rather than a raw id, and a student can still read it.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { listBooks } from "@/lib/content";
import { listBooksForPicker, retireBook, restoreBook, isRetired, retiredIds, retireCost, libraryShelf } from "@/lib/retire";
import { recordUpload, setDispatchFetch } from "@/lib/library";
import { enrolmentForBook } from "@/lib/enrolment";

const { users, identities, enrolments, sections, retiredBooks } = schema;

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
const stu = await account("Sam Student", "student@flexee.invalid");

// Two real books from the content tree, so this runs against what the library actually holds.
const BOOKS = (await listBooks()).map((b) => b.id);
assert.ok(BOOKS.includes("sad") && BOOKS.includes("mis3000"), `expected sad and mis3000, got ${BOOKS.join(", ")}`);

// A class on sad, with a student, and the book published so the student may read it.
const sec = await createSection(prof.id, "sad", "Spring Section A", "2027 Spring", { teach: true });
await db().insert(enrolments).values({ sectionId: sec.id, userId: stu.id, role: "student" });
await db().update(sections).set({ bookPublishedAt: new Date() }).where(eq(sections.id, sec.id));

console.log(`\n${BOOKS.length} books in the library: ${BOOKS.join(", ")}`);

await t("only an administrator can retire a book, or restore one", async () => {
  const no = await retireBook(prof.id, "sad");
  assert.deepEqual(no, { ok: false, error: "Only an administrator can retire or restore a book." });
  assert.equal(await isRetired("sad"), false, "the refusal must not have retired it anyway");

  assert.deepEqual(await retireBook(admin.id, "sad"), { ok: true });
  assert.equal(await isRetired("sad"), true);

  const noRestore = await restoreBook(prof.id, "sad");
  assert.equal(noRestore.ok, false);
  assert.equal(await isRetired("sad"), true, "a refused restore must leave it retired");
});

await t("a retired book is gone from every picker", async () => {
  const pickable = (await listBooksForPicker()).map((b) => b.id);
  assert.ok(!pickable.includes("sad"), pickable.join(", "));
  assert.ok(pickable.includes("mis3000"), "the other books are untouched");
});

await t("but listBooks still finds it, so a class on it still shows its title", async () => {
  // This is the whole reason the two functions are separate. The class lists build
  // `titles.get(c.bookId) ?? c.bookId`; if the retired book left this list, every class using it
  // would display the raw id "sad" where its title belongs.
  const all = await listBooks();
  const sad = all.find((b) => b.id === "sad");
  assert.ok(sad, "listBooks lost the retired book");
  assert.equal(sad!.title, "Analysis and Design of Information Systems");
});

await t("the panel that changes a class's book keeps that class's own book in the list", async () => {
  // Otherwise the select would quietly default to a different book, and the title beside it —
  // which comes from this same list — would fall back to the id.
  const keep = (await listBooksForPicker({ keep: "sad" })).map((b) => b.id);
  assert.ok(keep.includes("sad"), keep.join(", "));
  // and only that one: another retired book is still absent
  assert.deepEqual(await retireBook(admin.id, "mis3000"), { ok: true });
  const still = (await listBooksForPicker({ keep: "sad" })).map((b) => b.id);
  assert.ok(still.includes("sad") && !still.includes("mis3000"), still.join(", "));
  await restoreBook(admin.id, "mis3000");
});

await t("a class using a retired book keeps working, unchanged", async () => {
  // Access is resolved by id and never by a list, which is what makes retirement safe. Asserted
  // through the real predicate the nine student pages share.
  const enr = await enrolmentForBook(stu.id, "sad");
  assert.ok(enr, "the student lost access to a retired book");
  assert.equal(enr!.sectionId, sec.id);
  const row = (await db().select().from(sections).where(eq(sections.id, sec.id)))[0];
  assert.equal(row.bookId, "sad", "the class's book must not have moved");
  assert.ok(row.bookPublishedAt, "and must still be published to the class");
});

await t("an upload under a retired id is refused, and says to restore it first", async () => {
  setDispatchFetch(async () => new Response(null, { status: 204 }));
  const r = await recordUpload(admin.id, {
    bookId: "sad", blobPath: "uploads/sad/book.zip", fileName: "book.zip", sizeBytes: 1024,
  });
  assert.deepEqual(r, { ok: false, error: "This book is retired; restore it first." });
  // and the record was not written, so a refused upload leaves no trace
  const rows = await db().select().from(schema.libraryUploads);
  assert.equal(rows.length, 0, `${rows.length} upload records after a refusal`);
});

await t("the count is available before the act, and says the classes keep working", async () => {
  const one = await retireCost("sad");
  assert.equal(one.classes, 1);
  assert.equal(one.sentence, "1 class uses this book; they will keep working.");

  await createSection(prof.id, "sad", "Spring Section B", "2027 Spring", { teach: true });
  const two = await retireCost("sad");
  assert.equal(two.classes, 2);
  assert.equal(two.sentence, "2 classes use this book; they will keep working.");

  const none = await retireCost("mis3000");
  assert.equal(none.classes, 0);
  assert.equal(none.sentence, "No classes use this book.");
});

await t("the shelf separates live from retired, with each book's class count", async () => {
  const shelf = await libraryShelf();
  const sad = shelf.find((s) => s.book.id === "sad")!;
  const mis = shelf.find((s) => s.book.id === "mis3000")!;
  assert.ok(sad.retired, "sad should read as retired");
  assert.equal(sad.retired!.retiredBy, admin.id);
  assert.equal(sad.classes, 2);
  assert.equal(mis.retired, null);
  assert.equal(mis.classes, 0);
});

await t("Restore reverses it exactly, and retiring twice is not an error", async () => {
  assert.deepEqual(await retireBook(admin.id, "sad"), { ok: true }, "retiring an already-retired book");
  assert.equal((await db().select().from(retiredBooks)).length, 1, "and does not add a second row");

  assert.deepEqual(await restoreBook(admin.id, "sad"), { ok: true });
  assert.equal(await isRetired("sad"), false);
  assert.equal((await retiredIds()).size, 0);
  const pickable = (await listBooksForPicker()).map((b) => b.id);
  assert.ok(pickable.includes("sad"), "restore did not put it back in the pickers");
  // and an upload works again
  setDispatchFetch(async () => new Response(null, { status: 204 }));
  const r = await recordUpload(admin.id, {
    bookId: "sad", blobPath: "uploads/sad/book.zip", fileName: "book.zip", sizeBytes: 1024,
  });
  assert.equal(r.ok, true, "ok" in r ? "" : (r as { error: string }).error);
  // restoring one that was never retired is a no-op rather than a failure
  assert.deepEqual(await restoreBook(admin.id, "mis3000"), { ok: true });
});

await t("a book that is not in the library cannot be retired", async () => {
  const r = await retireBook(admin.id, "cyber123");
  assert.deepEqual(r, { ok: false, error: "That book is not in the library." });
  assert.equal((await retiredIds()).size, 0, "nothing was written");
});

console.log(`\n${passed} checks passed`);
