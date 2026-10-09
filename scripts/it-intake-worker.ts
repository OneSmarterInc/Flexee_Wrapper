// Integration test: Spec 28 commit 7 — the intake worker.
//
// The loop itself is three decisions: which row to pick, whether there is room to run it, and what
// to do when another process holds the book. Each is checked here against the real
// `library_uploads` table and the real `runJob`, with a book zip on a throwaway disk.
//
// The advisory lock is driven through the BookLock interface rather than against Postgres: PGlite
// is one connection, so two sessions cannot contend inside a test. What *is* checked against the
// database is that the SQL is valid and the key fits an int4 — the two things a typo would break
// and no fake could catch.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { recordUpload, approveUpload, getUpload, setStatus, setDispatchFetch, dispatchIntake } from "@/lib/library";
import {
  bookLockKey, LOCK_CLASS, onePass, waiting, diskRefusal, leastFree, freeBytes, DISK_FACTOR,
  minFreeBytes, loop, type BookLock, type PassResult,
} from "./intake-worker.ts";
import { fsOps, contentOps } from "./library-intake.ts";

const { users, identities, libraryUploads } = schema;
const REPO = process.cwd();

// Three throwaway directories, so nothing here can reach a real one.
const FILES = mkdtempSync(path.join(tmpdir(), "worker-files-"));
const CONTENT = mkdtempSync(path.join(tmpdir(), "worker-content-"));
const WORK = mkdtempSync(path.join(tmpdir(), "worker-work-"));
Object.assign(process.env, { FILES_DIR: FILES, CONTENT_DIR: CONTENT, INTAKE_WORK_DIR: WORK, INTAKE_MODE: "worker" });

// One book in the content root: its manifest and nothing else. createSection reads the manifest,
// and one existing file is enough to put the publish down the archive path rather than the
// first-publish path. The whole tree is deliberately *not* copied — it carries the repository's
// intake.lock.json, and the integrity gate would then compare the test shelf against the committed
// book and stop the check, which is Spec 16 working correctly on the wrong question.
mkdirSync(path.join(CONTENT, "sad"), { recursive: true });
cpSync(path.join(REPO, "content", "sad", "book.manifest.json"), path.join(CONTENT, "sad", "book.manifest.json"));

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}

// Nothing should reach GitHub in worker mode; if anything does, this makes it loud.
let dispatches = 0;
setDispatchFetch((async () => { dispatches++; return new Response(null, { status: 500 }); }) as any);

const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });

/** A lock that behaves like Postgres's, in memory, plus a way to pretend another process holds one. */
function fakeLock(): BookLock & { held: Set<string>; taken: string[] } {
  const held = new Set<string>(); const taken: string[] = [];
  return {
    held, taken,
    async tryLock(bookId) { taken.push(bookId); if (held.has(bookId)) return false; held.add(bookId); return true; },
    async unlock(bookId) { held.delete(bookId); },
    async close() { /* nothing to close */ },
  };
}

// A real SAD shelf, zipped as Drive zips a folder. The same fixture it-library uses.
const BUILD_SHELF = [
  "import os, sys",
  "sys.path.insert(0, os.environ['FIXTURES_DIR'])",
  "from make_sad_shelf import build",
  "build(os.environ['SHELF_ROOT'], layout='file-bytes')",
].join("\n");
const ZIP_DIR = [
  "import os, zipfile",
  "root, out = os.environ['ZIP_ROOT'], os.environ['ZIP_OUT']",
  "base = os.path.basename(root)",
  "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
  "    for dirpath, _dirs, files in os.walk(root):",
  "        for f in files:",
  "            full = os.path.join(dirpath, f)",
  "            rel = os.path.join(base, os.path.relpath(full, root))",
  "            z.write(full, rel.replace(os.sep, '/'))",
].join("\n");

function shelfZip(name: string): Uint8Array {
  const dir = mkdtempSync(path.join(tmpdir(), "shelf-"));
  const root = path.join(dir, "FZ1001_v2_CURRENT");
  execFileSync("python3", ["-c", BUILD_SHELF], {
    env: { ...process.env, FIXTURES_DIR: path.join(REPO, "scripts", "fixtures"), SHELF_ROOT: root },
  });
  const zip = path.join(dir, name);
  execFileSync("python3", ["-c", ZIP_DIR], { env: { ...process.env, ZIP_ROOT: root, ZIP_OUT: zip } });
  return readFileSync(zip);
}

