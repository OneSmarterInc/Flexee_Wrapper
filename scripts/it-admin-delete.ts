// Integration test: Spec 19 §1 — the two deletions only an administrator may make (rules 5 and 6).
//
// Both are permanent and both are refused far more often than they are allowed, so most of this
// suite is about the refusals, and the two that go through are checked with a census over every
// table that could hold a dangling row.
import assert from "node:assert/strict";
import { and, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { setScore } from "@/lib/gradebook";
import {
  accountCheck, deleteAccount, deleteClass, removeStudents, REMOVE_PHRASE, actionsFor, describeAction,
} from "@/lib/class-actions";
import { withdrawStudents } from "@/lib/withdraw";

const {
  users, identities, enrolments, sections, lineItems, lineItemScores, examAttempts, exams,
  submissions, assignments, classActions, assistantThreads, bookmarks, authTokens,
} = schema;

const TABLES = [
  "users", "identities", "sessions", "sections", "enrolments", "bookmarks", "assignments",
  "submissions", "exams", "exam_attempts", "line_items", "line_item_scores", "auth_tokens",
  "assistant_threads", "class_actions", "grading_categories", "letter_scales",
] as const;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
async function census() {
  const out: Record<string, number> = {};
  for (const tb of TABLES) {
    const r = await db().execute(sql.raw(`select count(*)::int as c from "${tb}"`));
    const rows = (r as unknown as { rows?: { c: number }[] }).rows ?? (r as unknown as { c: number }[]);
    out[tb] = Number(rows[0].c);
  }
  return out;
}
const n = async (q: Promise<{ c: number | string }[]>) => Number((await q)[0]?.c ?? 0);

async function account(name: string, email: string, password: string | null = null) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}

const admin = await account("Admin", "admin@flexee.org", "x"); await setAdminByEmail("admin@flexee.org");
const admin2 = await account("Second Admin", "admin2@flexee.org", "x"); await setAdminByEmail("admin2@flexee.org");
const prof = await account("Prof", "prof@flexee.org", "x");
const sec = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const keep = await createSection(prof.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });

console.log("Rule 5 — delete account");

await t("an account that never set a password, holds nothing and is in one class may go", async () => {
  const u = await account("Never Signed In", "never@wright.edu", null);
  await db().insert(enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" });
  const check = await accountCheck(u.id);
  assert.deepEqual(check.reasons, []);
  assert.equal(check.canDelete, true);
  assert.deepEqual(check.counts, { classes: 1, attempts: 0, submissions: 0, scores: 0 });
  const before = await census();
  const r = await deleteAccount(admin.id, sec.id, u.id, { confirm: "Never Signed In" });
  assert.ok(r.ok, r.ok === false ? r.error : "");
  const after = await census();
  assert.equal(before.users - after.users, 1);
  assert.equal(before.identities - after.identities, 1);
  assert.equal(before.enrolments - after.enrolments, 1);
  assert.equal(await n(db().select({ c: count() }).from(users).where(eq(users.id, u.id))), 0);
});

await t("the typed name must be exact", async () => {
  const u = await account("Typed Name", "typed@wright.edu", null);
  await db().insert(enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" });
  for (const typed of ["", "typed name", "Typed", "Typed  Name"]) {
    const r = await deleteAccount(admin.id, sec.id, u.id, { confirm: typed });
    assert.equal(r.ok, false, `${JSON.stringify(typed)} must not go through`);
    assert.match(r.ok === false ? r.error : "", /Type the account's name exactly/);
  }
  assert.equal(await n(db().select({ c: count() }).from(users).where(eq(users.id, u.id))), 1);
  assert.ok((await deleteAccount(admin.id, sec.id, u.id, { confirm: "  Typed Name  " })).ok, "trimmed is fine");
});

await t("it is refused for a password, work, another class, faculty and an admin — all reasons at once", async () => {
  const withPassword = await account("Has Password", "haspw@wright.edu", "chosen");
  await db().insert(enrolments).values({ sectionId: sec.id, userId: withPassword.id, role: "student" });
  assert.deepEqual((await accountCheck(withPassword.id)).reasons, ["someone has set a password on it"]);

  const withWork = await account("Has Work", "haswork@wright.edu", null);
  const [we] = await db().insert(enrolments).values({ sectionId: sec.id, userId: withWork.id, role: "student" }).returning();
  const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, sec.id)))[0];
  await setScore(li.id, we.id, 7);
  const workCheck = await accountCheck(withWork.id);
  assert.deepEqual(workCheck.reasons, ["it holds work"]);
  assert.equal(workCheck.counts.scores, 1);

  const twoClasses = await account("Two Classes", "two@wright.edu", null);
  for (const s of [sec.id, keep.id]) await db().insert(enrolments).values({ sectionId: s, userId: twoClasses.id, role: "student" });
  assert.deepEqual((await accountCheck(twoClasses.id)).reasons, ["it belongs to more than one class"]);

  const facultyCheck = await accountCheck(prof.id);
  assert.ok(facultyCheck.reasons.includes("it teaches a class"));
  const adminCheck = await accountCheck(admin2.id);
  assert.ok(adminCheck.reasons.includes("it is an administrator's account"));

  // Several at once, reported together rather than one per attempt.
  const everything = await account("All The Reasons", "all@wright.edu", "chosen");
  await setAdminByEmail("all@wright.edu");
  for (const s of [sec.id, keep.id]) await db().insert(enrolments).values({ sectionId: s, userId: everything.id, role: "instructor" });
  const all = await accountCheck(everything.id);
  assert.equal(all.canDelete, false);
  assert.ok(all.reasons.length >= 4, `expected every reason, got ${all.reasons.join("; ")}`);

  // And none of them can actually be deleted.
  for (const u of [withPassword, withWork, twoClasses, everything]) {
    const name = (await db().select({ name: users.displayName }).from(users).where(eq(users.id, u.id)))[0].name;
    const r = await deleteAccount(admin.id, sec.id, u.id, { confirm: name });
    assert.equal(r.ok, false, `${name} must not be deletable`);
    assert.equal(await n(db().select({ c: count() }).from(users).where(eq(users.id, u.id))), 1);
  }
});

