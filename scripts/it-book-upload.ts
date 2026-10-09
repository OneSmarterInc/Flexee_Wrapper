// Integration test: Spec 28 commit 6 — the book zip arrives through the app and lands on disk.
//
// Driven through the route handler, because the gate (canUpload) and the choice of where the bytes
// land are both in the route, and those are the two things this commit could get wrong. The Blob
// version let the browser name the path and checked the name it was given; this one builds the path
// itself, so what these checks pin is that a caller cannot influence it.
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection, enrolAs } from "@/lib/roster";
import { setDispatchFetch, recordUpload, getUpload } from "@/lib/library";
import { MAX_BOOK_BYTES, MAX_UPLOAD_BYTES, bookUploadPrefix, uploadPath, saveUpload, deleteUpload } from "@/lib/files";

const { users, identities } = schema;

// Its own disk, so nothing here can reach a real one.
const VOLUME = mkdtempSync(path.join(tmpdir(), "books-"));
process.env.FILES_DIR = VOLUME;

const { POST: uploadPOST, GET: capGET } = await import("@/app/api/library/upload/route");

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const headers: any = await import("./test-support/next-headers.mjs");
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
async function signedInAs(userId: string | null) {
  if (!userId) { headers.state.session = null; return; }
  const id = `sess-${userId}`;
  await db().insert(schema.sessions).values({ id, userId, expiresAt: new Date(Date.now() + 864e5) }).onConflictDoNothing();
  headers.state.session = id;
}

// GitHub dispatch, stubbed: recordUpload starts the intake, and no test here wants that to leave.
setDispatchFetch((async () => new Response(null, { status: 204 })) as any);
Object.assign(process.env, { GITHUB_DISPATCH_TOKEN: "ghp_test", GITHUB_REPO: "OneSmarterInc/Flexee_Wrapper" });

const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const stu = await account("Stu", "stu@wright.edu");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
await enrolAs(cls.id, stu.id, "student");

/** POST a zip to the route as whoever is signed in. */
async function post(q: Record<string, string>, body: string | Uint8Array) {
  const url = `https://learn.flexee.org/api/library/upload?${new URLSearchParams(q)}`;
  const res = await uploadPOST(new Request(url, { method: "POST", body: body as any, duplex: "half" } as any));
  return { res, body: await res.json().catch(() => ({})) };
}
/** Every file on the volume, as "/"-separated keys. */
const onVolume = () => {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
    }
  };
  walk(VOLUME, "");
  return out.sort();
};

console.log("Who may send a book zip");

await t("a student is refused, and nothing is written", async () => {
  await signedInAs(stu.id);
  const before = onVolume().length;
  const { res, body } = await post({ bookId: "sad", name: "sad.zip" }, "PK pretend");
  assert.equal(res.status, 403);
  assert.match(body.error, /Only faculty and administrators/);
  assert.equal(onVolume().length, before, "no file appeared");
});

await t("a signed-out caller is refused before any byte is written", async () => {
  await signedInAs(null);
  const before = onVolume().length;
  const { res, body } = await post({ bookId: "sad", name: "sad.zip" }, "PK pretend");
  assert.equal(res.status, 401);
  assert.match(body.error, /Sign in/);
  assert.equal(onVolume().length, before);
});

await t("faculty who teach a class may, and so may an admin", async () => {
  for (const u of [prof, admin]) {
    await signedInAs(u.id);
    const { res } = await post({ bookId: "sad", name: `by-${u.id.slice(0, 4)}.zip` }, "PK one");
    assert.equal(res.status, 200, `${u.displayName} may upload`);
  }
});

console.log("What the route accepts");

await t("a book id that is not a book id is refused, including one trying to climb out", async () => {
  await signedInAs(prof.id);
  // archive, uploads and live name the intake's own directories (Spec 28 commit 7).
  for (const bookId of ["Bad Id", "../etc", "a", "9lives", "", "sad/../x", "archive", "uploads", "live"]) {
    const { res, body } = await post({ bookId, name: "x.zip" }, "PK");
    assert.equal(res.status, 400, `refused: ${JSON.stringify(bookId)}`);
    assert.match(body.error, /Book id/);
  }
});

