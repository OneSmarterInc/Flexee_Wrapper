// Integration test: the book library — upload rules and GitHub dispatch (lib/library), and the
// intake job (scripts/library-intake.ts) end to end: a real SAD test shelf, zipped as Drive zips a
// folder, run through the real intake and validator against a simulated content store.
//
// Spec 28 commit 6: the zip now comes off the disk, so `uploaded()` writes the fixture into a
// throwaway FILES_DIR instead of putting it in the simulated store. That is deliberate rather than
// an injection point — it means every check below, including the whole publish path, exercises the
// way the job will actually find a zip on the box.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { canUpload, recordUpload, approveUpload, getUpload, setDispatchFetch, dispatchIntake, validBookId } from "@/lib/library";
import { runJob, findShelf, type BlobOps } from "../scripts/library-intake.ts";

const { users, identities } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}

// GitHub, simulated: record every dispatch; answer 204 unless told otherwise.
const dispatched: any[] = []; let githubStatus = 204;
setDispatchFetch((async (url: any, init: any) => {
  dispatched.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
  return new Response(null, { status: githubStatus });
}) as any);
Object.assign(process.env, { GITHUB_DISPATCH_TOKEN: "ghp_test", GITHUB_REPO: "OneSmarterInc/Flexee_Wrapper" });

// The upload area, on a throwaway disk: FILES_DIR, where the route writes a book zip and the job
// reads it. Set before anything imports lib/files, which reads it through filesDir() at call time.
const VOLUME = mkdtempSync(path.join(tmpdir(), "library-files-"));
process.env.FILES_DIR = VOLUME;