/** Put a zip on the disk and record it, the way the route and the page do. */
async function uploaded(name: string, bytes: Uint8Array, bookId = "sad") {
  const f = path.join(FILES, "uploads", bookId, name);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, bytes);
  const r = await recordUpload(prof.id, { bookId, blobPath: `uploads/${bookId}/${name}`, fileName: name, sizeBytes: bytes.length });
  assert.ok(r.ok, r.ok === false ? r.error : "");
  return (r as { id: string }).id;
}

// The store the worker will actually use, chosen the way the worker chooses it rather than by
// hand. Driving every pass below through contentOps() is what makes its choice of prefix part of
// the end-to-end check, instead of a literal "" repeated in a test.
const { ops, prefix, kind } = await contentOps();
assert.equal(kind, "fs");
assert.equal(ops.constructor === fsOps(CONTENT).constructor, true);

// The loader, stubbed. The real one spawns `npm run db:sync-content`, which connects to
// DATABASE_URL — a real database, not this test's PGlite. It is given the tree to prove the
// publish handed it one.
const loaded: string[] = [];
const syncDb = (dir: string) => {
  loaded.push(dir);
  assert.ok(existsSync(path.join(dir, "sad", "book.manifest.json")), "the loader is given the approved tree");
};
const pass = (lock: BookLock) => onePass({ lock, ops, prefix, syncDb });
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
};

console.log("The queue is the table");

await t("in worker mode nothing is dispatched to GitHub, and the row is left for the worker", async () => {
  const id = await uploaded("sad-a.zip", new TextEncoder().encode("not a real zip"));
  assert.equal(dispatches, 0, "no HTTP call left the process");
  assert.equal((await getUpload(id))!.status, "checking", "which is what the worker polls for");
  const d = await dispatchIntake("check", id, "sad", { INTAKE_MODE: "worker" });
  assert.equal(d.ok, true, "and the call itself is a no-op success");
  assert.equal(dispatches, 0);
  // the GitHub path is still there, one setting away
  const g = await dispatchIntake("check", id, "sad", { INTAKE_MODE: "github" });
  assert.equal(g.ok, false, "with no token it reports the runner is not set up");
  assert.match(g.error!, /intake runner is not set up/);
});

await t("waiting() returns checking and publishing rows, oldest first, and never a dismissed one", async () => {
  const rows = await waiting();
  assert.ok(rows.length >= 1, "the record above is waiting");
  assert.ok(rows.every((r) => r.status === "checking" || r.status === "publishing"), JSON.stringify(rows));
  const ids = rows.map((r) => r.id);
  await db().update(libraryUploads).set({ dismissedAt: new Date() }).where(sql`id = ${ids[0]}`);
  assert.equal((await waiting()).some((r) => r.id === ids[0]), false, "a dismissed record is not a job");
  await db().update(libraryUploads).set({ dismissedAt: null }).where(sql`id = ${ids[0]}`);
});

console.log("One book at a time");

await t("a book another process holds is left alone, and the row is untouched", async () => {
  const lock = fakeLock();
  lock.held.add("sad");                       // as if a second worker, or a hand-run job, had it
  const rows = await waiting();
  const before = await getUpload(rows[0].id);
  const r = await quiet(() => pass(lock));
  assert.deepEqual(r, { did: "locked-elsewhere", bookId: "sad" });
  const after = await getUpload(rows[0].id);
  assert.equal(after!.status, before!.status, "nothing was written");
  assert.equal(after!.message, before!.message);
});

await t("the lock is released however the job ends", async () => {
  const lock = fakeLock();
  // this record's zip is not a zip, so runJob fails — the unlock is in a finally for this reason
  const r = await quiet(() => pass(lock));
  assert.equal(r.did, "ran");
  assert.equal((r as { outcome: string }).outcome, "failed");
  assert.equal(lock.held.size, 0, "and the book is free for the next pass");
});

await t("the key is a stable signed int4, and different books get different keys", () => {
  assert.equal(bookLockKey("sad"), bookLockKey("sad"), "stable");
  assert.notEqual(bookLockKey("sad"), bookLockKey("mis3000"));
  for (const id of ["sad", "mis3000", "mis4950", "fz1001", "a".repeat(31)]) {
    const k = bookLockKey(id);
    assert.equal(Number.isInteger(k), true, id);
    assert.ok(k >= -2147483648 && k <= 2147483647, `${id} -> ${k} is an int4`);
  }
});

