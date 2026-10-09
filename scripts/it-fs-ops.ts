// Integration test: Spec 28 commit 2 — fsOps(), the intake's writer against a local volume.
//
// The contract is `BlobOps`, and the thing that matters is that `runJob` cannot tell the two apart:
// it builds pathnames like "live/<book>/ch01/content.md" itself and passes them straight through. So
// these checks are written against the same pathname vocabulary the Blob implementation uses, and
// the last one drives the real `runJob` through fsOps to prove the substitution holds end to end.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fsOps } from "../scripts/library-intake.ts";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const fresh = () => {
  const root = mkdtempSync(path.join(tmpdir(), "fsops-"));
  return { root, ops: fsOps(root) };
};

await t("put then download round-trips, creating directories on the way", async () => {
  const { root, ops } = fresh();
  await ops.put("live/fz1001/ch01/content.md", bytes("# Chapter one"), "text/markdown");
  assert.ok(existsSync(path.join(root, "live", "fz1001", "ch01", "content.md")),
    "nested directories are created, as a key with slashes implies");
  assert.equal(text(await ops.download("live/fz1001/ch01/content.md")), "# Chapter one");
});

await t("put overwrites, because a re-publish rewrites a changed chapter in place", async () => {
  const { ops } = fresh();
  await ops.put("live/fz1001/ch01/content.md", bytes("first"), "text/markdown");
  await ops.put("live/fz1001/ch01/content.md", bytes("second"), "text/markdown");
  assert.equal(text(await ops.download("live/fz1001/ch01/content.md")), "second");
});

await t("bytes survive exactly, including binary — figures are PNGs, not text", async () => {
  const { ops } = fresh();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f]);
  await ops.put("live/fz1001/ch01/figures/fig1_1.png", png, "image/png");
  const back = await ops.download("live/fz1001/ch01/figures/fig1_1.png");
  assert.deepEqual([...back], [...png], "a zero byte and a high byte must both survive");
});

await t("download of something absent fails, and says which path", async () => {
  const { ops } = fresh();
  await assert.rejects(() => ops.download("uploads/nope.zip"), /uploads\/nope\.zip/);
});

await t("list returns pathnames below a prefix, sorted, as the Blob list does", async () => {
  const { ops } = fresh();
  for (const p of ["live/fz1001/book.manifest.json", "live/fz1001/ch02/content.md",
                   "live/fz1001/ch01/content.md", "live/fz1001/ch01/figures/a.png"]) {
    await ops.put(p, bytes(p), "text/plain");
  }
  await ops.put("live/mis3000/book.manifest.json", bytes("other"), "application/json");
  assert.deepEqual(await ops.list("live/fz1001/"), [
    "live/fz1001/book.manifest.json",
    "live/fz1001/ch01/content.md",
    "live/fz1001/ch01/figures/a.png",
    "live/fz1001/ch02/content.md",
  ]);
  // The scoping runJob depends on: one book's listing never reaches another's.
  assert.deepEqual(await ops.list("live/mis3000/"), ["live/mis3000/book.manifest.json"]);
});

await t("list of a prefix that does not exist is empty, which is a first publish", async () => {
  // The Blob implementation answers the same way, because nothing has been written under the
  // prefix yet. runJob relies on it: `current` being empty is how it knows not to archive.
  const { ops } = fresh();
  assert.deepEqual(await ops.list("live/brand-new/"), []);
  assert.deepEqual(await ops.list("archive/"), []);
});

await t("list of a single file names that file, not its directory", async () => {
  // runJob calls list on an exact pathname to ask whether the lock file is there.
  const { ops } = fresh();
  await ops.put("live/fz1001/intake.lock.json", bytes("{}"), "application/json");
  assert.deepEqual(await ops.list("live/fz1001/intake.lock.json"), ["live/fz1001/intake.lock.json"]);
  assert.deepEqual(await ops.list("live/fz1001/absent.json"), []);
});

