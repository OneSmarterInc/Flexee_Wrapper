// Integration test: Spec 19 §1 — the guarded Remove, and §2 the actions log.
//
// This is the commit that can ship alone, so the suite stands alone too: it proves that the one
// click which used to destroy a student's work now states the cost, demands a typed phrase, takes
// exactly the records it said it would, and leaves everything else — the account, the other class,
// the invitation token — where it was.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { and, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection, sectionRoster } from "@/lib/roster";
import { setScore, gradebook, exportCsv } from "@/lib/gradebook";
import {
  removalCost, describeCost, hasRecords, totalRecords, removeStudents, REMOVE_PHRASE,
  actionsFor, describeAction, logAction,
} from "@/lib/class-actions";

const {
  users, identities, enrolments, exams, examAttempts, examResponses, assignments, submissions,
  submissionFiles, lineItems, lineItemScores, bookmarks, sims, simCompletions, simLaunches,
  simTranscripts, assistantThreads, assistantMessages, authTokens, classActions,
} = schema;

const TABLES = [
  "users", "identities", "enrolments", "bookmarks", "assignments", "submissions", "submission_files",
  "exams", "exam_attempts", "exam_responses", "line_items", "line_item_scores",
  "sims", "sim_completions", "sim_launches", "sim_transcripts",
  "assistant_threads", "assistant_messages", "auth_tokens", "class_actions",
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

async function account(name: string, email: string, password: string | null = "x") {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}

const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const prof2 = await account("Other Prof", "prof2@flexee.org");
const sec = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const other = await createSection(prof2.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
await db().insert(sims).values({ id: "mvcfn", title: "MVCFN", launchUrl: "https://x.invalid", published: true });

/** A student with the full set of work in `sec`, and one score in `other`. */
let workN = 0;
async function student(name: string, email: string, opts: { work?: boolean } = {}) {
  const u = await account(name, email, "chosen");
  const [enr] = await db().insert(enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" }).returning();
  const [enrOther] = await db().insert(enrolments).values({ sectionId: other.id, userId: u.id, role: "student" }).returning();
  // An invitation token, which belongs to the account and must survive (decision 7).
  await db().insert(authTokens).values({
    tokenHash: `hash-${u.id}`, userId: u.id, kind: "set_password", email,
    sectionId: sec.id, expiresAt: new Date(Date.now() + 9e8),
  });
  if (!opts.work) return { user: u, enr, enrOther };
  const [exam] = await db().insert(exams).values({
    sectionId: sec.id, title: `Midterm ${++workN}`, status: "open", feedback: "after_close", attemptLimit: 1,
    blueprintJson: JSON.stringify({ mode: "draw", rules: [{ chapter: 1, difficulty: "any", count: 20 }] }),
  }).returning();
  const [att] = await db().insert(examAttempts).values({
    examId: exam.id, enrolmentId: enr.id, servedJson: "[]", maxPoints: 20, score: 17, submittedAt: new Date(),
  }).returning();
  await db().insert(examResponses).values([
    { attemptId: att.id, questionId: "q1", correct: true }, { attemptId: att.id, questionId: "q2", correct: false },
  ]);
  const [asg] = await db().insert(assignments).values({ sectionId: sec.id, title: `Worksheet ${workN}`, points: 10, createdBy: prof.id }).returning();
  const [sub] = await db().insert(submissions).values({ assignmentId: asg.id, enrolmentId: enr.id, status: "graded", text: "mine", score: 9 }).returning();
  await db().insert(submissionFiles).values({ submissionId: sub.id, blobPath: `submissions/w${workN}.pdf`, fileName: "w.pdf", sizeBytes: 2048 });
  const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, sec.id)))[0];
  await setScore(li.id, enr.id, 8);
  await db().insert(bookmarks).values({ enrolmentId: enr.id, bookId: "sad", entryId: "ch01", chapterVersion: 1, scroll: 0.42, updatedAt: new Date() });
  const [th] = await db().insert(assistantThreads).values({ sectionId: sec.id, enrolmentId: enr.id, title: "a question" }).returning();
  await db().insert(assistantMessages).values({ threadId: th.id, role: "student", body: "what is an actor" });
  // Simulation records hang off the user, in this class and in the other one.
  for (const sid of [sec.id, other.id]) {
    await db().insert(simCompletions).values({ userId: u.id, simId: "mvcfn", sectionId: sid, metrics: "{}" });
    await db().insert(simLaunches).values({ userId: u.id, simId: "mvcfn", sectionId: sid, asRole: "student" });
    await db().insert(simTranscripts).values({ userId: u.id, simId: "mvcfn", sectionId: sid, envelope: "{}" });
  }
  const liOther = (await db().select().from(lineItems).where(eq(lineItems.sectionId, other.id)))[0];
  await setScore(liOther.id, enrOther.id, 5);
  return { user: u, enr, enrOther };
}