await t("the lock SQL is valid against a real Postgres, with a real key", async () => {
  // What no fake can check: that the function exists, takes two int4s in this order, and answers a
  // boolean. PGlite is one session, so it cannot prove contention — only that the call works.
  const k = bookLockKey("sad");
  const got = await db().execute(sql`select pg_try_advisory_lock(${LOCK_CLASS}::int4, ${k}::int4) as got`);
  const rows = (got as any).rows ?? got;
  assert.equal(rows[0].got === true || rows[0].got === "t", true, JSON.stringify(rows[0]));
  await db().execute(sql`select pg_advisory_unlock(${LOCK_CLASS}::int4, ${k}::int4)`);
});

console.log("Free disk");

await t("a job is refused when the disk could not hold it, and the sentence says what it needs", () => {
  // The floor is raised above the free space rather than filling a disk to test it.
  const free = leastFree().bytes;
  assert.ok(free !== null && free > 0, `free space is measurable: ${free}`);
  const refusal = diskRefusal(100 * 1024 * 1024, { ...process.env, INTAKE_MIN_FREE_MB: String(Math.ceil(free! / 1024 / 1024) + 10_000) });
  assert.ok(refusal, "refused");
  assert.match(refusal!, /not enough free space/);
  assert.match(refusal!, /Nothing was changed/);
  assert.match(refusal!, /INTAKE_WORK_DIR|CONTENT_DIR|FILES_DIR/, refusal!);
});

await t("and allowed when there is room, with the zip's size counted several times over", () => {
  assert.equal(diskRefusal(1024, { ...process.env, INTAKE_MIN_FREE_MB: "1" }), null);
  assert.equal(DISK_FACTOR >= 3, true, "the zip is unpacked, built and archived, so one copy is not the peak");
  assert.equal(minFreeBytes({ INTAKE_MIN_FREE_MB: "512" } as any), 512 * 1024 * 1024);
});

await t("a filesystem that cannot be measured is not a refusal", () => {
  assert.equal(freeBytes(path.join(CONTENT, "no-such-directory")), null);
  // leastFree skips what does not exist rather than reporting zero, which would refuse every book
  const r = leastFree({ ...process.env, CONTENT_DIR: path.join(CONTENT, "gone") });
  assert.ok(r.bytes === null || r.bytes > 0, JSON.stringify(r));
});

await t("a check with no room is stopped; a publish with no room goes back to ready", async () => {
  const tight = { ...process.env } as NodeJS.ProcessEnv;
  const free = leastFree().bytes!;
  tight.INTAKE_MIN_FREE_MB = String(Math.ceil(free / 1024 / 1024) + 10_000);

  const idCheck = await uploaded("tight-check.zip", new TextEncoder().encode("x"));
  const r1 = await quiet(() => onePass({ lock: fakeLock(), ops, prefix, env: tight, syncDb }));
  assert.equal(r1.did, "refused");
  const u1 = await getUpload(idCheck);
  assert.equal(u1!.status, "stopped", "dismissible, and it says why");
  assert.match(u1!.message!, /not enough free space/);

  // A publishing row: the check already passed, so going back to ready leaves a way forward.
  const idPub = await uploaded("tight-pub.zip", new TextEncoder().encode("x"));
  await setStatus(idPub, "ready", {});
  assert.ok((await approveUpload(prof.id, idPub)).ok, "approve claims it as publishing");
  assert.equal((await getUpload(idPub))!.status, "publishing");
  const r2 = await quiet(() => onePass({ lock: fakeLock(), ops, prefix, env: tight, syncDb }));
  assert.equal(r2.did, "refused");
  const u2 = await getUpload(idPub);
  assert.equal(u2!.status, "ready", "not stopped: a stopped publish has no way forward but re-upload");
  assert.match(u2!.message!, /not enough free space/);
  await setStatus(idPub, "failed", { message: "tidied away" });   // out of the queue for later passes
  await setStatus(idCheck, "failed", { message: "tidied away" });
});

console.log("Which store the worker publishes to");

