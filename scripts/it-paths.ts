// Integration test: Spec 28 commit 4 — where the three kinds of file live.
//
// Pure. What this really guards is that the defaults are unchanged, because the whole commit is
// supposed to be invisible until the settings are set: ten callers read CONTENT_DIR today, every
// suite reads the repository's own content/ tree, and a developer's machine must keep working with
// nothing configured. The deployment rule — that none of these may sit inside the git checkout —
// is enforced by deploy/aws/deploy.sh, and the checks at the end pin that script rather than
// re-implement it.
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { contentDir, filesDir, intakeWorkDir, isInside } from "@/lib/paths";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

/** A shell script with its comment lines removed, for checks about what the code does or does not do. */
const shellCode = (file: string) =>
  readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

t("with nothing set, the defaults are what they have always been", () => {
  // The invisibility requirement. CONTENT_DIR's default is the repository's own content/, which is
  // where it pointed before this module existed and where every suite expects to find it.
  assert.equal(contentDir({}), path.join(process.cwd(), "content"));
  assert.equal(intakeWorkDir({}), tmpdir(), "the intake built in tmpdir() before, and still does");
  assert.equal(filesDir({}), path.join(process.cwd(), "files"));
});

t("each setting is honoured when given, and only its own", () => {
  const env = { CONTENT_DIR: "/var/lib/flexee/content", FILES_DIR: "/var/lib/flexee/files",
                INTAKE_WORK_DIR: "/var/lib/flexee/work" };
  assert.equal(contentDir(env), "/var/lib/flexee/content");
  assert.equal(filesDir(env), "/var/lib/flexee/files");
  assert.equal(intakeWorkDir(env), "/var/lib/flexee/work");
  // One set does not move the others off their defaults.
  assert.equal(filesDir({ CONTENT_DIR: "/var/lib/flexee/content" }), path.join(process.cwd(), "files"));
  assert.equal(intakeWorkDir({ CONTENT_DIR: "/var/lib/flexee/content" }), tmpdir());
});

t("an empty setting falls back rather than resolving to the process's directory", () => {
  // CONTENT_DIR="" in a unit file or a .env is a plausible mistake, and `||` is what makes it
  // harmless: an empty string would otherwise join to the current directory and the app would
  // look for books in the repository root.
  assert.equal(contentDir({ CONTENT_DIR: "" }), path.join(process.cwd(), "content"));
  assert.equal(filesDir({ FILES_DIR: "" }), path.join(process.cwd(), "files"));
  assert.equal(intakeWorkDir({ INTAKE_WORK_DIR: "" }), tmpdir());
});

t("books and student files are never the same directory", () => {
  // The reason they are two settings: different retention, different sensitivity, and a submission
  // is not regenerable while a book is. Sharing one directory would make a selective restore
  // impossible.
  assert.notEqual(contentDir({}), filesDir({}));
  const env = { CONTENT_DIR: "/var/lib/flexee/content", FILES_DIR: "/var/lib/flexee/files" };
  assert.notEqual(contentDir(env), filesDir(env));
  assert.ok(!isInside(filesDir(env), contentDir(env)), "nor nested inside one another");
  assert.ok(!isInside(contentDir(env), filesDir(env)));
});

t("isInside treats equal as inside, which is the fault it exists to catch", () => {
  // CONTENT_DIR being the checkout root is the same mistake as it being a directory within it.
  assert.equal(isInside("/var/www/app", "/var/www/app"), true);
  assert.equal(isInside("/var/www/app/content", "/var/www/app"), true);
  assert.equal(isInside("/var/lib/flexee/content", "/var/www/app"), false);
  // A relative path that climbs back in is still inside.
  assert.equal(isInside(path.join(process.cwd(), "sub", "..", "content"), process.cwd()), true);
  // And a sibling whose name merely starts the same way is not inside.
  assert.equal(isInside("/var/www/app-data", "/var/www/app"), false,
    "a prefix match on the string is not a path match");
});

t("the intake no longer reaches for tmpdir() directly", () => {
  // The whole point of the setting: on the box /tmp is on the root disk, so moving CONTENT_DIR to
  // its own volume would not have moved a 200 MB zip's unpacking. If the import comes back, the
  // setting has been bypassed.
  const src = readFileSync("scripts/library-intake.ts", "utf8");
  assert.ok(src.includes("intakeWorkDir()"), "it must build in the configured work directory");
  assert.ok(!/from "node:os"/.test(src), "and no longer import tmpdir at all");
});

t("deploy.sh refuses a path inside the checkout, and says why", () => {
  // The deployment rule lives in the deploy script, not in this module, because inside the checkout
  // is the *correct* place on a developer's machine — content/ is a test fixture. These checks pin
  // that the script still carries the rule; its behaviour was verified by running it.
  // Comments are stripped before any of this, and that is not fussiness. A check for the *absence*
  // of something will otherwise match the comment explaining why it was removed — which is the
  // fourth time in this work that a source check has matched prose instead of code. Stripping
  // first is the general fix; the echo lines the positive checks look for are code, so they survive.
  const code = shellCode("deploy/aws/deploy.sh");
  for (const v of ["CONTENT_DIR", "FILES_DIR", "INTAKE_WORK_DIR"]) {
    assert.ok(code.includes(v), `${v} must be checked by the deploy script`);
  }
  assert.match(code, /inside the git checkout/, "and the refusal must say what is wrong");
  assert.match(code, /pwd -P/, "canonicalised with pwd -P on both sides");
  assert.ok(!/realpath/.test(code),
    "not realpath: the first draft mixed it with git rev-parse and silently never matched");
  assert.ok(!/rev-parse --show-toplevel/.test(code), "nor git's view of the root, for the same reason");
});

t("deploy.sh migrates with db:deploy, not db:migrate", () => {
  // db:migrate is drizzle-kit, which reads drizzle.config.ts, whose dbCredentials fall back to
  // postgres://localhost/flexee — and a local Postgres exists on that box. db:deploy refuses
  // without DATABASE_URL instead.
  const code = shellCode("deploy/aws/deploy.sh");
  assert.ok(code.includes("npm run db:deploy"), "the deploy must use db:deploy");
  assert.ok(!code.includes("npm run db:migrate"), "and must not use db:migrate");
  // The fallback that makes this matter is still in the config, so the reason still holds.
  const cfg = readFileSync("drizzle.config.ts", "utf8");
  assert.match(cfg, /process\.env\.DATABASE_URL \|\|/,
    "if this fallback is ever removed, the db:deploy reasoning should be revisited");
});

t("deploy.sh restarts the worker as well as the app", () => {
  const code = shellCode("deploy/aws/deploy.sh");
  assert.ok(code.includes("systemctl restart flexee-wrapper"));
  assert.ok(code.includes("flexee-intake"), "once the worker exists, a deploy must restart it too");
  assert.ok(code.includes("list-unit-files"), "guarded, so it works before that unit is installed");
});

console.log("\n%d checks passed", passed);
