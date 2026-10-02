// Integration test: the book library — upload rules and GitHub dispatch (lib/library), and the
// intake job (scripts/library-intake.ts) end to end: a real SAD test shelf, zipped as Drive zips a
// folder, run through the real intake and validator against a simulated Blob store.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

// Blob, simulated.
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
  const root = path.join(dir, "MIS3250_v2_CURRENT"); // Drive zips a folder with the folder itself inside
  execFileSync("python3", ["-c", BUILD_SHELF], {
    env: { ...process.env, FIXTURES_DIR: path.join(REPO, "scripts", "fixtures"), SHELF_ROOT: root },
  });
  mutate?.(root);
  const zip = path.join(dir, name);
  execFileSync("python3", ["-c", ZIP_DIR], { env: { ...process.env, ZIP_ROOT: root, ZIP_OUT: zip } });
  return readFileSync(zip);
}
async function uploaded(name: string, bytes: Uint8Array, who = prof.id) {
  const p = `uploads/sad/${name}`; store.set(p, new Uint8Array(bytes));
  const r = await recordUpload(who, { bookId: "sad", blobPath: p, fileName: name, sizeBytes: bytes.length });
  return (r as any).id as string;
}

console.log("The intake job (real intake, real validator, simulated Blob)");
const good = shelfZip("sad-v1.zip");
const idGood = await uploaded("sad-v1.zip", good);
await t("check: a correct book comes back ready, with the intake's report and register version", async () => {
  assert.equal(await runJob({ uploadId: idGood, action: "check", blob, syncDb, runUrl: "https://github.com/run/1" }), "ready");
  const u = await getUpload(idGood);
  assert.equal(u!.status, "ready"); assert.match(u!.report!, /READY TO APPROVE/); assert.equal(u!.registerVersion, "6.17");
  assert.equal(u!.runUrl, "https://github.com/run/1");
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
  assert.equal(await runJob({ uploadId: idGood, action: "publish", blob, syncDb }), "published");
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
});
await t("a file that is not a zip, or a zip with no register, fails with a plain explanation", async () => {
  const notZip = await uploaded("junk.zip", new TextEncoder().encode("not a zip"));
  assert.equal(await runJob({ uploadId: notZip, action: "check", blob, syncDb }), "failed");
  assert.match((await getUpload(notZip))!.message!, /not a readable zip/);
  const dir = mkdtempSync(path.join(tmpdir(), "noreg-")); writeFileSync(path.join(dir, "readme.txt"), "hello");
  execFileSync("python3", ["-c", ZIP_ONE], { env: { ...process.env, ZIP_IN: path.join(dir, "readme.txt"), ZIP_OUT: path.join(dir, "n.zip") } });
  const noReg = await uploaded("noreg.zip", readFileSync(path.join(dir, "n.zip")));
  assert.equal(await runJob({ uploadId: noReg, action: "check", blob, syncDb }), "failed");
  assert.match((await getUpload(noReg))!.message!, /no STATE_OF_RECORD\.md/);
  rmSync(dir, { recursive: true, force: true });
});
await t("the register is found wherever Drive's zip puts the folder", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "find-"));
  execFileSync("mkdir", ["-p", path.join(dir, "a", "MIS3250_v2_CURRENT", "Archive")]);
  writeFileSync(path.join(dir, "a", "MIS3250_v2_CURRENT", "STATE_OF_RECORD.md"), "x");
  writeFileSync(path.join(dir, "a", "MIS3250_v2_CURRENT", "Archive", "STATE_OF_RECORD.md"), "old");
  assert.equal(findShelf(dir), path.join(dir, "a", "MIS3250_v2_CURRENT"), "archived registers are ignored");
});

console.log(`\n${passed} passed`);