console.log("What a removal would cost");

const sam = await student("Sam Student", "sam@wright.edu", { work: true });

await t("the counts come from the tables the delete will reach", async () => {
  const [c] = await removalCost(sec.id, [sam.enr.id]);
  assert.deepEqual(
    { a: c.attempts, s: c.submissions, g: c.scores, b: c.bookmarks, th: c.threads,
      sc: c.simCompletions, sl: c.simLaunches, st: c.simTranscripts },
    { a: 1, s: 1, g: 1, b: 1, th: 1, sc: 1, sl: 1, st: 1 },
    "one of each, and the simulation records counted for this class only",
  );
  assert.equal(hasRecords(c), true, "attempts, submissions and scores are what demand typing");
  assert.equal(totalRecords(c), 8);
});

await t("the sentence names what goes, in plain words", async () => {
  const cost = await removalCost(sec.id, [sam.enr.id]);
  const s = describeCost(cost);
  assert.match(s, /^This will delete 1 exam attempt, 1 submission, 1 grade/);
  assert.match(s, /1 simulation transcript\.$/);
  assert.equal(describeCost([]), "This deletes no records.");
});

await t("a student with no work says so, and needs no typing", async () => {
  const fresh = await student("Pat Fresh", "pat@wright.edu");
  const [c] = await removalCost(sec.id, [fresh.enr.id]);
  assert.equal(totalRecords(c), 0);
  assert.equal(hasRecords(c), false);
  assert.equal(describeCost([c]), "This deletes no records.");
});

console.log("The guard");

await t("without the typed phrase it refuses, and deletes nothing", async () => {
  const before = await census();
  const r = await removeStudents(prof.id, sec.id, [sam.enr.id]);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.needsTyping, true);
  assert.equal(r.ok === false && r.expect, REMOVE_PHRASE);
  assert.match(r.ok === false ? r.error : "", /This will delete 1 exam attempt/);
  assert.match(r.ok === false ? r.error : "", /Type "delete records" to confirm/);
  assert.deepEqual(await census(), before, "not one row moved");
});

await t("a wrong phrase is still a refusal", async () => {
  const before = await census();
  for (const typed of ["", "yes", "delete", "DELETE RECORD", "remove records"]) {
    const r = await removeStudents(prof.id, sec.id, [sam.enr.id], { confirm: typed });
    assert.equal(r.ok, false, `${JSON.stringify(typed)} must not go through`);
  }
  assert.deepEqual(await census(), before);
});

await t("the right phrase goes through, case and spacing forgiven", async () => {
  const fresh = await student("Case Test", "case@wright.edu", { work: true });
  const r = await removeStudents(prof.id, sec.id, [fresh.enr.id], { confirm: "  Delete Records  " });
  assert.ok(r.ok, r.ok === false ? r.error : "");
});

await t("a student with no records goes in one click, with no phrase", async () => {
  const fresh = await student("One Click", "oneclick@wright.edu");
  const r = await removeStudents(prof.id, sec.id, [fresh.enr.id]);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  assert.equal(r.ok && r.removed, 1);
});

console.log("What it deletes, and what it leaves");