await t("a file that is not named .zip is refused", async () => {
  await signedInAs(prof.id);
  const { res, body } = await post({ bookId: "sad", name: "book.pdf" }, "%PDF-");
  assert.equal(res.status, 400);
  assert.match(body.error, /\.zip/);
});

await t("the cap is published for the form, and it is the book cap, not the attachment cap", async () => {
  const res = await capGET();
  assert.equal((await res.json()).maxBytes, MAX_BOOK_BYTES);
  assert.equal(MAX_BOOK_BYTES, 200 * 1024 * 1024);
  assert.ok(MAX_BOOK_BYTES > MAX_UPLOAD_BYTES, "a book may be larger than an attachment");
});

console.log("Where the bytes land");

await t("the key is uploads/<bookId>/<name>, under FILES_DIR and nowhere else", async () => {
  await signedInAs(prof.id);
  const { res, body } = await post({ bookId: "mis4950", name: "FZ1003_v1_CURRENT.zip" }, "PK mis4950");
  assert.equal(res.status, 200);
  assert.equal(body.blobPath.startsWith("uploads/mis4950/"), true, body.blobPath);
  assert.equal(body.fileName, "FZ1003_v1_CURRENT.zip", "the name the person chose is kept for display");
  assert.equal(body.sizeBytes, "PK mis4950".length);
  const f = path.join(VOLUME, ...body.blobPath.split("/"));
  assert.equal(readFileSync(f, "utf8"), "PK mis4950");
  assert.equal(uploadPath(body.blobPath), f, "and the intake resolves the same file");
});

await t("the key recordUpload demands is the key the route returns", async () => {
  await signedInAs(prof.id);
  const { body } = await post({ bookId: "sad", name: "FZ1001_v2_CURRENT.zip" }, "PK sad");
  // recordUpload's own rule, unchanged since Spec 07: ^uploads/<bookId>/[^/]+\.zip$
  const r = await recordUpload(prof.id, { bookId: "sad", blobPath: body.blobPath, fileName: body.fileName, sizeBytes: body.sizeBytes });
  assert.equal(r.ok, true, r.ok === false ? r.error : "");
  const up = await getUpload((r as { id: string }).id);
  assert.equal(up!.blobPath, body.blobPath);
  assert.equal(up!.status, "checking");
});

await t("the same filename twice gives two files, so an earlier zip is never overwritten", async () => {
  await signedInAs(prof.id);
  const a = (await post({ bookId: "sad", name: "same.zip" }, "first")).body;
  const b = (await post({ bookId: "sad", name: "same.zip" }, "second")).body;
  assert.notEqual(a.blobPath, b.blobPath, "the random suffix is what Blob's addRandomSuffix was doing");
  assert.equal(readFileSync(path.join(VOLUME, ...a.blobPath.split("/")), "utf8"), "first");
  assert.equal(readFileSync(path.join(VOLUME, ...b.blobPath.split("/")), "utf8"), "second");
});

await t("a filename that tries to climb out becomes one harmless segment", async () => {
  await signedInAs(prof.id);
  for (const name of ["../../../etc/passwd.zip", "..\\..\\windows\\sys.zip", "/abs/path.zip"]) {
    const { res, body } = await post({ bookId: "sad", name }, "PK");
    assert.equal(res.status, 200, "sanitised rather than refused, as commit 5 does");
    assert.equal(body.blobPath.split("/").length, 3, body.blobPath);
    assert.equal(body.blobPath.startsWith("uploads/sad/"), true, body.blobPath);
    assert.equal(existsSync(path.join(VOLUME, ...body.blobPath.split("/"))), true);
  }
  // and nothing at all outside the uploads tree
  assert.equal(onVolume().every((k) => k.startsWith("uploads/")), true, onVolume().join(", "));
});

console.log("The cap, and what a refusal leaves behind");

