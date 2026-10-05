// Integration test: Spec 22 §2 and rule 2 — dismissing an upload record.
//
// A record is a receipt. The two things worth proving are that a receipt for a book now in the
// library can never be dismissed, however the call is made, and that dismissing touches nothing in
// Blob storage — the row keeps its blob path, so the zip is still where it was.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { listUploads, dismissUpload, dismissAllNotAdded, dismissableFor, mayDismiss,
         canDismiss, DISMISSIBLE, type UploadStatus } from "@/lib/library";

const { users, identities, libraryUploads } = schema;

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

const ALL: UploadStatus[] = ["checking", "ready", "stopped", "failed", "publishing", "published"];
const made: Record<string, string> = {};
for (const status of ALL) {
  const [row] = await db().insert(libraryUploads).values({
    bookId: "sad", uploadedBy: prof.id, blobPath: `uploads/sad/${status}.zip`,
    fileName: `${status}.zip`, sizeBytes: 2048, status,
    publishedAt: status === "published" ? new Date() : null,
  }).returning();
  made[status] = row.id;
}
console.log(`\none record in each of the six statuses: ${ALL.join(", ")}`);

await t("the rule says which statuses may be dismissed, and it is the one the code uses", () => {
  assert.deepEqual([...DISMISSIBLE].sort(), ["failed", "ready", "stopped"]);
  for (const s of ["failed", "stopped", "ready"]) assert.equal(mayDismiss(s), true, s);
  for (const s of ["checking", "publishing", "published"]) assert.equal(mayDismiss(s), false, s);
});

await t("a failed, stopped or ready record is dismissed and leaves the list", async () => {
  for (const s of ["failed", "stopped", "ready"]) {
    assert.deepEqual(await dismissUpload(prof.id, made[s]), { ok: true }, s);
  }
  const ids = (await listUploads()).map((u) => u.id);
  for (const s of ["failed", "stopped", "ready"]) {
    assert.ok(!ids.includes(made[s]), `${s} is still listed`);
  }
  assert.equal(ids.length, 3, `expected the other three to remain, got ${ids.length}`);
});

await t("an added record is never dismissed, and says why", async () => {
  const r = await dismissUpload(admin.id, made.published);
  assert.deepEqual(r, { ok: false, error: "That book is in the library, so its record is kept as history." });
  const row = (await db().select().from(libraryUploads).where(eq(libraryUploads.id, made.published)))[0];
  assert.equal(row.dismissedAt, null, "the refusal dismissed it anyway");
  assert.ok((await listUploads()).some((u) => u.id === made.published), "and it is still listed");
});

await t("a record the intake is still working on is left alone", async () => {
  for (const s of ["checking", "publishing"]) {
    const r = await dismissUpload(admin.id, made[s]);
    assert.equal(r.ok, false, s);
    assert.match((r as { error: string }).error, /still running/);
  }
});

await t("the uploader may dismiss their own; a third person may not", async () => {
  const [row] = await db().insert(libraryUploads).values({
    bookId: "mis3000", uploadedBy: prof.id, blobPath: "uploads/mis3000/x.zip",
    fileName: "x.zip", sizeBytes: 1024, status: "failed",
  }).returning();

  assert.equal(await canDismiss(prof.id, row), true, "the uploader");
  assert.equal(await canDismiss(admin.id, row), true, "an admin");
  assert.equal(await canDismiss(other.id, row), false, "a third person");

  const no = await dismissUpload(other.id, row.id);
  assert.deepEqual(no, { ok: false,
    error: "Only the person who uploaded it, or an administrator, can dismiss a record." });
  assert.ok((await listUploads()).some((u) => u.id === row.id), "the refusal hid it anyway");

  assert.deepEqual(await dismissUpload(admin.id, row.id), { ok: true });
});

await t("dismissing touches nothing in storage, and records who and when", async () => {
  const row = (await db().select().from(libraryUploads).where(eq(libraryUploads.id, made.failed)))[0];
  assert.equal(row.blobPath, "uploads/sad/failed.zip", "the blob path must be untouched");
  assert.equal(row.fileName, "failed.zip");
  assert.equal(row.sizeBytes, 2048);
  assert.equal(row.status, "failed", "the status is not rewritten either");
  assert.ok(row.dismissedAt instanceof Date, "no dismissal time recorded");
  assert.equal(row.dismissedBy, prof.id);
  // the row is still there: dismissing hides, it does not delete
  assert.equal((await db().select().from(libraryUploads)).length, 7);
});

await t("dismissing twice is not an error", async () => {
  assert.deepEqual(await dismissUpload(prof.id, made.failed), { ok: true });
});

await t("the bulk count is what the bulk act will hide, for each person", async () => {
  // Three left in the list: checking, publishing, published — none of them dismissible.
  assert.deepEqual(await dismissableFor(admin.id), []);

  const fresh: string[] = [];
  for (const s of ["failed", "stopped", "ready"] as const) {
    const [row] = await db().insert(libraryUploads).values({
      bookId: "sad", uploadedBy: prof.id, blobPath: `uploads/sad/b-${s}.zip`,
      fileName: `b-${s}.zip`, sizeBytes: 512, status: s,
    }).returning();
    fresh.push(row.id);
  }
  const [theirs] = await db().insert(libraryUploads).values({
    bookId: "sad", uploadedBy: other.id, blobPath: "uploads/sad/theirs.zip",
    fileName: "theirs.zip", sizeBytes: 512, status: "failed",
  }).returning();

  // An admin sees all four; the uploader sees only their own three.
  assert.equal((await dismissableFor(admin.id)).length, 4);
  assert.deepEqual([...(await dismissableFor(prof.id))].sort(), [...fresh].sort());
  assert.deepEqual(await dismissableFor(other.id), [theirs.id]);

  // And the bulk act hides exactly that set, not the other person's.
  const r = await dismissAllNotAdded(prof.id);
  assert.deepEqual(r, { ok: true, count: 3 });
  const left = (await listUploads()).map((u) => u.id);
  assert.ok(left.includes(theirs.id), "it hid someone else's record");
  for (const id of fresh) assert.ok(!left.includes(id), "one of their own is still listed");
});

await t("a bulk dismiss with nothing to do reports zero rather than failing", async () => {
  assert.deepEqual(await dismissAllNotAdded(prof.id), { ok: true, count: 0 });
});

await t("a record that no longer exists is reported, not thrown", async () => {
  const r = await dismissUpload(admin.id, "11111111-2222-3333-4444-555555555555");
  assert.deepEqual(r, { ok: false, error: "That upload record no longer exists." });
});

console.log(`\n${passed} checks passed`);
