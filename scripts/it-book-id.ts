// Integration test: Spec 22 §3 and rule 4 — a catalog-shaped id is displayed in capitals, and the
// stored id is unchanged.
//
// The pure function is the easy half. The half worth rendering is the library page, because the
// rule is about what a reader sees: the capitals have to appear in the markup while every value
// a form posts back, and every row in the database, stays lower-case.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { displayBookId, isCatalogShaped, looksDoubleZipped } from "@/lib/book-id";

const { users, identities, sessions, libraryUploads } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

await t("a catalog-shaped id is shown in capitals", () => {
  assert.equal(displayBookId("fz1003"), "FZ1003");
  assert.equal(displayBookId("fz1001"), "FZ1001");
  assert.equal(displayBookId("ab0000"), "AB0000");
  for (const id of ["fz1003", "ab0000"]) assert.equal(isCatalogShaped(id), true, id);
});

await t("every other id is shown exactly as it is stored", () => {
  // Capitalising these would invent a convention they do not follow — "SAD" reads as an acronym
  // the book does not use, and "MIS3000" is a course code, which is the thing catalog numbers
  // exist to stop using.
  for (const id of ["sad", "mis3000", "mis4950", "cyber123", "fz103", "fz10033", "f1003"]) {
    assert.equal(displayBookId(id), id, id);
    assert.equal(isCatalogShaped(id), false, id);
  }
});

await t("it is total: null, undefined and an empty id do not throw", () => {
  assert.equal(displayBookId(null), "");
  assert.equal(displayBookId(undefined), "");
  assert.equal(displayBookId(""), "");
});

// --------------------------------------------------- the real page, with a catalog-shaped id

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}

const admin = await account("Ada Admin", "admin@flexee.invalid");
await setAdminByEmail("admin@flexee.invalid");
const [sess] = await db().insert(sessions)
  .values({ id: "sess-book-id", userId: admin.id, expiresAt: new Date(Date.now() + 36e5) }).returning();

// Two records: one under a catalog-shaped id and one under an old-style id, so the same page shows
// both conventions at once.
const [cat] = await db().insert(libraryUploads).values({
  bookId: "fz1003", uploadedBy: admin.id, blobPath: "uploads/fz1003/book.zip",
  fileName: "FZ1003_v1_CURRENT.zip", sizeBytes: 4096, status: "ready", registerVersion: "0.62",
}).returning();
const [old] = await db().insert(libraryUploads).values({
  bookId: "mis3000", uploadedBy: admin.id, blobPath: "uploads/mis3000/book.zip",
  fileName: "MIS3000_v1_CURRENT.zip", sizeBytes: 4096, status: "failed",
}).returning();

/** Render a page through the root layout, as a reader is served it. */
async function render(tree: unknown) {
  const { renderToReadableStream } = await import("react-dom/server");
  const Root = (await import("@/app/layout")).default as any;
  const stream = await renderToReadableStream(Root({ children: tree }));
  await stream.allReady;
  const reader = stream.getReader(); const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  // React's server renderer puts a <!-- --> marker between two adjacent expressions, so "{id} · "
  // arrives as "FZ1003<!-- --> · ". That is a rendering artefact, not content, and reading the page
  // as a person sees it means taking it out first.
  return out.replace(/<!-- -->/g, "");
}

async function renderUpload(id: string, sp: Record<string, string>) {
  const headers: any = await import("./test-support/next-headers.mjs");
  headers.state.session = sess.id;
  const Page = (await import("@/app/library/[id]/page")).default as any;
  return render(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) }));
}

async function renderLibrary() {
  const { renderToReadableStream } = await import("react-dom/server");
  const headers: any = await import("./test-support/next-headers.mjs");
  headers.state.session = sess.id;
  const Page = (await import("@/app/library/page")).default as any;
  const Root = (await import("@/app/layout")).default as any;
  const tree = Root({ children: await Page({ searchParams: Promise.resolve({}) }) });
  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  const reader = stream.getReader(); const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  // React's server renderer puts a <!-- --> marker between two adjacent expressions, so "{id} · "
  // arrives as "FZ1003<!-- --> · ". That is a rendering artefact, not content, and reading the page
  // as a person sees it means taking it out first.
  return out.replace(/<!-- -->/g, "");
}