await t("a filesystem store has no prefix, because CONTENT_DIR is the content root", async () => {
  // The decision this pins: FsStore reads <CONTENT_DIR>/<book>/ch01/content.md with nothing in
  // front of it, so publishing under live/ would put every book in a folder the app never reads.
  // live/ was a Vercel Blob prefix and nothing else.
  const fs1 = await contentOps({ CONTENT_STORE: "fs", CONTENT_DIR: CONTENT });
  assert.equal(fs1.prefix, "", "no prefix");
  assert.equal(fs1.kind, "fs");
  const dflt = await contentOps({ CONTENT_DIR: CONTENT });
  assert.equal(dflt.kind, "fs", "fs is the default, as it is for the app");
  assert.equal(dflt.prefix, "");
});

await t("s3 is refused rather than half-supported", async () => {
  // S3Store can read a bucket; there is no s3Ops() to write one. A job that published nothing
  // while reporting success is worse than one that refuses.
  await assert.rejects(() => contentOps({ CONTENT_STORE: "s3", CONTENT_BUCKET: "flexee-content" }),
    /cannot publish to CONTENT_STORE=s3/);
  await assert.rejects(() => contentOps({ CONTENT_STORE: "nonsense" }), /Set it to fs or blob/);
});

console.log("A real book, end to end, through the worker");

await t("a check and then a publish, both picked up by the loop, into CONTENT_DIR with no prefix", async () => {
  // Every earlier record is out of the queue by now, so the only rows the passes can find are
  // this book's.
  for (const r of await waiting()) await setStatus(r.id, "failed", { message: "tidied away" });

  const id = await uploaded("sad-real.zip", shelfZip("sad-real.zip"));
  const lock = fakeLock();
  const r1 = await quiet(() => pass(lock));
  assert.deepEqual(r1, { did: "ran", id, action: "check", outcome: "ready" });
  assert.equal(existsSync(path.join(FILES, "uploads", "sad", "sad-real.zip")), true, "a ready record keeps its zip");

  assert.ok((await approveUpload(admin.id, id)).ok, "added to the library");
  const r2 = await quiet(() => pass(lock));
  assert.deepEqual(r2, { did: "ran", id, action: "publish", outcome: "published" });

  // The books are at <CONTENT_DIR>/<book>/…, with no live/ in front, because that is where the
  // app's FsStore reads them. This is the whole point of contentOps()'s empty prefix.
  assert.equal(existsSync(path.join(CONTENT, "sad", "book.manifest.json")), true, "published where the app reads");
  assert.equal(existsSync(path.join(CONTENT, "live")), false, "and not under a live/ prefix");
  assert.equal(existsSync(path.join(FILES, "uploads", "sad", "sad-real.zip")), false, "the published zip is removed");
  assert.equal((await getUpload(id))!.status, "published");
  assert.equal(loaded.length >= 1, true, "and the chapters were handed to the loader");
  assert.equal(dispatches, 0, "and GitHub was never called");

  // The previous version is archived beside the books, not under a prefix. This is the layout that
  // makes commit 7a's isBookDir necessary: archive/ is in the same listing as sad/.
  const top = readdirSync(CONTENT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(top, ["archive", "sad"], top.join(", "));
  const { isBookDir } = await import("@/lib/storage");
  assert.deepEqual(top.filter(isBookDir), ["sad"], "and only one of them is a book");
});

await t("nothing waiting is nothing done", async () => {
  const r = await quiet(() => pass(fakeLock()));
  assert.deepEqual(r, { did: "nothing" });
});

console.log("Stopping");

await t("the loop stops when asked, between jobs", async () => {
  // stopping() true from the start: the loop must not run a pass, and must not hang.
  let passes = 0;
  const counting: BookLock = { async tryLock() { passes++; return true; }, async unlock() {}, async close() {} };
  await loop({ lock: counting, ops, prefix, pollMs: 1, syncDb, stopping: () => true });
  assert.equal(passes, 0);
});

await t("a pass that throws does not end the loop", async () => {
  let calls = 0;
  const broken: BookLock = {
    async tryLock() { calls++; throw new Error("the database went away"); },
    async unlock() {}, async close() {},
  };
  const id = await uploaded("boom.zip", new TextEncoder().encode("x"));
  let stop = false;
  const p = quiet(() => loop({ lock: broken, ops, prefix, pollMs: 1, syncDb, stopping: () => stop }));
  await new Promise((r) => setTimeout(r, 60));
  stop = true; await p;
  assert.ok(calls >= 2, `it kept going after the error (${calls} attempts)`);
  await setStatus(id, "failed", { message: "tidied away" });
});

process.on("exit", () => { for (const d of [FILES, CONTENT, WORK]) rmSync(d, { recursive: true, force: true }); });
console.log("The unit, the script and the runbook agree with each other");

/** A file's lines with comment-only lines removed, so a check reads code and not prose. */
const code = (file: string, hash: string) =>
  readFileSync(path.join(REPO, file), "utf8").split(/\r?\n/)
    .filter((l) => !l.trim().startsWith(hash)).join("\n");

await t("npm run intake:worker starts the worker with the run loader, not the test loader", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  const cmd: string = pkg.scripts["intake:worker"];
  assert.ok(cmd, "the script exists");
  assert.match(cmd, /scripts\/intake-worker\.ts/);
  assert.match(cmd, /run-support\/register\.mjs/, cmd);
  // test-support swaps @/db for an in-memory PGlite. A worker started with it would poll a
  // database that is thrown away on exit, find nothing, and look perfectly healthy for ever.
  assert.equal(cmd.includes("test-support"), false, cmd);
  assert.match(cmd, /--env-file-if-exists=\.env/, "the unit's EnvironmentFile is not the only path to settings");
});