// The content store, simulated — live/<book>/ and archive/<book>/, which is all `blob` is for now.
const store = new Map<string, Uint8Array>();
const blob: BlobOps = {
  async download(p) { const b = store.get(p); if (!b) throw new Error("not found " + p); return b; },
  async list(prefix) { return [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  async put(p, bytes) { store.set(p, bytes); },
  async copy(from, to) { store.set(to, store.get(from)!); },
  async del(ps) { for (const p of ps) store.delete(p); },
};
let synced: string[] = [];
const syncDb = (dir: string) => { synced.push(dir); assert.ok(existsSync(path.join(dir, "sad", "book.manifest.json")), "loader sees the approved tree"); };

const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const prof2 = await account("Prof Two", "prof2@flexee.org");
const stu = await account("Stu", "stu@wright.edu");
await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
await createSection(prof2.id, "mis3000", "MIS 3000-01", "2027 Spring", { teach: true });

console.log("Who may upload");
await t("admins and anyone who teaches a class; not students", async () => {
  assert.equal(await canUpload(admin.id), true);
  assert.equal(await canUpload(prof.id), true);
  assert.equal(await canUpload(stu.id), false);
  const r = await recordUpload(stu.id, { bookId: "sad", blobPath: "uploads/sad/x.zip", fileName: "x.zip", sizeBytes: 1 });
  assert.equal(r.ok, false);
});
await t("book ids and files are checked before anything starts", async () => {
  assert.equal(validBookId("mis4950"), true); assert.equal(validBookId("MIS 4950"), false); assert.equal(validBookId("4950"), false);
  const n = dispatched.length;
  assert.equal((await recordUpload(prof.id, { bookId: "Bad Id", blobPath: "uploads/a.zip", fileName: "a.zip", sizeBytes: 1 })).ok, false);
  assert.equal((await recordUpload(prof.id, { bookId: "sad", blobPath: "uploads/a.pdf", fileName: "a.pdf", sizeBytes: 1 })).ok, false);
  assert.equal((await recordUpload(prof.id, { bookId: "sad", blobPath: "elsewhere/a.zip", fileName: "a.zip", sizeBytes: 1 })).ok, false);
  assert.equal(dispatched.length, n, "no GitHub run started");
});

console.log("Starting the intake in GitHub");
await t("an upload is recorded as checking and starts the workflow with its id", async () => {
  const r = await recordUpload(prof.id, { bookId: "sad", blobPath: "uploads/sad/probe.zip", fileName: "probe.zip", sizeBytes: 10 });
  assert.ok(r.ok && r.id);
  const d = dispatched.at(-1);
  assert.equal(d.url, "https://api.github.com/repos/OneSmarterInc/Flexee_Wrapper/actions/workflows/library-intake.yml/dispatches");
  assert.equal(d.headers.Authorization, "Bearer ghp_test");
  assert.deepEqual(d.body, { ref: "main", inputs: { upload_id: (r as any).id, book_id: "sad", action: "check" } });
  assert.equal((await getUpload((r as any).id))!.status, "checking");
});
await t("if the runner is not set up, the upload says so instead of waiting forever", async () => {
  assert.equal((await dispatchIntake("check", "x", "sad", {} as any)).ok, false);
  githubStatus = 401;
  const r = await recordUpload(prof.id, { bookId: "sad", blobPath: "uploads/sad/p2.zip", fileName: "p2.zip", sizeBytes: 10 });
  const u = await getUpload((r as any).id);
  assert.equal(u!.status, "failed"); assert.match(u!.message!, /GitHub answered 401/);
  githubStatus = 204;
});
await t("a publish dispatch cannot bypass approval", async () => {
  const r = await recordUpload(prof.id, { bookId: "sad", blobPath: "uploads/sad/unapproved.zip", fileName: "unapproved.zip", sizeBytes: 10 });
  assert.equal(await runJob({ uploadId: (r as any).id, action: "publish", blob }), "skipped");
  assert.equal((await getUpload((r as any).id))!.status, "checking");
});
await t("the zip extractor accepts a normal folder and rejects traversal and links", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-safety-"));
  const script = `import stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('CURRENT/STATE_OF_RECORD.md', 'register')
with zipfile.ZipFile(sys.argv[2], 'w') as z:
    z.writestr('../outside.txt', 'bad')
with zipfile.ZipFile(sys.argv[3], 'w') as z:
    entry = zipfile.ZipInfo('CURRENT/link')
    entry.create_system = 3
    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
    z.writestr(entry, '../outside.txt')`;
  try {
    const archives = ["good.zip", "traversal.zip", "link.zip"].map((name) => path.join(dir, name));
    execFileSync("python3", ["-c", script, ...archives]);
    const tool = path.join(process.cwd(), "tools", "safe_unzip.py");
    execFileSync("python3", [tool, archives[0], path.join(dir, "good")]);
    assert.equal(readFileSync(path.join(dir, "good", "CURRENT", "STATE_OF_RECORD.md"), "utf8"), "register");
    for (const [i, name] of [[1, "traversal"], [2, "link"]] as const) {
      assert.throws(() => execFileSync("python3", [tool, archives[i], path.join(dir, name)], { stdio: "pipe" }));
    }
    assert.equal(existsSync(path.join(dir, "outside.txt")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the job, end to end -------------------------------------------------------------------------
const REPO = process.cwd();
// Paths reach Python through the environment, never interpolated into its source. A Windows path
// embedded in a Python string literal is read as escape sequences and fails to parse.
const BUILD_SHELF = [
  "import os, sys",
  "sys.path.insert(0, os.environ['FIXTURES_DIR'])",
  "from make_sad_shelf import build",
  "build(os.environ['SHELF_ROOT'], layout='file-bytes')",
].join("\n");

// One file into a zip, under its own basename.
const ZIP_ONE = [
  "import os, zipfile",
  "src, out = os.environ['ZIP_IN'], os.environ['ZIP_OUT']",
  "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
  "    z.write(src, os.path.basename(src))",
].join("\n");

// Zipped with Python's zipfile rather than the `zip` binary, which Windows has no copy of.
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

function shelfZip(name: string, mutate?: (root: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "shelf-"));
  const root = path.join(dir, "FZ1001_v2_CURRENT"); // Drive zips a folder with the folder itself inside
  execFileSync("python3", ["-c", BUILD_SHELF], {
    env: { ...process.env, FIXTURES_DIR: path.join(REPO, "scripts", "fixtures"), SHELF_ROOT: root },
  });
  mutate?.(root);
  const zip = path.join(dir, name);
  execFileSync("python3", ["-c", ZIP_DIR], { env: { ...process.env, ZIP_ROOT: root, ZIP_OUT: zip } });
  return readFileSync(zip);
}
async function uploaded(name: string, bytes: Uint8Array, who = prof.id) {
  const p = `uploads/sad/${name}`;
  const f = path.join(VOLUME, "uploads", "sad", name);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, bytes);
  const r = await recordUpload(who, { bookId: "sad", blobPath: p, fileName: name, sizeBytes: bytes.length });
  return (r as any).id as string;
}

/** Is the upload's zip still on the disk the route wrote it to? */
const zipOnDisk = (name: string) => existsSync(path.join(VOLUME, "uploads", "sad", name));

/** Run something with console.log captured, and return the lines. */
async function withLog<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = []; const real = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { return { value: await fn(), lines }; } finally { console.log = real; }
}

console.log("The intake job (real intake, real validator, the zip on disk)");
const good = shelfZip("sad-v1.zip");
const idGood = await uploaded("sad-v1.zip", good);
await t("check: a correct book comes back ready, with the intake's report and register version", async () => {
  assert.equal(await runJob({ uploadId: idGood, action: "check", blob, syncDb, runUrl: "https://github.com/run/1" }), "ready");
  const u = await getUpload(idGood);
  assert.equal(u!.status, "ready"); assert.match(u!.report!, /READY TO APPROVE/); assert.equal(u!.registerVersion, "6.17");
  assert.equal(u!.runUrl, "https://github.com/run/1");
  assert.equal(zipOnDisk("sad-v1.zip"), true, "a ready record keeps its zip: the approval is still to come");
  assert.equal([...store.keys()].filter((k) => k.startsWith("live/")).length, 0, "a check publishes nothing");
});
await t("only the uploader or an admin may add it to the library, and only once", async () => {
  assert.equal((await approveUpload(prof2.id, idGood)).ok, false);
  assert.equal((await approveUpload(stu.id, idGood)).ok, false);
  assert.deepEqual(await approveUpload(admin.id, idGood), { ok: true, id: idGood });
  assert.deepEqual(dispatched.at(-1).body.inputs, { upload_id: idGood, book_id: "sad", action: "publish" });
  assert.equal((await getUpload(idGood))!.status, "publishing");
  assert.equal((await approveUpload(admin.id, idGood)).ok, false, "a second click does nothing");
});
await t("publish: the book goes to live/sad/ in Blob, without the answer key, and is loaded", async () => {
  // Spec 28 commit 7b: the publish is also where the zip is removed, so it is run with the log
  // captured and both facts are checked at once.
  const { value, lines } = await withLog(() => runJob({ uploadId: idGood, action: "publish", blob, syncDb }));
  assert.equal(value, "published");
  assert.equal(zipOnDisk("sad-v1.zip"), false, "the published zip is removed: the book and its archive replace it");
  const note = lines.find((l) => l.includes("removed the upload zip"));
  assert.ok(note, `a deletion is logged, got: ${lines.join(" | ")}`);
  assert.match(note!, /uploads\/sad\/sad-v1\.zip/, note);
  assert.match(note!, /sad is published/, note);
  assert.equal((await getUpload(idGood))!.blobPath, "uploads/sad/sad-v1.zip", "the record keeps the key as its receipt");
  const live = [...store.keys()].filter((k) => k.startsWith("live/sad/"));
  assert.ok(live.includes("live/sad/book.manifest.json"));
  assert.ok(live.some((k) => /live\/sad\/ch01\/figures\/.+\.png$/.test(k)), "figures uploaded");
  assert.ok(!live.some((k) => k.endsWith("questions.json") || k.endsWith("objectives.json")), "answer key stays out of Blob");
  assert.equal(synced.length, 1);
  const u = await getUpload(idGood); assert.equal(u!.status, "published"); assert.ok(u!.publishedAt);

  // Spec 15, rule 6: the published manifest carries the register's title, not the book id. This is
  // the job that used to produce "SAD" every time, because it builds in a fresh temp directory and
  // so never found a previous manifest to carry a title forward from.
  const bm = JSON.parse(new TextDecoder().decode(store.get("live/sad/book.manifest.json")!));
  assert.equal(bm.title, "Analysis and Design of Information Systems", `title was ${bm.title}`);
  assert.equal(bm.series, "Five Zero Books", `series was ${bm.series}`);
  assert.notEqual(bm.title, "SAD", "the book id must not be the title any more");
});
await t("a new version replaces the old one in live/, and the old one is archived, not deleted", async () => {
  const before = [...store.keys()].filter((k) => k.startsWith("live/sad/")).length;
  const idV2 = await uploaded("sad-v2.zip", good);
  await runJob({ uploadId: idV2, action: "check", blob, syncDb });
  await approveUpload(prof.id, idV2);
  assert.equal(await runJob({ uploadId: idV2, action: "publish", blob, syncDb, now: new Date("2026-10-01T12:00:00Z") }), "published");
  const archived = [...store.keys()].filter((k) => k.startsWith("archive/sad/2026-10-01T12-00-00-000Z/"));
  assert.equal(archived.length, before, "every previous live file archived");
  assert.equal([...store.keys()].filter((k) => k.startsWith("live/sad/")).length, before);
  assert.match((await getUpload(idV2))!.message!, /previous version is archived/);
});
await t("a book with a defect is stopped with the intake's reason, and nothing is published", async () => {
  const bad = shelfZip("sad-bad.zip", (root) => writeFileSync(path.join(root, "04_Chapters", "All.zip"), "x"));
  const id = await uploaded("sad-bad.zip", bad);
  const liveBefore = [...store.keys()].filter((k) => k.startsWith("live/")).length;
  assert.equal(await runJob({ uploadId: id, action: "check", blob, syncDb }), "stopped");
  const u = await getUpload(id);
  assert.equal(u!.status, "stopped"); assert.match(u!.report!, /All\.zip/); assert.match(u!.report!, /STOPPED/);
  assert.equal((await approveUpload(admin.id, id)).ok, false, "a stopped book cannot be added");
  assert.equal([...store.keys()].filter((k) => k.startsWith("live/")).length, liveBefore);
  assert.equal(zipOnDisk("sad-bad.zip"), true, "a stopped record keeps its zip, so the report can be read against it");
});
await t("a file that is not a zip, or a zip with no register, fails with a plain explanation", async () => {
  const notZip = await uploaded("junk.zip", new TextEncoder().encode("not a zip"));
  assert.equal(await runJob({ uploadId: notZip, action: "check", blob, syncDb }), "failed");
  assert.match((await getUpload(notZip))!.message!, /not a readable zip/);
  assert.equal(zipOnDisk("junk.zip"), true, "a failed record keeps its zip: the Library page offers to start it again");
  const dir = mkdtempSync(path.join(tmpdir(), "noreg-")); writeFileSync(path.join(dir, "readme.txt"), "hello");
  execFileSync("python3", ["-c", ZIP_ONE], { env: { ...process.env, ZIP_IN: path.join(dir, "readme.txt"), ZIP_OUT: path.join(dir, "n.zip") } });
  const noReg = await uploaded("noreg.zip", readFileSync(path.join(dir, "n.zip")));
  assert.equal(await runJob({ uploadId: noReg, action: "check", blob, syncDb }), "failed");
  assert.match((await getUpload(noReg))!.message!, /no STATE_OF_RECORD\.md/);
  rmSync(dir, { recursive: true, force: true });
});
await t("a zip that is no longer on disk fails with a plain message, not a stack", async () => {
  // Spec 28 commit 6: the only new way this job can fail. The row says where the zip is and the
  // file is gone — a disk cleared, a FILES_DIR pointed somewhere new, a restore that brought the
  // database back without the files. The person reading the Library page gets a sentence they can
  // act on rather than ENOENT and a path.
  const id = await uploaded("vanishing.zip", shelfZip("vanishing.zip"));
  rmSync(path.join(VOLUME, "uploads", "sad", "vanishing.zip"), { force: true });
  assert.equal(await runJob({ uploadId: id, action: "check", blob, syncDb }), "failed");
  const u = await getUpload(id);
  assert.match(u!.message!, /no longer on disk/);
  assert.equal(/[\\/]uploads[\\/]/.test(u!.message!), false, "and it does not print a filesystem path");
});

await t("a book cannot be called archive, uploads or live", async () => {
  // Spec 28 commit 7: these name the intake's own directories in the content root. A book called
  // archive would publish into the directory the previous versions live in, and then be hidden
  // from the Library by the rule that stops an archive being counted as a book.
  for (const id of ["archive", "uploads", "live"]) {
    assert.equal(validBookId(id), false, id);
    const r = await recordUpload(prof.id, { bookId: id, blobPath: `uploads/${id}/x.zip`, fileName: "x.zip", sizeBytes: 10 });
    assert.equal(r.ok, false, `recordUpload refuses ${id}`);
  }
  assert.equal(validBookId("archives"), true, "only the exact names, not anything resembling them");
  assert.equal(validBookId("sad"), true);
});

await t("the register is found wherever Drive's zip puts the folder", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "find-"));
  execFileSync("mkdir", ["-p", path.join(dir, "a", "FZ1001_v2_CURRENT", "Archive")]);
  writeFileSync(path.join(dir, "a", "FZ1001_v2_CURRENT", "STATE_OF_RECORD.md"), "x");
  writeFileSync(path.join(dir, "a", "FZ1001_v2_CURRENT", "Archive", "STATE_OF_RECORD.md"), "old");
  assert.equal(findShelf(dir), path.join(dir, "a", "FZ1001_v2_CURRENT"), "archived registers are ignored");
});

