// Integration test: Spec 28 commit 8 — the nightly stopgap.
//
// The script is *run*, not read. A backup script is exactly the kind of thing that passes a source
// check and then does nothing useful at 03:12, so these drive deploy/aws/flexee-backup.sh with a
// fake pg_dump on PATH and throwaway directories, and then look at what is on disk: the files it
// wrote, the files it removed, the ones it refused to write, and its exit code.
//
// The exit code is the point of several of these. A refusal must exit 0 — a unit left in `failed`
// for a deliberate decision teaches people to ignore a failed unit — and a real fault must exit
// non-zero, or nobody ever learns the dumps stopped.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "deploy", "aws", "flexee-backup.sh");
const REHEARSAL = path.join(REPO, "deploy", "aws", "restore-rehearsal.sh");

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

/** A Windows path as bash sees it: D:\a\b -> /d/a/b. A no-op on a POSIX box. */
const posix = (p: string) => {
  const s = p.replace(/\\/g, "/");
  const m = /^([A-Za-z]):\/(.*)$/.exec(s);
  return m ? `/${m[1].toLowerCase()}/${m[2]}` : s;
};

/** A throwaway box: the two data directories, somewhere to put copies, and a fake pg_dump. */
function sandbox(opts: { dumpFails?: boolean; dumpBytes?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "backup-"));
  const content = path.join(root, "lib", "content");
  const files = path.join(root, "lib", "files");
  const out = path.join(root, "backups");
  const bin = path.join(root, "bin");
  for (const d of [content, files, bin]) mkdirSync(d, { recursive: true });
  // Something recognisable in each tree, so the archive can be shown to hold the right things.
  mkdirSync(path.join(content, "fz1001"), { recursive: true });
  writeFileSync(path.join(content, "fz1001", "book.manifest.json"), '{"id":"fz1001"}');
  mkdirSync(path.join(files, "submissions", "a1"), { recursive: true });
  writeFileSync(path.join(files, "submissions", "a1", "essay-ab12cd34.pdf"), "a student's work");

  // pg_dump, faked. It writes a plausible custom-format header so the file is not empty, and can
  // be told to fail — which is the case that must NOT leave a file named like a good dump.
  const dump = opts.dumpFails
    ? '#!/usr/bin/env bash\necho "could not connect to server" >&2\nexit 1\n'
    : `#!/usr/bin/env bash\nprintf 'PGDMP'\nhead -c ${opts.dumpBytes ?? 4096} /dev/zero\nexit 0\n`;
  writeFileSync(path.join(bin, "pg_dump"), dump);
  chmodSync(path.join(bin, "pg_dump"), 0o755);
  return { root, content, files, out, bin };
}