await t("a withdrawn student's account is not deletable while it holds work", async () => {
  const u = await account("Withdrawn With Work", "www@wright.edu", null);
  const [e] = await db().insert(enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" }).returning();
  const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, sec.id)))[0];
  await setScore(li.id, e.id, 4);
  await withdrawStudents(prof.id, sec.id, [e.id]);
  const check = await accountCheck(u.id);
  assert.equal(check.canDelete, false, "withdrawal keeps the work, and the work blocks the deletion");
  assert.deepEqual(check.reasons, ["it holds work"]);
});

await t("a non-admin cannot, and nobody can delete their own account", async () => {
  const u = await account("Target", "target@wright.edu", null);
  await db().insert(enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" });
  for (const who of [prof.id, u.id]) {
    const r = await deleteAccount(who, sec.id, u.id, { confirm: "Target" });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : "", /Only an administrator/);
  }
  const self = await deleteAccount(admin.id, sec.id, admin.id, { confirm: "Admin" });
  assert.equal(self.ok, false);
  assert.match(self.ok === false ? self.error : "", /your own account/);
  assert.equal(await n(db().select({ c: count() }).from(users).where(eq(users.id, u.id))), 1);
});

console.log("Rule 6 — delete class");

await t("it is refused while any student enrolment exists, withdrawn ones included", async () => {
  const doomed = await createSection(admin.id, "sad", "To Be Deleted", "2027 Spring", { teach: false });
  const u = await account("Last Student", "last@wright.edu", null);
  const [e] = await db().insert(enrolments).values({ sectionId: doomed.id, userId: u.id, role: "student" }).returning();

  let r = await deleteClass(admin.id, doomed.id, { confirm: "To Be Deleted" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /still has 1 student enrolment/);

  // A withdrawal is not a removal: the records stay, so the class cannot go either.
  await withdrawStudents(admin.id, doomed.id, [e.id]);
  r = await deleteClass(admin.id, doomed.id, { confirm: "To Be Deleted" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /withdrawn ones included/);

  await removeStudents(admin.id, doomed.id, [e.id], { confirm: REMOVE_PHRASE });
  assert.ok((await deleteClass(admin.id, doomed.id, { confirm: "To Be Deleted" })).ok, "now it can");
});

await t("the typed class name must be exact, and a non-admin is refused", async () => {
  const doomed = await createSection(admin.id, "sad", "Typed Class", "2027 Spring", { teach: false });
  for (const typed of ["", "typed class", "Typed", "Typed Clas"]) {
    const r = await deleteClass(admin.id, doomed.id, { confirm: typed });
    assert.equal(r.ok, false, JSON.stringify(typed));
    assert.match(r.ok === false ? r.error : "", /Type the class's name exactly/);
  }
  const asProf = await deleteClass(prof.id, doomed.id, { confirm: "Typed Class" });
  assert.equal(asProf.ok, false);
  assert.match(asProf.ok === false ? asProf.error : "", /Only an administrator/);
  assert.equal(await n(db().select({ c: count() }).from(sections).where(eq(sections.id, doomed.id))), 1);
  assert.ok((await deleteClass(admin.id, doomed.id, { confirm: "Typed Class" })).ok);
});

await t("deleting a class leaves nothing dangling, and no other class is touched", async () => {
  const doomed = await createSection(admin.id, "sad", "Census Class", "2027 Spring", { teach: true });
  // Furniture of its own: an exam, an assignment, columns, a thread, a bookmark, a token.
  const [exam] = await db().insert(exams).values({
    sectionId: doomed.id, title: "E", status: "open", feedback: "after_close", attemptLimit: 1,
    blueprintJson: JSON.stringify({ mode: "draw", rules: [{ chapter: 1, difficulty: "any", count: 1 }] }),
  }).returning();
  const [asg] = await db().insert(assignments).values({ sectionId: doomed.id, title: "A", points: 5, createdBy: admin.id }).returning();
  const profEnr = (await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, doomed.id), eq(enrolments.userId, admin.id))))[0];
  await db().insert(bookmarks).values({ enrolmentId: profEnr.id, bookId: "sad", entryId: "ch01", chapterVersion: 1, scroll: 0.1, updatedAt: new Date() });
  await db().insert(assistantThreads).values({ sectionId: doomed.id, enrolmentId: profEnr.id, title: "q" });
  await db().insert(authTokens).values({
    tokenHash: "census-hash", userId: admin.id, kind: "set_password", email: "admin@flexee.org",
    sectionId: doomed.id, expiresAt: new Date(Date.now() + 9e8),
  });

  const keepBefore = {
    enrolments: await n(db().select({ c: count() }).from(enrolments).where(eq(enrolments.sectionId, keep.id))),
    lineItems: await n(db().select({ c: count() }).from(lineItems).where(eq(lineItems.sectionId, keep.id))),
  };

  const r = await deleteClass(admin.id, doomed.id, { confirm: "Census Class" });
  assert.ok(r.ok, r.ok === false ? r.error : "");

  for (const [what, c] of [
    ["the class", db().select({ c: count() }).from(sections).where(eq(sections.id, doomed.id))],
    ["its enrolments", db().select({ c: count() }).from(enrolments).where(eq(enrolments.sectionId, doomed.id))],
    ["its exams", db().select({ c: count() }).from(exams).where(eq(exams.id, exam.id))],
    ["its assignments", db().select({ c: count() }).from(assignments).where(eq(assignments.id, asg.id))],
    ["its columns", db().select({ c: count() }).from(lineItems).where(eq(lineItems.sectionId, doomed.id))],
    ["its bookmarks", db().select({ c: count() }).from(bookmarks).where(eq(bookmarks.enrolmentId, profEnr.id))],
    ["its threads", db().select({ c: count() }).from(assistantThreads).where(eq(assistantThreads.sectionId, doomed.id))],
    ["its invitation tokens", db().select({ c: count() }).from(authTokens).where(eq(authTokens.sectionId, doomed.id))],
    ["its log rows", db().select({ c: count() }).from(classActions).where(eq(classActions.sectionId, doomed.id))],
  ] as const) {
    assert.equal(await n(c as never), 0, `${what} should be gone`);
  }
  assert.equal(await n(db().select({ c: count() }).from(users).where(eq(users.id, admin.id))), 1,
    "the account that taught it stays");
  assert.deepEqual({
    enrolments: await n(db().select({ c: count() }).from(enrolments).where(eq(enrolments.sectionId, keep.id))),
    lineItems: await n(db().select({ c: count() }).from(lineItems).where(eq(lineItems.sectionId, keep.id))),
  }, keepBefore, "the other class did not notice");
});

await t("both deletions are logged, by count and nothing else", async () => {
  const log = await actionsFor(sec.id, 50);
  const lines = log.map(describeAction);
  assert.ok(lines.some((l) => /^Deleted \d+ accounts?$/.test(l)), lines.join(" | "));
  const dump = JSON.stringify(await db().select().from(classActions));
  for (const needle of ["Never Signed In", "never@wright.edu", "Typed Name", "Census Class"]) {
    assert.ok(!dump.includes(needle), `the log must not hold: ${needle}`);
  }
});

console.log(`\n${passed} checks passed`);