await t("the unit is modest, restarts, and is given time to finish a publish", () => {
  const unit = code("deploy/aws/flexee-intake.service", "#");
  assert.match(unit, /ExecStart=.*npm run intake:worker/, unit);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /MemoryMax=/, "the box is shared, so the worker is capped");
  assert.match(unit, /CPUQuota=/);
  assert.match(unit, /StartLimitBurst=/, "an OOM must not become an endless restart loop");
  const stop = Number(/TimeoutStopSec=(\d+)/.exec(unit)?.[1]);
  assert.ok(stop >= 300, `a publish needs time to finish on SIGTERM, got ${stop}`);
  assert.match(unit, /KillSignal=SIGTERM/);
});

await t("deploy.sh and the runbook's sudoers rule spell the unit the same way", () => {
  // The trap this exists for: sudoers matches the command line as written. If deploy.sh runs
  // `sudo systemctl restart flexee-intake` and the rule permits `... flexee-intake.service`, every
  // deploy fails at its last step on a password prompt it cannot answer.
  const sh = code("deploy/aws/deploy.sh", "#");
  const spelling = /sudo systemctl restart (flexee-intake(?:\.service)?)/.exec(sh)?.[1];
  assert.ok(spelling, "deploy.sh restarts the worker");
  const book = readFileSync(path.join(REPO, "deploy/aws/AWS_Deployment_Runbook.md"), "utf8");
  const rule = /NOPASSWD: *\S*systemctl restart (flexee-intake(?:\.service)?)/.exec(book)?.[1];
  assert.ok(rule, "the runbook gives a sudoers rule for it");
  assert.equal(rule, spelling, `deploy.sh says "${spelling}", the runbook's rule says "${rule}"`);
});

await t("the runbook warns that the rest of it is superseded, and tells Akshay what is true", () => {
  const book = readFileSync(path.join(REPO, "deploy/aws/AWS_Deployment_Runbook.md"), "utf8");
  const head = book.slice(0, book.indexOf("## What you will build"));
  assert.match(head, /superseded/i, "the warning is before the first instruction, not after it");
  assert.match(head, /flexee-wrapper/, "and it names the unit that actually runs");
  assert.match(head, /nginx/);
  assert.match(book, /Part I/);
});

await t(".env.example names every setting the worker needs", () => {
  const env = code("deploy/aws/.env.example", "#");
  for (const key of ["CONTENT_DIR", "FILES_DIR", "INTAKE_WORK_DIR", "CONTENT_STORE", "INTAKE_MODE", "DATABASE_URL"]) {
    assert.match(env, new RegExp(`^${key}=`, "m"), key);
  }
  assert.match(env, /^INTAKE_MODE=worker$/m);
  assert.match(env, /^CONTENT_STORE=fs$/m);
  assert.equal(/flexxe/.test(env), false, "the database name was renamed to flexee_wrapper");
});

console.log(`\n${passed} passed`);