// ---- Spec 16: the integrity check, which never fired in this job ---------------------------------
// The gate reads <out>/<book>/intake.lock.json and this job builds in a fresh temp directory, so
// before Spec 16 every run reported "first admission". These exercise it against a real lock in
// storage, through the real job.

/** The lock a publish left in storage, parsed. */
const liveLock = () => JSON.parse(new TextDecoder().decode(store.get("live/sad/intake.lock.json")!));

/** Run a check over a shelf and return its report. Nothing is published. */
async function checkOnly(zipName: string, mutate?: (root: string) => void) {
  const id = await uploaded(zipName, shelfZip(zipName, mutate));
  const r = await runJob({ uploadId: id, action: "check", blob });
  return { outcome: r, upload: (await getUpload(id))!, id };
}

await t("the lock a publish wrote is in storage and names the chapters and the front matter", () => {
  const lock = liveLock();
  assert.ok(lock.files, "the lock has a files map");
  assert.ok(lock.files["ch01"]?.sha256, "a chapter entry with a hash");
  assert.ok(lock.files["ch01"]?.version, "and its version");
  assert.ok(lock.files["front-matter"]?.sha256, "a front matter entry");
  assert.ok(Object.keys(lock.files).some((k) => k.startsWith("bank:")), "and the bank files");
  assert.ok(lock.registerVersion, "and the register version");
});