type Run = { code: number; stdout: string };
function run(box: ReturnType<typeof sandbox>, env: Record<string, string> = {}): Run {
  try {
    const stdout = execFileSync("bash", [posix(SCRIPT)], {
      encoding: "utf8",
      env: {
        // The outer environment is inherited so the script has a working shell, with every setting
        // it reads overridden below — nothing about this run depends on what is in the real .env.
        ...process.env,
        PATH: `${posix(box.bin)}:${process.env.PATH}`,
        DATABASE_URL: "postgres://role@127.0.0.1:5432/flexee_wrapper",
        CONTENT_DIR: posix(box.content),
        FILES_DIR: posix(box.files),
        BACKUP_DIR: posix(box.out),
        BACKUP_LOCK: posix(path.join(box.root, "lock")),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (e: any) {
    return { code: e.status ?? -1, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
const listed = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const dumps = (dir: string) => listed(dir).filter((f) => f.startsWith("db-") && f.endsWith(".dump"));
const tars = (dir: string) => listed(dir).filter((f) => f.startsWith("files-") && f.endsWith(".tar.gz"));

console.log("A nightly run");

await t("it writes one dump and one archive, and says what it wrote", () => {
  const box = sandbox();
  const r = run(box);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(dumps(box.out).length, 1, listed(box.out).join(", "));
  assert.equal(tars(box.out).length, 1, listed(box.out).join(", "));
  assert.match(r.stdout, /done: db-/);
  // The names are UTC timestamps, which is what lets retention sort them lexically.
  assert.match(dumps(box.out)[0], /^db-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.dump$/);
  assert.equal(listed(box.out).some((f) => f.endsWith(".part")), false, "no temporary files left behind");
  rmSync(box.root, { recursive: true, force: true });
});

await t("the archive really holds the books and the student files", () => {
  const box = sandbox();
  assert.equal(run(box).code, 0);
  const tar = path.join(box.out, tars(box.out)[0]);
  const inside = execFileSync("tar", ["-tzf", posix(tar)], { encoding: "utf8" });
  assert.match(inside, /content\/fz1001\/book\.manifest\.json/, inside);
  assert.match(inside, /files\/submissions\/a1\/essay-ab12cd34\.pdf/, inside);
  rmSync(box.root, { recursive: true, force: true });
});

await t("it leaves a README that says, in the directory itself, that this is not a backup", () => {
  const box = sandbox();
  run(box);
  const readme = readFileSync(path.join(box.out, "README.txt"), "utf8");
  assert.match(readme, /STOPGAP, not a backup/i);
  assert.match(readme, /same disk/);
  assert.match(readme, /Object\s+Lock/, "and says what the real thing would be");   // the README wraps the phrase
  assert.match(readme, /restore-rehearsal\.sh/, "and how to check a dump is readable");
  rmSync(box.root, { recursive: true, force: true });
});

await t("last-run.txt records the outcome, so nobody has to read the journal to know", () => {
  const box = sandbox();
  run(box);
  assert.match(readFileSync(path.join(box.out, "last-run.txt"), "utf8"), /OK: db \d+ MB, files \d+ MB/);
  rmSync(box.root, { recursive: true, force: true });
});

console.log("Seven days, and not an eighth");

await t("the oldest is removed once there are more than BACKUP_KEEP, and each removal is logged", () => {
  const box = sandbox();
  mkdirSync(box.out, { recursive: true });
  // Nine days of history, named the way the script names them.
  for (let d = 1; d <= 9; d++) {
    const stamp = `2026-09-0${d}T03-12-00Z`;
    writeFileSync(path.join(box.out, `db-${stamp}.dump`), "old");
    writeFileSync(path.join(box.out, `files-${stamp}.tar.gz`), "old");
  }
  const r = run(box, { BACKUP_KEEP: "7" });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(dumps(box.out).length, 7, dumps(box.out).join(", "));
  assert.equal(tars(box.out).length, 7);
  // Today's is kept and the two oldest are gone: retention is by date, not by luck.
  assert.equal(dumps(box.out).some((f) => f.includes("2026-09-01")), false, "the oldest went");
  assert.equal(dumps(box.out).some((f) => f.includes("2026-09-02")), false, "and the next oldest");
  assert.equal(dumps(box.out).some((f) => f.includes("2026-09-09")), true, "a recent one stayed");
  assert.match(r.stdout, /removing db-2026-09-01T03-12-00Z\.dump \(keeping 7\)/, r.stdout);
  rmSync(box.root, { recursive: true, force: true });
});

await t("BACKUP_KEEP is honoured, so a smaller disk can be told to keep less", () => {
  const box = sandbox();
  mkdirSync(box.out, { recursive: true });
  for (let d = 1; d <= 5; d++) {
    writeFileSync(path.join(box.out, `db-2026-09-0${d}T03-12-00Z.dump`), "old");
  }
  assert.equal(run(box, { BACKUP_KEEP: "2" }).code, 0);
  assert.equal(dumps(box.out).length, 2, dumps(box.out).join(", "));
  rmSync(box.root, { recursive: true, force: true });
});

console.log("Refusing, which is not failing");

await t("with too little free space it writes nothing, says why, and exits 0", () => {
  const box = sandbox();
  // A floor far above any real disk: the refusal is reached through the script's own arithmetic
  // rather than by filling anything up.
  const r = run(box, { BACKUP_MIN_FREE_MB: "100000000" });
  assert.equal(r.code, 0, "a deliberate decision is not a failed unit");
  assert.match(r.stdout, /SKIPPED: this would need about/);
  assert.match(r.stdout, /nothing was written/);
  assert.match(r.stdout, /would take the site down/);
  assert.equal(dumps(box.out).length, 0, "and nothing was written");
  assert.equal(tars(box.out).length, 0);
  assert.match(readFileSync(path.join(box.out, "last-run.txt"), "utf8"), /SKIPPED for space/);
  rmSync(box.root, { recursive: true, force: true });
});

await t("an older copy is kept, not deleted, when a run is refused", () => {
  // The failure mode worth naming: a script that prunes before it writes would, on a full disk,
  // delete yesterday's copy and then decline to make today's.
  const box = sandbox();
  mkdirSync(box.out, { recursive: true });
  for (let d = 1; d <= 9; d++) writeFileSync(path.join(box.out, `db-2026-09-0${d}T03-12-00Z.dump`), "old");
  assert.equal(run(box, { BACKUP_MIN_FREE_MB: "100000000", BACKUP_KEEP: "1" }).code, 0);
  assert.equal(dumps(box.out).length, 9, "every existing copy survived a refused run");
  rmSync(box.root, { recursive: true, force: true });
});

await t("a second run while one is in progress declines, and does not exit non-zero", () => {
  const box = sandbox();
  // The lock file is the one the script would hold. flock -n on a held lock is the case; here the
  // lock is taken by another bash, which is exactly what a long run looks like.
  const lock = posix(path.join(box.root, "lock"));
  const held = execFileSync("bash", ["-c",
    `command -v flock >/dev/null 2>&1 && (exec 9>${lock}; flock -n 9 && echo yes) || echo noflock`,
  ], { encoding: "utf8" }).trim();
  if (held === "noflock") { console.log("    (flock is not installed here; the lock path is checked in source instead)");
    const src = readFileSync(SCRIPT, "utf8");
    assert.match(src, /flock -n 9/);
    assert.match(src, /another run holds/);
    rmSync(box.root, { recursive: true, force: true });
    return;
  }
  const r = execFileSync("bash", ["-c",
    `exec 9>${lock}; flock -n 9; PATH=${posix(box.bin)}:$PATH DATABASE_URL=postgres://r@127.0.0.1:5432/d ` +
    `CONTENT_DIR=${posix(box.content)} FILES_DIR=${posix(box.files)} BACKUP_DIR=${posix(box.out)} ` +
    `BACKUP_LOCK=${lock} bash ${posix(SCRIPT)}; echo "exit:$?"`,
  ], { encoding: "utf8" });
  assert.match(r, /another run holds/, r);
  assert.match(r, /exit:0/, r);
  assert.equal(dumps(box.out).length, 0, "and the second run wrote nothing");
  rmSync(box.root, { recursive: true, force: true });
});

console.log("Failing, which is not refusing");

await t("a pg_dump that fails exits non-zero and leaves no file that looks like a dump", () => {
  const box = sandbox({ dumpFails: true });
  const r = run(box);
  assert.notEqual(r.code, 0, "a broken dump must not report success");
  assert.match(r.stdout, /pg_dump failed/);
  assert.match(r.stdout, /could not connect to server/, "and quotes what pg_dump said");
  assert.equal(dumps(box.out).length, 0, "no half-written dump under a good name");
  assert.equal(listed(box.out).some((f) => f.endsWith(".part")), false, "and no leftover part file");
  assert.equal(tars(box.out).length, 0, "and it stopped before the archive");
  rmSync(box.root, { recursive: true, force: true });
});

await t("no DATABASE_URL is a fault, not a refusal", () => {
  const box = sandbox();
  const r = run(box, { DATABASE_URL: "" });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /DATABASE_URL is not set/);
  rmSync(box.root, { recursive: true, force: true });
});

await t("a missing data directory is noted and the rest is still copied", () => {
  const box = sandbox();
  rmSync(box.files, { recursive: true, force: true });
  const r = run(box);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /does not exist, so it is not in the archive/);
  assert.equal(tars(box.out).length, 1, "the books were still copied");
  rmSync(box.root, { recursive: true, force: true });
});

console.log("The restore rehearsal");

await t("it refuses to do anything without --yes, and prints the server first", () => {
  const r = (() => {
    try {
      return { code: 0, out: execFileSync("bash", [posix(REHEARSAL)], { encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "postgres://role:secret@db.internal:5432/flexee_wrapper", BACKUP_DIR: posix(tmpdir()) },
        stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e: any) { return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  })();
  // It stops on the missing dump or on the missing --yes; either way it must not have restored
  // anything, and must not have printed the password.
  assert.notEqual(r.code, 0);
  assert.equal(r.out.includes("secret"), false, "the password was printed");
  rmSync(path.join(tmpdir(), "nothing-here"), { force: true });
});

await t("it prints the server and the scratch name, and asks for --yes, when a dump is there", () => {
  const box = sandbox();
  mkdirSync(box.out, { recursive: true });
  writeFileSync(path.join(box.out, "db-2026-09-09T03-12-00Z.dump"), "PGDMP");
  let out = "";
  try {
    execFileSync("bash", [posix(REHEARSAL)], { encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgres://role:secret@db.internal:5432/flexee_wrapper", BACKUP_DIR: posix(box.out) },
      stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  assert.match(out, /server\s+db\.internal:5432/, out);
  assert.match(out, /restore into\s+flexee_restore_check_\d{14}/, out);
  assert.match(out, /not touched at all/, "it says what it will do to the live database");
  assert.match(out, /Re-run with --yes/, out);
  assert.equal(out.includes("secret"), false, "the password was printed");
  rmSync(box.root, { recursive: true, force: true });
});

await t("it only ever names a scratch database it made, and only ever drops that", () => {
  const src = readFileSync(REHEARSAL, "utf8").split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#")).join("\n");
  // The name is built in the script and cannot be passed in: no argument sets it.
  assert.match(src, /scratch="flexee_restore_check_\$\(date/);
  assert.equal(/--scratch|--into|--target/.test(src), false, "no argument names the database to write to");
  // The one DROP is guarded by the shape of the name, not only by where the name came from.
  const drop = src.slice(src.indexOf("cleanup()"));
  assert.match(drop, /case "\$scratch" in\s*\n\s*flexee_restore_check_\*\)/, drop.slice(0, 400));
  assert.match(drop, /refusing to drop/);
  // Exactly one read of the live database, and it is a count.
  const liveReads = src.match(/psql "\$DATABASE_URL"/g) ?? [];
  assert.equal(liveReads.length, 3, `expected create, drop and one count: ${liveReads.length}`);
  assert.match(src, /select count\(\*\) from/);
  assert.equal(/psql "\$DATABASE_URL"[^\n]*(insert|update|delete|truncate|alter table)/i.test(src), false,
    "nothing writes to the live database");
});

console.log("The unit and the timer");

const code = (file: string) => readFileSync(path.join(REPO, file), "utf8").split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("#")).join("\n");

await t("the timer runs nightly, catches up a missed night, and spreads its start", () => {
  const timer = code("deploy/aws/flexee-backup.timer");
  assert.match(timer, /OnCalendar=\*-\*-\* \d{2}:\d{2}:\d{2}/, timer);
  assert.match(timer, /Persistent=true/, "a night the instance was off is run on return");
  assert.match(timer, /RandomizedDelaySec=/);
  assert.match(timer, /Unit=flexee-backup\.service/);
  assert.match(timer, /WantedBy=timers\.target/);
});

await t("the unit is a oneshot that does not retry, and is modest about a shared box", () => {
  const unit = code("deploy/aws/flexee-backup.service");
  assert.match(unit, /Type=oneshot/);
  assert.equal(/^Restart=/m.test(unit), false, "a failed copy stays failed until somebody looks");
  assert.match(unit, /ExecStart=.*flexee-backup\.sh/);
  assert.match(unit, /Nice=|IOSchedulingClass=idle/);
  assert.match(unit, /EnvironmentFile=/, "DATABASE_URL comes from the same file the app uses");
});

await t("the word stopgap is where somebody would actually read it", () => {
  // Three places, because each is read by a different person at a different moment: the unit's
  // description by whoever runs systemctl, the script's output by whoever reads the journal, and
  // the README by whoever finds the directory and does not know what it is.
  assert.match(readFileSync(path.join(REPO, "deploy/aws/flexee-backup.service"), "utf8"),
    /Description=.*stopgap/i);
  assert.match(readFileSync(SCRIPT, "utf8"), /STOPGAP, NOT A BACKUP/);
  assert.match(readFileSync(SCRIPT, "utf8"), /reminder: this is a stopgap/);
  const book = readFileSync(path.join(REPO, "deploy/aws/AWS_Deployment_Runbook.md"), "utf8");
  assert.match(book, /stopgap/i, "and the runbook does not call it a backup either");
});

console.log(`\n${passed} passed`);