await t("the library page shows FZ1003 in capitals and mis3000 as it is", async () => {
  const html = await renderLibrary();
  assert.ok(html.includes("FZ1003 ·"), "the catalog-shaped id is not capitalised in the record list");
  assert.ok(html.includes("mis3000 ·"), "the old-style id was changed");
  assert.ok(!html.includes("fz1003 ·"), "the lower-case form is still shown somewhere");
});

await t("what the forms post back is the stored id, lower-case", async () => {
  const html = await renderLibrary();
  // The Dismiss form carries the record's id, and any book-id value a form posts must be the
  // stored one — a capitalised value would miss every row and every content folder.
  for (const m of html.matchAll(/name="bookId" value="([^"]*)"/g)) {
    assert.equal(m[1], m[1].toLowerCase(), `a form posts ${m[1]}`);
  }
  for (const m of html.matchAll(/href="\/library\?retire=([^"&]*)/g)) {
    assert.equal(decodeURIComponent(m[1]), decodeURIComponent(m[1]).toLowerCase(), m[1]);
  }
});

await t("and the database still holds the lower-case id", async () => {
  for (const id of [cat.id, old.id]) {
    const row = (await db().select().from(libraryUploads).where(eq(libraryUploads.id, id)))[0];
    assert.equal(row.bookId, row.bookId.toLowerCase(), row.bookId);
  }
  assert.equal((await db().select().from(libraryUploads).where(eq(libraryUploads.id, cat.id)))[0].bookId, "fz1003");
});

console.log(`\n${passed} checks passed`);

// ------------------------------------------------- Spec 22 §5: the page a reader lands on

await t("a finished upload says it is done and offers a way back", async () => {
  const [pub] = await db().insert(libraryUploads).values({
    bookId: "sad", uploadedBy: admin.id, blobPath: "uploads/sad/v2.zip",
    fileName: "v2.zip", sizeBytes: 4096, status: "published", publishedAt: new Date("2026-10-04T12:00:00Z"),
    registerVersion: "6.20",
  }).returning();
  const html = await renderUpload(pub.id, { ok: "Adding the book to the library. This takes a minute or two." });

  assert.ok(html.includes("Done: in the library"), "no finished state");
  assert.ok(html.includes("2026-10-04"), "the date is missing");
  assert.ok(html.includes("Back to library"), "no way back");
  // The leftover line the redirect carries must not still be on the page (Spec 22 §5).
  assert.ok(!html.includes("Adding the book to the library"), "the stale progress line is still shown");
  assert.ok(!html.includes("this page refreshes itself"), "it is still polling");
  assert.ok(!html.includes('http-equiv="refresh"'), "the refresh meta is still there");
  // the book's real title, not its id, with the id beside it
  assert.ok(html.includes("Analysis and Design of Information Systems"), "no real title");
});

await t("an unfinished upload still says what it is doing, and still refreshes", async () => {
  const [checking] = await db().insert(libraryUploads).values({
    bookId: "fz1003", uploadedBy: admin.id, blobPath: "uploads/fz1003/v1.zip",
    fileName: "v1.zip", sizeBytes: 4096, status: "checking",
  }).returning();
  const html = await renderUpload(checking.id, {});
  assert.ok(html.includes("Checking…"), "no status");
  assert.ok(html.includes("this page refreshes itself"));
  assert.ok(html.includes('http-equiv="refresh"'));
  assert.ok(!html.includes("Done: in the library"));
  // no book in the library under that id yet, so the id stands in for the title
  assert.ok(html.includes("FZ1003"), "the id should be shown in capitals");
});

await t("the book list shows the real title, the id and the register version", async () => {
  const html = await renderLibrary();
  assert.ok(html.includes("Analysis and Design of Information Systems"), "no title");
  assert.ok(html.includes("(sad)"), "no id");
  assert.ok(html.includes("register 4.2"), "no register version");
});

await t("a double-zipped file name is recognised, and an ordinary one is not", () => {
  for (const name of ["MIS3250_v2_CURRENT.zip.zip", "book.ZIP.zip", "a.zip.ZIP"]) {
    assert.equal(looksDoubleZipped(name), true, name);
  }
  for (const name of ["MIS3250_v2_CURRENT.zip", "zip.zip.tar", "book.zip.txt", "notazip", "", null]) {
    assert.equal(looksDoubleZipped(name), false, String(name));
  }
});

console.log(`
${passed} checks passed`);