await t("the counter refuses mid-stream and deletes the part it had written", async () => {
  // The mechanism, at a limit small enough to assert cheaply: saveUpload counts bytes as they pass
  // and does not trust Content-Length. The route's own limit is checked above and below.
  const before = onVolume();
  let thrown: unknown;
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close(); },
  });
  try { await saveUpload(bookUploadPrefix("sad"), "huge.zip", body, 1024); } catch (e) { thrown = e; }
  assert.match(String((thrown as Error)?.message), /larger than/);
  assert.deepEqual(onVolume(), before, "no fragment of the refused file is left");
});

await t("a zip larger than the 50 MB attachment cap is accepted, because a book has its own", async () => {
  await signedInAs(prof.id);
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 4096);   // 50 MB + 4 KB: over the attachment cap
  const { res, body } = await post({ bookId: "sad", name: "big.zip" }, big);
  assert.equal(res.status, 200, "a 50 MB zip is an ordinary book, not an oversized file");
  assert.equal(body.sizeBytes, big.byteLength);
});

console.log("What the intake can find");

await t("uploadPath answers null for a key that is not there, and for one that is not safe", async () => {
  assert.equal(uploadPath("uploads/sad/never-written.zip"), null);
  assert.equal(uploadPath("../../../etc/passwd"), null);
  assert.equal(uploadPath("uploads/sad/..\\..\\x.zip"), null);
  assert.equal(uploadPath(""), null);
  // a directory is not a file
  mkdirSync(path.join(VOLUME, "uploads", "dirkey"), { recursive: true });
  assert.equal(uploadPath("uploads/dirkey"), null);
});

await t("the resolver's root is FILES_DIR itself, and it reaches nothing above it", async () => {
  const f = path.join(VOLUME, "stray.zip");
  writeFileSync(f, "x");
  assert.equal(uploadPath("stray.zip"), f);
  assert.equal(uploadPath("/etc/hosts"), null);
});

console.log("Removing a zip once its book is published (Spec 28 commit 7b)");

await t("it frees the file and reports the bytes, and the file is gone", async () => {
  await signedInAs(prof.id);
  const { body } = await post({ bookId: "mis3000", name: "done.zip" }, "0123456789");
  const f = path.join(VOLUME, ...body.blobPath.split("/"));
  assert.equal(deleteUpload(body.blobPath), 10, "the bytes freed, for the log line");
  assert.equal(existsSync(f), false);
  assert.equal(uploadPath(body.blobPath), null);
});

await t("the book's directory is pruned when it empties, but never while a zip is still in it", async () => {
  await signedInAs(prof.id);
  // Its own book id: the directory has to be genuinely empty for the prune to be the thing proved,
  // and mis4950 still holds the zip an earlier check wrote.
  const a = (await post({ bookId: "prunebook", name: "one.zip" }, "aaa")).body;
  const b = (await post({ bookId: "prunebook", name: "two.zip" }, "bbb")).body;
  deleteUpload(a.blobPath);
  assert.equal(existsSync(path.join(VOLUME, "uploads", "prunebook")), true, "two.zip is still there");
  deleteUpload(b.blobPath);
  assert.equal(existsSync(path.join(VOLUME, "uploads", "prunebook")), false, "now it is empty, so it goes");
  assert.equal(existsSync(path.join(VOLUME, "uploads")), true, "and uploads/ itself is never removed");
});

await t("it answers null rather than throwing, for anything that is not a file it may remove", async () => {
  // It runs after the book is published. A delete that throws must not be able to report a
  // successful publish as a failure, so every refusal is a null and never an exception.
  assert.equal(deleteUpload("uploads/sad/never-there.zip"), null, "already gone");
  assert.equal(deleteUpload("../../../etc/passwd"), null, "outside FILES_DIR");
  assert.equal(deleteUpload(""), null, "no key at all");
  mkdirSync(path.join(VOLUME, "uploads", "adir"), { recursive: true });
  assert.equal(deleteUpload("uploads/adir"), null, "a directory is not a stored file");
  assert.equal(existsSync(path.join(VOLUME, "uploads", "adir")), true, "and it is still there");
});

console.log(`\n${passed} passed`);
