// Integration test: Spec 19 §1 — select and act, and rules 1, 2, 10 and 11.
//
// The server side is what matters here: a selection arrives as a list of ids from a page, and the
// rules say nothing from the page is trusted. The last case renders the real roster component and
// checks what a screen-reader user would be given.
import assert from "node:assert/strict";
import { and, count, eq } from "drizzle-orm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { publishClassBook } from "@/lib/publish";
import { setMailTransport, type Mail } from "@/lib/mail";
import { resendTo, removeStudents, REMOVE_PHRASE, actionsFor, describeAction } from "@/lib/class-actions";
import { withdrawStudents, restoreStudents } from "@/lib/withdraw";
import ClassRoster, { type RosterRow } from "@/components/ClassRoster";

const { users, identities, enrolments, lineItems, lineItemScores } = schema;
let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const outbox: Mail[] = [];
setMailTransport((m) => { outbox.push(m); return { ok: true }; });
const BASE = "https://wrapper.example.org";
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

async function account(name: string, email: string, password: string | null) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}
const admin = await account("Admin", "admin@flexee.org", "x"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org", "x");
const prof2 = await account("Other Prof", "prof2@flexee.org", "x");
const sec = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const other = await createSection(prof2.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
await publishClassBook(prof.id, sec.id);

/** Four states the quick selections exist for. */
async function enrol(name: string, email: string, o: { password?: string | null; demo?: boolean } = {}) {
  const u = await account(name, email, o.password ?? null);
  const [enr] = await db().insert(enrolments)
    .values({ sectionId: sec.id, userId: u.id, role: "student", isDemo: !!o.demo }).returning();
  return { user: u, enr };
}
const waiting1 = await enrol("Waiting One", "w1@wright.edu");
const waiting2 = await enrol("Waiting Two", "w2@wright.edu");
const setUp = await enrol("All Set", "set@wright.edu", { password: "chosen" });
const demo = await enrol("Demo Student", "demo@wright.edu", { demo: true });
const leaver = await enrol("Leaver", "leaver@wright.edu");

console.log("Rule 2 — resend skips what it should, and says why");

await t("it sends to the ones waiting and names every reason it skipped", async () => {
  outbox.length = 0;
  await withdrawStudents(prof.id, sec.id, [leaver.enr.id]);
  const r = await resendTo(prof.id, sec.id,
    [waiting1.enr.id, waiting2.enr.id, setUp.enr.id, demo.enr.id, leaver.enr.id], BASE);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  assert.equal(r.ok && r.sent, 2);
  assert.equal(r.ok && r.skipped, 3);
  assert.deepEqual(r.ok ? r.reasons : {}, { "already set up": 1, "demo account": 1, withdrawn: 1 });
  assert.deepEqual(outbox.map((m) => m.to).sort(), ["w1@wright.edu", "w2@wright.edu"]);
  await restoreStudents(prof.id, sec.id, [leaver.enr.id]);
});

await t("the three-an-hour limit is honoured, and counted as a reason", async () => {
  // A fresh student, so the count starts at nought and the sequence is unambiguous.
  const fresh = await enrol("Limit Test", "limit@wright.edu");
  const sent: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await resendTo(prof.id, sec.id, [fresh.enr.id], BASE);
    sent.push(r.ok ? r.sent : -1);
  }
  assert.deepEqual(sent, [1, 1, 1, 0], "three go, the fourth does not");
  const fourth = await resendTo(prof.id, sec.id, [fresh.enr.id], BASE);
  assert.deepEqual(fourth.ok ? fourth.reasons : {}, { "three already this hour": 1 });
});

console.log("Rule 1 — the server trusts nothing from the page");

await t("an id from another class refuses the whole call, for every action", async () => {
  const [theirs] = await db().insert(enrolments)
    .values({ sectionId: other.id, userId: admin.id, role: "student" }).returning();
  const mixed = [waiting2.enr.id, theirs.id];
  for (const [what, call] of [
    ["resend", () => resendTo(prof.id, sec.id, mixed, BASE)],
    ["withdraw", () => withdrawStudents(prof.id, sec.id, mixed)],
    ["restore", () => restoreStudents(prof.id, sec.id, mixed)],
    ["remove", () => removeStudents(prof.id, sec.id, mixed, { confirm: REMOVE_PHRASE })],
  ] as const) {
    const r = await call();
    assert.equal(r.ok, false, `${what} must refuse`);
    assert.match(r.ok === false ? r.error : "", /not in this class/, what);
  }
  assert.equal(await (async () => Number((await db().select({ c: count() }).from(enrolments)
    .where(eq(enrolments.id, waiting2.enr.id)))[0].c))(), 1, "and the id that was in this class is untouched");
});

await t("a repeated id is counted once, not twice", async () => {
  const r = await withdrawStudents(prof.id, sec.id, [waiting2.enr.id, waiting2.enr.id]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.changed, 1);
  await restoreStudents(prof.id, sec.id, [waiting2.enr.id]);
});

console.log("Rule 10 — who is refused");

await t("another class's faculty and a student get a refusal for every action", async () => {
  for (const who of [prof2.id, setUp.user.id]) {
    for (const [what, call] of [
      ["resend", () => resendTo(who, sec.id, [waiting1.enr.id], BASE)],
      ["withdraw", () => withdrawStudents(who, sec.id, [waiting1.enr.id])],
      ["restore", () => restoreStudents(who, sec.id, [waiting1.enr.id])],
      ["remove", () => removeStudents(who, sec.id, [waiting1.enr.id], { confirm: REMOVE_PHRASE })],
    ] as const) {
      const r = await call();
      assert.equal(r.ok, false, `${what} must refuse`);
    }
  }
  assert.equal(Number((await db().select({ c: count() }).from(enrolments).where(eq(enrolments.id, waiting1.enr.id)))[0].c), 1);
});

console.log("Acting on several at once");

await t("withdraw and restore work over a group, reporting what was already so", async () => {
  const a = await enrol("Group A", "ga@wright.edu");
  const b = await enrol("Group B", "gb@wright.edu");
  const first = await withdrawStudents(prof.id, sec.id, [a.enr.id, b.enr.id]);
  assert.equal(first.ok && first.changed, 2);
  const again = await withdrawStudents(prof.id, sec.id, [a.enr.id, b.enr.id]);
  assert.equal(again.ok && again.changed, 0);
  assert.equal(again.ok && again.skipped, 2);
  const back = await restoreStudents(prof.id, sec.id, [a.enr.id, b.enr.id]);
  assert.equal(back.ok && back.changed, 2);
});

await t("removing a group states the whole group's cost and needs one phrase", async () => {
  const a = await enrol("Cost A", "ca@wright.edu");
  const b = await enrol("Cost B", "cb@wright.edu");
  const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, sec.id)))[0];
  await db().insert(lineItemScores).values([
    { lineItemId: li.id, enrolmentId: a.enr.id, points: 7, updatedAt: new Date() },
    { lineItemId: li.id, enrolmentId: b.enr.id, points: 8, updatedAt: new Date() },
  ]);
  const refused = await removeStudents(prof.id, sec.id, [a.enr.id, b.enr.id]);
  assert.equal(refused.ok, false);
  assert.match(refused.ok === false ? refused.error : "", /This will delete 2 grades/);
  const done = await removeStudents(prof.id, sec.id, [a.enr.id, b.enr.id], { confirm: REMOVE_PHRASE });
  assert.ok(done.ok);
  assert.equal(done.ok && done.removed, 2);
  assert.equal(Number((await db().select({ c: count() }).from(lineItemScores)
    .where(eq(lineItemScores.enrolmentId, a.enr.id)))[0].c), 0);
});