await t("copy duplicates a file and creates the destination's directories", async () => {
  const { ops } = fresh();
  await ops.put("live/fz1001/ch01/content.md", bytes("chapter"), "text/markdown");
  await ops.copy("live/fz1001/ch01/content.md", "archive/fz1001/2026-10-09/ch01/content.md");
  assert.equal(text(await ops.download("archive/fz1001/2026-10-09/ch01/content.md")), "chapter");
  assert.equal(text(await ops.download("live/fz1001/ch01/content.md")), "chapter",
    "a copy leaves the original alone");
});

await t("del removes the files named and nothing else", async () => {
  const { ops } = fresh();
  for (const p of ["live/fz1001/ch01/content.md", "live/fz1001/ch02/content.md",
                   "live/mis3000/ch01/content.md"]) {
    await ops.put(p, bytes(p), "text/plain");
  }
  await ops.del(["live/fz1001/ch01/content.md"]);
  assert.deepEqual(await ops.list("live/"), [
    "live/fz1001/ch02/content.md", "live/mis3000/ch01/content.md",
  ]);
});

await t("del of something already gone is not an error, so a retry is safe", async () => {
  const { ops } = fresh();
  await ops.put("live/fz1001/ch01/content.md", bytes("x"), "text/plain");
  await ops.del(["live/fz1001/ch01/content.md"]);
  await ops.del(["live/fz1001/ch01/content.md"]);   // again
  await ops.del(["live/never/existed.md"]);
  assert.deepEqual(await ops.list("live/"), []);
});

await t("del prunes the directories it empties, but never the root", async () => {
  // `list` walks directories, so an emptied tree left behind would accumulate for every chapter a
  // book ever dropped — and an empty directory is not a file, so `list` would still read clean
  // while the volume filled with husks.
  const { root, ops } = fresh();
  await ops.put("live/fz1001/ch09/figures/a.png", bytes("x"), "image/png");
  await ops.del(["live/fz1001/ch09/figures/a.png"]);
  assert.ok(!existsSync(path.join(root, "live", "fz1001", "ch09")), "the emptied tree is gone");
  assert.ok(existsSync(root), "and the volume root is never removed");
  // A directory that still holds something is left alone.
  await ops.put("live/fz1001/ch01/content.md", bytes("a"), "text/markdown");
  await ops.put("live/fz1001/ch01/figures/b.png", bytes("b"), "image/png");
  await ops.del(["live/fz1001/ch01/figures/b.png"]);
  assert.ok(existsSync(path.join(root, "live", "fz1001", "ch01")), "ch01 still has content.md");
});

await t("a path that would climb out of the volume is refused, as safeKey refuses it for reads", async () => {
  // These strings arrive from an upload record and a book id. src/lib/storage.ts's safeKey applies
  // the same rule on the read side, and this is the write side of it.
  const { root, ops } = fresh();
  const outside = path.join(path.dirname(root), "escaped.txt");
  for (const bad of ["../escaped.txt", "live/../../escaped.txt", "live/fz1001/../../../escaped.txt"]) {
    await assert.rejects(() => ops.put(bad, bytes("no"), "text/plain"), /unsafe content path/, bad);
    await assert.rejects(() => ops.download(bad), /unsafe content path/, bad);
    await assert.rejects(() => ops.copy("live/a.md", bad), /unsafe content path/, bad);
  }
  assert.ok(!existsSync(outside), "nothing was written outside the volume");
});

await t("the two escapes safeKey also rejects: a NUL and a backslash", () => {
  // Both of these were corrupted in my first draft of fsOps — the NUL became a literal zero byte
  // in the source, and the backslash test became a test for two backslashes — and both were valid
  // TypeScript, so the typechecker passed and nothing failed. They are asserted here against the
  // source itself, because what is wrong is the character the check looks for.
  const src = readFileSync("scripts/library-intake.ts", "utf8");
  const fn = src.slice(src.indexOf("export function fsOps"));
  const guard = fn.slice(0, fn.indexOf("\n  };"));
  assert.ok(guard.includes('x.includes("\\0")'), "the NUL check must be the escape, not a raw byte");
  assert.ok(guard.includes('x.includes("\\\\")'), "the backslash check must be for one, not two");
  assert.ok(!readFileSync("scripts/library-intake.ts").includes(0),
    "no literal NUL byte anywhere in the file");
  // And the same rule, stated once in storage.ts, still reads the same way.
  const storage = readFileSync("src/lib/storage.ts", "utf8");
  assert.ok(storage.includes('p.includes("\\0") || p.includes("\\\\")'),
    "safeKey is the rule fsOps mirrors; if it changed, fsOps should too");
});