await t("it takes exactly the records it counted, and nothing else", async () => {
  const target = await student("Full Set", "fullset@wright.edu", { work: true });
  const bystander = await student("Bystander", "bystander@wright.edu", { work: true });
  const [cost] = await removalCost(sec.id, [target.enr.id]);
  const before = await census();

  const r = await removeStudents(prof.id, sec.id, [target.enr.id], { confirm: REMOVE_PHRASE });
  assert.ok(r.ok);
  const after = await census();

  // Exactly the counted rows, and the two tables that cascade behind them.
  assert.equal(before.enrolments - after.enrolments, 1);
  assert.equal(before.exam_attempts - after.exam_attempts, cost.attempts);
  assert.equal(before.exam_responses - after.exam_responses, 2, "the attempt's responses go with it");
  assert.equal(before.submissions - after.submissions, cost.submissions);
  assert.equal(before.submission_files - after.submission_files, 1, "and the submission's file row");
  assert.equal(before.line_item_scores - after.line_item_scores, cost.scores);
  assert.equal(before.bookmarks - after.bookmarks, cost.bookmarks);
  assert.equal(before.assistant_threads - after.assistant_threads, cost.threads);
  assert.equal(before.assistant_messages - after.assistant_messages, 1);
  // Decision 7: this class's simulation records go; the other class's stay.
  assert.equal(before.sim_completions - after.sim_completions, 1);
  assert.equal(before.sim_launches - after.sim_launches, 1);
  assert.equal(before.sim_transcripts - after.sim_transcripts, 1);
  assert.equal(await n(db().select({ c: count() }).from(simCompletions)
    .where(and(eq(simCompletions.userId, target.user.id), eq(simCompletions.sectionId, other.id)))), 1,
    "the other class's completion is untouched");

  // The account stays, with its password and its invitation token.
  assert.equal(before.users - after.users, 0, "no account is deleted");
  assert.equal(before.identities - after.identities, 0);
  const ident = (await db().select().from(identities).where(eq(identities.userId, target.user.id)))[0];
  assert.equal(ident.passwordHash, "chosen");
  assert.equal(await n(db().select({ c: count() }).from(authTokens).where(eq(authTokens.userId, target.user.id))), 1,
    "the invitation token stays with the account (decision 7)");

  // The exam and the assignment themselves are the class's, not the student's.
  assert.equal(before.exams - after.exams, 0);
  assert.equal(before.assignments - after.assignments, 0);
  assert.equal(before.line_items - after.line_items, 0);

  // The other class, and the other student, are exactly as they were.
  assert.equal(await n(db().select({ c: count() }).from(enrolments)
    .where(and(eq(enrolments.userId, target.user.id), eq(enrolments.sectionId, other.id)))), 1,
    "their enrolment in the other class survives");
  assert.equal(await n(db().select({ c: count() }).from(lineItemScores).where(eq(lineItemScores.enrolmentId, target.enrOther.id))), 1,
    "and its score");
  assert.equal(await n(db().select({ c: count() }).from(examAttempts).where(eq(examAttempts.enrolmentId, bystander.enr.id))), 1,
    "the bystander keeps their attempt");
});

await t("the gradebook and the export lose the row, as they must", async () => {
  const leaving = await student("Leaving Soon", "leaving@wright.edu", { work: true });
  const before = await gradebook(sec.id);
  assert.ok(before.students.some((s) => s.name === "Leaving Soon"));
  assert.ok((await exportCsv(sec.id, "generic")).includes("Leaving Soon"));
  await removeStudents(prof.id, sec.id, [leaving.enr.id], { confirm: REMOVE_PHRASE });
  const after = await gradebook(sec.id);
  assert.ok(!after.students.some((s) => s.name === "Leaving Soon"));
  // The student's row goes. A column the class owns stays, titled as the class titled it.
  const csv = await exportCsv(sec.id, "generic");
  assert.ok(!csv.includes("Leaving Soon"));
  assert.ok(csv.includes("Midterm"), "the exam's column is the class's, and remains");
  assert.ok(!(await sectionRoster(sec.id)).some((r) => r.email === "leaving@wright.edu"));
});

console.log("Who may, and what is trusted");

await t("an id from another class refuses the whole call", async () => {
  const theirs = await db().insert(enrolments).values({ sectionId: other.id, userId: admin.id, role: "student" }).returning();
  const mine = await student("Mine", "mine@wright.edu");
  const before = await census();
  const r = await removeStudents(prof.id, sec.id, [mine.enr.id, theirs[0].id], { confirm: REMOVE_PHRASE });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /not in this class/);
  assert.deepEqual(await census(), before, "including the id that was in this class");
});