console.log("Rule 9 — the log");

await t("every bulk action is logged, with counts and no names", async () => {
  const log = await actionsFor(sec.id, 50);
  const kinds = new Set(log.map((a) => a.action));
  for (const k of ["resend", "withdraw", "restore", "remove"]) {
    assert.ok(kinds.has(k as never), `${k} should be in the log`);
  }
  const lines = log.map(describeAction);
  assert.ok(lines.some((l) => /^Resent \d+ invitations?, skipped \d+$/.test(l)), lines.join(" | "));
  const dump = JSON.stringify(log);
  for (const needle of ["Waiting One", "w1@wright.edu", "Demo Student", "Cost A", "wright.edu"]) {
    assert.ok(!dump.includes(needle), `the log must not hold: ${needle}`);
  }
});

console.log("Rule 11 — what a screen reader is given");

await t("every checkbox is named for its student, and the bar is announced", async () => {
  const rows: RosterRow[] = [
    { enrolmentId: "e1", userId: "u1", name: "Maria Alvarez", email: "m@wright.edu",
      state: "Invited 2026-10-01", stateKey: "invited", demo: false, withdrawn: false, withdrawnOn: null },
    { enrolmentId: "e2", userId: "u2", name: "Demo Student", email: "d@wright.edu",
      state: "Demo", stateKey: "demo", demo: true, withdrawn: false, withdrawnOn: null },
    { enrolmentId: "e3", userId: "u3", name: "Gone Away", email: "g@wright.edu",
      state: "Withdrawn 2026-10-04", stateKey: "none", demo: false, withdrawn: true, withdrawnOn: "2026-10-04" },
  ];
  const shown = html(React.createElement(ClassRoster, { sectionId: "s1", rows, showWithdrawn: false, phrase: REMOVE_PHRASE }));

  assert.match(shown, /aria-label="Select Maria Alvarez"/, "named for the student, not 'checkbox'");
  assert.match(shown, /aria-label="Select Demo Student"/);
  assert.match(shown, /aria-label="Select all shown students"/);
  assert.match(shown, /aria-live="polite"/, "the bar is announced as a selection changes");
  assert.match(shown, /<caption>/, "the table says how many rows are shown");
  // A hidden row is not selectable, which is what "visible rows only" has to mean.
  assert.ok(!shown.includes("Select Gone Away"), "a withdrawn row is not offered while hidden");
  assert.ok(!shown.includes("Gone Away"), "nor rendered");
  const withThem = html(React.createElement(ClassRoster, { sectionId: "s1", rows, showWithdrawn: true, phrase: REMOVE_PHRASE }));
  assert.match(withThem, /aria-label="Select Gone Away"/, "and it is, once shown");
  assert.match(withThem, /Withdrawn/, "labelled");
  // The quick selections count from the rows on screen.
  assert.match(shown, /Not set up \(1\)/, "Maria only: the demo and the withdrawn row are not");
  assert.match(shown, /Demo \(1\)/);
  assert.match(shown, /Withdrawn \(0\)/, "none shown, so none to select");
  assert.match(withThem, /Withdrawn \(1\)/);
  // No invented tab order, and the confirmation is a real dialog.
  assert.ok(!/tabindex="[1-9]/.test(shown));
  assert.match(shown, /<dialog/);
});

console.log(`\n${passed} checks passed`);
