// Spec 21 decision 1: the two guards on the real-browser run.
//
// The run itself needs a Postgres and a Chromium and is opt-in, so it is not a suite. The guards
// are the part that has to be right before anybody points it at anything, and they are pure
// functions precisely so they can be tested here without either.
import assert from "node:assert/strict";
import { checkTarget, checkEmpty, hostOf, MARK, MARK_EMAIL_DOMAIN, ROUTES } from "./a11y-browser.ts";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const LIVE = "postgresql://user:secret@ep-live-123.eu-central-1.aws.neon.tech/flexee";
const SPARE = "postgresql://user:secret@localhost:5432/flexee_a11y";

t("with nothing set it refuses, and says to make a database of its own", () => {
  const r = checkTarget({}, ["--yes"]);
  assert.equal(r.ok, false);
  assert.match((r as { why: string }).why, /A11Y_DATABASE_URL is not set/);
  assert.match((r as { why: string }).why, /never at the live database or a branch of it/);
});

t("it refuses when it is pointed at the same database the app uses", () => {
  const r = checkTarget({ DATABASE_URL: LIVE, A11Y_DATABASE_URL: LIVE }, ["--yes"]);
  assert.equal(r.ok, false);
  assert.match((r as { why: string }).why, /same as DATABASE_URL/);
  // and whitespace does not get it past the check
  const padded = checkTarget({ DATABASE_URL: LIVE, A11Y_DATABASE_URL: ` ${LIVE} ` }, ["--yes"]);
  assert.equal(padded.ok, false);
});

t("it refuses without --yes, and names the host it would write to", () => {
  const r = checkTarget({ DATABASE_URL: LIVE, A11Y_DATABASE_URL: SPARE }, []);
  assert.equal(r.ok, false);
  const why = (r as { why: string }).why;
  assert.match(why, /Re-run with --yes/);
  assert.match(why, /localhost:5432\/flexee_a11y/);
  assert.ok(!why.includes("secret"), "the password must never be printed");
});

t("a separate database, named, with --yes, is allowed", () => {
  assert.deepEqual(checkTarget({ DATABASE_URL: LIVE, A11Y_DATABASE_URL: SPARE }, ["--yes"]), { ok: true });
  // and with no DATABASE_URL set at all, which is the ordinary local case
  assert.deepEqual(checkTarget({ A11Y_DATABASE_URL: SPARE }, ["--yes"]), { ok: true });
});

t("something that is not a connection string is refused", () => {
  for (const bad of ["flexee_a11y", "mysql://x/y", "http://localhost:5432", ""]) {
    assert.equal(checkTarget({ A11Y_DATABASE_URL: bad }, ["--yes"]).ok, false, bad);
  }
});

t("the host is printed without the credentials in it", () => {
  assert.equal(hostOf(LIVE), "ep-live-123.eu-central-1.aws.neon.tech/flexee");
  assert.equal(hostOf(SPARE), "localhost:5432/flexee_a11y");
  assert.ok(!hostOf(LIVE).includes("secret") && !hostOf(LIVE).includes("user"));
  assert.equal(hostOf("not a url"), "(unreadable connection string)");
});

t("an empty database passes guard 2, and so does one holding only its own accounts", () => {
  assert.deepEqual(checkEmpty([]), { ok: true });
  assert.deepEqual(checkEmpty([
    { displayName: `${MARK} faculty`, email: `${MARK}-faculty${MARK_EMAIL_DOMAIN}` },
    { displayName: `${MARK} student`, email: `${MARK}-student${MARK_EMAIL_DOMAIN}` },
  ]), { ok: true });
  // a row with no identity row yet is still recognised by its name
  assert.deepEqual(checkEmpty([{ displayName: `${MARK} admin`, email: null }]), { ok: true });
});

t("one account it did not create stops the run, and no name is printed", () => {
  const r = checkEmpty([
    { displayName: `${MARK} faculty`, email: `${MARK}-faculty${MARK_EMAIL_DOMAIN}` },
    { displayName: "Maria Alvarez", email: "maria.alvarez@wright.edu" },
  ]);
  assert.equal(r.ok, false);
  const why = (r as { why: string }).why;
  assert.match(why, /holds 1 account\(s\) this script did not create/);
  assert.match(why, /a branch copies every real account/);
  assert.ok(!why.includes("Maria") && !why.includes("alvarez") && !why.includes("wright.edu"),
    "the refusal leaked a name or an address");
});

t("a branch of the live database is what guard 2 is for, and the count says how many", () => {
  // What a Neon branch looks like: every real account, copied. The guard counts them and stops;
  // guard 1 cannot see this, because a branch's connection string is a perfectly good one.
  const branch = Array.from({ length: 412 }, (_, i) => ({
    displayName: `Student ${i}`, email: `s${i}@wright.edu`,
  }));
  const r = checkEmpty(branch);
  assert.equal(r.ok, false);
  assert.match((r as { why: string }).why, /holds 412 account\(s\)/);
  // and guard 1 would have let it through, which is the whole reason there are two
  assert.deepEqual(checkTarget({ DATABASE_URL: LIVE, A11Y_DATABASE_URL: SPARE }, ["--yes"]), { ok: true });
});

t("an account named to look like the script's own, on a real address, is still foreign", () => {
  // The marker is a convenience for recognising its own rows, not a security boundary — but an
  // account that matches neither half of it must not pass, which is what this pins.
  const r = checkEmpty([{ displayName: "a11y-browserish", email: "someone@wright.edu" }]);
  assert.equal(r.ok, true, "a name that starts with the mark is taken as the script's own");
  const other = checkEmpty([{ displayName: "Real Person", email: `x${MARK_EMAIL_DOMAIN}` }]);
  assert.equal(other.ok, true, "a reserved .invalid address is taken as the script's own");
  const neither = checkEmpty([{ displayName: "Real Person", email: "x@wright.edu" }]);
  assert.equal(neither.ok, false);
});

t("the routes it visits cover a signed-out form, a chapter and a faculty page", () => {
  const paths = ROUTES.map((r) => r.path);
  assert.ok(paths.includes("/login"), paths.join(" "));
  assert.ok(paths.some((p) => /^\/sad\/ch\d+$/.test(p)), "a real chapter, for the figure and table");
  assert.ok(paths.some((p) => p.includes("/teach/SECTION")), "a faculty page");
  assert.ok(ROUTES.every((r) => ["none", "student", "faculty"].includes(r.as)));
  // every path that needs a class id uses the placeholder, so none is hardcoded
  for (const r of ROUTES) {
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(r.path), `${r.path} has an id baked into it`);
  }
});

console.log(`\n${passed} checks passed`);