await t("another class's faculty and a student are refused", async () => {
  const some = await student("Someone", "someone@wright.edu");
  for (const who of [prof2.id, some.user.id]) {
    const r = await removeStudents(who, sec.id, [some.enr.id], { confirm: REMOVE_PHRASE });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : "", /faculty or an administrator/);
  }
  assert.ok((await sectionRoster(sec.id)).some((x) => x.email === "someone@wright.edu"), "still there");
  const asAdmin = await removeStudents(admin.id, sec.id, [some.enr.id]);
  assert.ok(asAdmin.ok, "an admin may");
});

await t("nothing selected is a refusal, not a no-op that reports success", async () => {
  const r = await removeStudents(prof.id, sec.id, []);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /Nobody was selected/);
});

await t("the old unguarded action no longer deletes anything", () => {
  const src = readFileSync("src/app/actions.ts", "utf8");
  const admin2 = readFileSync("src/app/admin/actions.ts", "utf8");
  for (const [f, s] of [["actions.ts", src], ["admin/actions.ts", admin2]] as const) {
    const m = /export async function remove(Student|Person)Action[\s\S]*?\n\}/.exec(s);
    assert.ok(m, `${f}: the action is gone entirely — update this test`);
    assert.ok(!/removeEnrolment/.test(m![0]), `${f} must not delete an enrolment directly any more`);
  }
  // And no page posts to them.
  for (const f of ["src/app/teach/[section]/page.tsx", "src/app/admin/[section]/page.tsx"]) {
    const page = readFileSync(f, "utf8");
    assert.ok(!/action=\{remove(Student|Person)Action\}/.test(page), `${f} still has the unguarded form`);
    assert.ok(/RemoveStudent/.test(page), `${f} should use the guarded control`);
  }
});

console.log("The log");

await t("it records counts, and no name or address anywhere", async () => {
  const log = await actionsFor(sec.id, 50);
  assert.ok(log.length >= 4, `expected the removals to be logged, got ${log.length}`);
  const dump = JSON.stringify(await db().select().from(classActions));
  for (const needle of [
    "Sam Student", "sam@wright.edu", "Full Set", "fullset@wright.edu", "Leaving Soon", "wright.edu",
  ]) {
    assert.ok(!dump.includes(needle), `the log must not hold: ${needle}`);
  }
  // The actor is the one id, and it is a member of staff.
  const rows = await db().select().from(classActions);
  assert.ok(rows.every((r) => r.actorId === prof.id || r.actorId === admin.id));
  assert.ok(rows.every((r) => r.action === "remove"));
});

await t("it reads as a sentence on the page, naming nobody", async () => {
  await logAction(sec.id, prof.id, "resend", 7, { skipped: 2 });
  await logAction(sec.id, prof.id, "withdraw", 3);
  const log = await actionsFor(sec.id, 50);
  const lines = log.map(describeAction);
  assert.ok(lines.some((l) => l === "Resent 7 invitations, skipped 2"));
  assert.ok(lines.some((l) => l === "Withdrew 3 students"));
  assert.ok(lines.some((l) => /^Removed 1 student \(\d+ records?\)$/.test(l)), lines.join(" | "));
  assert.ok(lines.every((l) => !/wright\.edu|Sam|Full Set/.test(l)));
});

await t("a removal is one transaction: a failure part way leaves the class alone", async () => {
  const a = await student("Trans A", "transa@wright.edu", { work: true });
  const b = await student("Trans B", "transb@wright.edu", { work: true });
  const before = await census();
  // A second id that is real, in this class, but whose enrolment row is pulled out from under the
  // call: the loop finds nothing for it and skips, which must not leave the first one half-done.
  const r = await removeStudents(prof.id, sec.id, [a.enr.id, b.enr.id], { confirm: REMOVE_PHRASE });
  assert.ok(r.ok);
  const after = await census();
  assert.equal(before.enrolments - after.enrolments, 2, "both went, together");
  assert.equal(before.exam_attempts - after.exam_attempts, 2);
});

console.log(`\n${passed} checks passed`);