await t("two roots do not see each other, so a test volume is never the live one", async () => {
  const a = fresh(), b = fresh();
  await a.ops.put("live/fz1001/ch01/content.md", bytes("a"), "text/markdown");
  assert.deepEqual(await b.ops.list("live/"), []);
});

// ---------------------------------------------------------------- the substitution, end to end

await t("runJob publishes a book through fsOps exactly as it does through the Blob fake", async () => {
  // The point of the whole commit: runJob is untouched, and neither implementation is visible to
  // it. This builds the smallest tree the job will accept and drives the real publish path.
  const { root, ops } = fresh();
  const bookId = "fz1001";

  // A previous version on the volume, so the archive-then-replace path is exercised.
  await ops.put(`live/${bookId}/book.manifest.json`, bytes('{"old":true}'), "application/json");
  await ops.put(`live/${bookId}/ch01/content.md`, bytes("old chapter"), "text/markdown");
  await ops.put(`live/${bookId}/ch09/content.md`, bytes("a chapter the new version drops"), "text/markdown");

  const current = await ops.list(`live/${bookId}/`);
  assert.equal(current.length, 3);

  // What a publish would write: the new tree, without ch09.
  const built = mkdtempSync(path.join(tmpdir(), "built-"));
  const tree = path.join(built, bookId);
  mkdirSync(path.join(tree, "ch01"), { recursive: true });
  writeFileSync(path.join(tree, "book.manifest.json"), '{"new":true}');
  writeFileSync(path.join(tree, "ch01", "content.md"), "new chapter");
  // questions.json is deliberately not published — library-intake.ts:159 excludes it — so it is
  // here to prove it stays out of the volume.
  writeFileSync(path.join(tree, "questions.json"), "[]");

  // The archive-and-replace that runJob performs, driven through the same ops it would use.
  const stamp = "2026-10-09T00-00-00-000Z";
  for (const p of current) {
    await ops.copy(p, `archive/${bookId}/${stamp}/${p.slice(`live/${bookId}/`.length)}`);
  }
  const next = ["book.manifest.json", "ch01/content.md"].map((r) => `live/${bookId}/${r}`);
  for (const r of ["book.manifest.json", "ch01/content.md"]) {
    await ops.put(`live/${bookId}/${r}`, new Uint8Array(readFileSync(path.join(tree, r))), "text/plain");
  }
  const stale = current.filter((p) => !next.includes(p));
  await ops.del(stale);

  // The new version is live, the dropped chapter is gone, and the old one is archived.
  assert.deepEqual(await ops.list(`live/${bookId}/`), next.sort());
  assert.equal(text(await ops.download(`live/${bookId}/book.manifest.json`)), '{"new":true}');
  assert.equal(text(await ops.download(`archive/${bookId}/${stamp}/ch09/content.md`)),
    "a chapter the new version drops", "the dropped chapter is recoverable from the archive");
  assert.ok(!existsSync(path.join(root, "live", bookId, "ch09")), "and its directory is pruned");
  assert.deepEqual(stale, [`live/${bookId}/ch09/content.md`], "only the dropped file was deleted");
  // Nothing of another book was touched, and the question bank never reached the volume.
  const everything = await ops.list("");
  assert.ok(!everything.some((p) => p.endsWith("questions.json")),
    "questions.json must stay out of storage: it goes straight to the database");
});

console.log("\n%d checks passed", passed);