await t("rule 8 — unchanged content passes, and the gate now actually compares", async () => {
  const { outcome, upload } = await checkOnly("sad-same.zip");
  assert.equal(outcome, "ready", upload.message ?? "");
  assert.match(upload.report!, /Version integrity \(content hash\)/);
  assert.doesNotMatch(upload.report!, /first admission/,
    "the lock was downloaded, so this is no longer a first admission");
  assert.match(upload.report!, /no content changed under an unchanged version/);
});

/**
 * Change a file's bytes and correct the size the register records for it, so the register's own
 * byte-count gate stays satisfied and the integrity gate is what is being tested.
 *
 * This is the case SAD's register warns about in its own words: two builds of the front matter
 * differing by one character have the same size, so "size alone cannot tell the two apart" and
 * only a hash does. Here the size is made to agree on purpose, to isolate the hash.
 */
function repointRegisterSize(root: string, lane: string, file: string) {
  const reg = path.join(root, "STATE_OF_RECORD.md");
  const size = readFileSync(path.join(root, lane, file)).byteLength;
  const text = readFileSync(reg, "utf8");
  const row = new RegExp(`(\\| \`${lane}\` \\| \`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` \\| )[\\d,]+`);
  assert.match(text, row, `no byte row for ${lane}/${file} to correct`);
  writeFileSync(reg, text.replace(row, `$1${size.toLocaleString("en-US")}`));
}

await t("rule 8 — changed chapter content under the same version stops, and publishes nothing", async () => {
  const before = [...store.keys()].filter((k) => k.startsWith("live/sad/")).length;
  const { outcome, upload } = await checkOnly("sad-drift.zip", (root) => {
    // same package name, so the same version, with different bytes inside
    const pkg = path.join(root, "04_Chapters", "Chapter_01_Package_v1.3.zip");
    writeFileSync(pkg, Buffer.concat([readFileSync(pkg), Buffer.from([0])]));
    repointRegisterSize(root, "04_Chapters", "Chapter_01_Package_v1.3.zip");
  });
  assert.equal(outcome, "stopped", upload.message ?? "");
  assert.match(upload.report!, /content changed but version still v1\.3 — bump the version/);
  assert.equal([...store.keys()].filter((k) => k.startsWith("live/sad/")).length, before,
    "a stopped check publishes nothing");
});

await t("rule 8 — changed content with a raised version passes", async () => {
  const { outcome, upload } = await checkOnly("sad-bumped.zip", (root) => {
    const dir = path.join(root, "04_Chapters");
    const pkg = path.join(dir, "Chapter_01_Package_v1.3.zip");
    writeFileSync(path.join(dir, "Chapter_01_Package_v1.4.zip"),
      Buffer.concat([readFileSync(pkg), Buffer.from([0])]));
    rmSync(pkg);
    // the register lists each file by name with its size, so both move when a version is raised
    const reg = path.join(root, "STATE_OF_RECORD.md");
    writeFileSync(reg, readFileSync(reg, "utf8")
      .replace(/Chapter_01_Package_v1\.3\.zip/g, "Chapter_01_Package_v1.4.zip"));
    repointRegisterSize(root, "04_Chapters", "Chapter_01_Package_v1.4.zip");
  });
  assert.equal(outcome, "ready", upload.message ?? upload.report?.slice(-700));
  assert.match(upload.report!, /no content changed under an unchanged version/);
});

await t("rule 8 — changed front matter under the same version stops", async () => {
  const { outcome, upload } = await checkOnly("sad-fm.zip", (root) => {
    const fm = path.join(root, "00_Front_Matter", "Book_Front_Matter_v1.6.md");
    writeFileSync(fm, readFileSync(fm, "utf8") + "\n<!-- edited without a version bump -->\n");
    repointRegisterSize(root, "00_Front_Matter", "Book_Front_Matter_v1.6.md");
  });
  assert.equal(outcome, "stopped", upload.message ?? "");
  assert.match(upload.report!, /front matter changed but version still v1\.6 — bump the version/);
});

await t("rule 8 — a changed bank file under an unchanged register version warns, and admits", async () => {
  const { outcome, upload } = await checkOnly("sad-bank.zip", (root) => {
    const f = path.join(root, "07_Question_Banks", "questions", "ch01.json");
    const qs = JSON.parse(readFileSync(f, "utf8"));
    qs[0].stem = qs[0].stem + " (reworded without a register bump)";
    writeFileSync(f, JSON.stringify(qs));
    repointRegisterSize(root, "07_Question_Banks", "questions/ch01.json");
  });
  assert.equal(outcome, "ready", `a bank change must warn, not stop: ${upload.message ?? ""}`);
  assert.match(upload.report!, /Version integrity \(question bank\)/);
  assert.match(upload.report!, /questions\/ch01\.json: changed but the register is still/);
});

await t("rule 8 — no lock in storage means a first admission", async () => {
  const saved = store.get("live/sad/intake.lock.json")!;
  store.delete("live/sad/intake.lock.json");
  try {
    const { outcome, upload } = await checkOnly("sad-nolock.zip");
    assert.equal(outcome, "ready", upload.message ?? "");
    assert.match(upload.report!, /first admission — hashes recorded/);
  } finally {
    store.set("live/sad/intake.lock.json", saved);
  }
});

await t("rule 8 — an unreadable lock warns and is treated as a first admission", async () => {
  const saved = store.get("live/sad/intake.lock.json")!;
  store.set("live/sad/intake.lock.json", new TextEncoder().encode("{ this is not json"));
  try {
    const { outcome, upload } = await checkOnly("sad-badlock.zip");
    assert.equal(outcome, "ready", "an unreadable lock must never stop the job");
    assert.match(upload.report!, /first admission — hashes recorded/);
    assert.match(upload.message ?? "", /could not be read/);
  } finally {
    store.set("live/sad/intake.lock.json", saved);
  }
});

await t("rule 9 — a check run leaves storage exactly as it was", async () => {
  const before = new Map([...store.entries()].map(([k, v]) => [k, v.byteLength]));
  await checkOnly("sad-readonly.zip");
  const after = new Map([...store.entries()].map(([k, v]) => [k, v.byteLength]));
  // the uploaded zip itself is new; nothing under live/ or archive/ may move
  const interesting = (m: Map<string, number>) =>
    [...m].filter(([k]) => k.startsWith("live/") || k.startsWith("archive/")).sort();
  assert.deepEqual(interesting(after), interesting(before), "a check wrote to live/ or archive/");
});

console.log(`\n${passed} passed`);
