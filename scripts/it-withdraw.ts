// Integration test: Spec 19 §1 — withdrawal, and rule 3.
//
// Withdrawal is the opposite of Remove: every record stays, and what goes is access and presence
// in the numbers. The reports before this build counted where that has to hold, so this suite
// walks the same ground — the entitlement gates, the counts, the exports, the bulk actions — and
// then restores and checks it all came back.
import assert from "node:assert/strict";
import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { allClasses } from "@/lib/admin";
import { createSection, sectionRoster, enrollByCode, setAccessRelease } from "@/lib/roster";
import { publishClassBook } from "@/lib/publish";
import { enrolmentForBook, enrolmentForBookAnyState, userClasses, firstStudentSection } from "@/lib/enrolment";
import { gradebook, exportCsv, gradesForStudent, setScore } from "@/lib/gradebook";
import { examResults } from "@/lib/assessment";
import { classMastery, sectionResponses } from "@/lib/mastery";
import { aolReport } from "@/lib/aol";
import { classAssignments, assignmentForFaculty } from "@/lib/assignments";
import { prepareLaunch, classCompletions } from "@/lib/sims";
import { notSetUp } from "@/lib/d2l-import";
import { parseClassList } from "@/lib/d2l";
import { previewImport, commitImport } from "@/lib/d2l-import";
import { studentEnrolmentForBook } from "@/lib/assistant/store";
import { withdrawStudents, restoreStudents, withdrawnIn, WITHDRAWN_NOTICE, activeStudent } from "@/lib/withdraw";
import { actionsFor, describeAction } from "@/lib/class-actions";
import { setMailTransport } from "@/lib/mail";

const {
  users, identities, enrolments, exams, examAttempts, examResponses, assignments, submissions,
  lineItems, lineItemScores, sims, classSims, simCompletions, learningObjectives,
} = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const n = async (q: Promise<{ c: number | string }[]>) => Number((await q)[0]?.c ?? 0);
setMailTransport(() => ({ ok: true }));
// A real launch signs a pass, which needs this; the refusal under test happens well before it.
process.env.LAUNCH_SECRET = process.env.LAUNCH_SECRET || "test-launch-secret";

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "chosen" });
  return u;
}

const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const prof2 = await account("Other Prof", "prof2@flexee.org");
const sec = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const other = await createSection(prof2.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
await publishClassBook(prof.id, sec.id);
await db().insert(sims).values({ id: "mvcfn", title: "MVCFN", launchUrl: "https://x.invalid", published: true });
await db().insert(classSims).values({ sectionId: sec.id, simId: "mvcfn", addedBy: prof.id });
await db().insert(learningObjectives).values({ id: "sad-c01-o1", bookId: "sad", chapter: 1, label: "An objective" });

const [exam] = await db().insert(exams).values({
  sectionId: sec.id, title: "Midterm", status: "open", feedback: "after_close", attemptLimit: 1,
  blueprintJson: JSON.stringify({ mode: "draw", rules: [{ chapter: 1, difficulty: "any", count: 2 }] }),
}).returning();
const [asg] = await db().insert(assignments).values({ sectionId: sec.id, title: "Worksheet", points: 10, createdBy: prof.id }).returning();
const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, sec.id)))[0];

/** A student with work, so a withdrawal has something to keep. */
async function student(name: string, email: string) {
  const u = await account(name, email);
  const [enr] = await db().insert(enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" }).returning();
  const served = JSON.stringify([{ questionId: "q1", snap: { objectiveId: "sad-c01-o1" } },
                                 { questionId: "q2", snap: { objectiveId: "sad-c01-o1" } }]);
  const [att] = await db().insert(examAttempts).values({
    examId: exam.id, enrolmentId: enr.id, servedJson: served, maxPoints: 2, score: 2, submittedAt: new Date(),
  }).returning();
  await db().insert(examResponses).values([
    { attemptId: att.id, questionId: "q1", correct: true }, { attemptId: att.id, questionId: "q2", correct: true },
  ]);
  await db().insert(submissions).values({ assignmentId: asg.id, enrolmentId: enr.id, status: "submitted", text: "mine" });
  await setScore(li.id, enr.id, 9);
  await db().insert(simCompletions).values({ userId: u.id, simId: "mvcfn", sectionId: sec.id, metrics: "{}" });
  return { user: u, enr };
}

const gone = await student("Gone Away", "gone@wright.edu");
const stays = await student("Still Here", "stays@wright.edu");
// Spec 27 B1: a new enrolment is not released, and an unreleased student cannot launch a
// simulation. Both are released here so this suite stays about withdrawal — and so that "it all
// comes back" is a real check that restoring a student restores their release too, rather than
// passing because nothing was ever gated.
await setAccessRelease(prof.id, sec.id, { released: true, all: true });

console.log("Before");

await t("both students are in everything", async () => {
  assert.equal((await gradebook(sec.id)).students.length, 2);
  assert.equal((await examResults(exam.id)).students.length, 2);
  assert.equal((await aolReport(sec.id)).studentCount, 2);
  assert.equal((await classAssignments(prof.id, sec.id))![0].submitted, 2);
  assert.ok((await exportCsv(sec.id, "generic")).includes("Gone Away"));
  assert.ok(await enrolmentForBook(gone.user.id, "sad"), "and the reader lets them in");
});

console.log("Withdrawing");

const before = {
  attempts: await n(db().select({ c: count() }).from(examAttempts).where(eq(examAttempts.enrolmentId, gone.enr.id))),
  submissions: await n(db().select({ c: count() }).from(submissions).where(eq(submissions.enrolmentId, gone.enr.id))),
  scores: await n(db().select({ c: count() }).from(lineItemScores).where(eq(lineItemScores.enrolmentId, gone.enr.id))),
  completions: await n(db().select({ c: count() }).from(simCompletions).where(eq(simCompletions.userId, gone.user.id))),
};

await t("every record stays exactly where it was", async () => {
  const r = await withdrawStudents(prof.id, sec.id, [gone.enr.id]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.changed, 1);
  assert.deepEqual({
    attempts: await n(db().select({ c: count() }).from(examAttempts).where(eq(examAttempts.enrolmentId, gone.enr.id))),
    submissions: await n(db().select({ c: count() }).from(submissions).where(eq(submissions.enrolmentId, gone.enr.id))),
    scores: await n(db().select({ c: count() }).from(lineItemScores).where(eq(lineItemScores.enrolmentId, gone.enr.id))),
    completions: await n(db().select({ c: count() }).from(simCompletions).where(eq(simCompletions.userId, gone.user.id))),
  }, before, "nothing was deleted");
  assert.equal(await n(db().select({ c: count() }).from(enrolments).where(eq(enrolments.id, gone.enr.id))), 1,
    "and the enrolment itself stays");
});

await t("access is gone: the reader, exams, assignments, sims and the assistant", async () => {
  assert.equal(await enrolmentForBook(gone.user.id, "sad"), null, "the gate nine pages share");
  assert.equal(await studentEnrolmentForBook(gone.user.id, "sad"), null, "the assistant");
  const launch = await prepareLaunch(gone.user.id, "mvcfn", sec.id);
  assert.equal(launch.ok, false);
  assert.match(launch.ok === false ? launch.error : "", /no longer enrolled/i);
  assert.ok(await enrolmentForBook(stays.user.id, "sad"), "the other student is unaffected");
});

await t("the class is still listed, with the line, and the grades page still reads", async () => {
  const classes = await userClasses(gone.user.id);
  const mine = classes.find((c) => c.sectionId === sec.id)!;
  assert.equal(mine.withdrawn, true);
  assert.equal(mine.canOpen, false, "nothing to open");
  const any = await enrolmentForBookAnyState(gone.user.id, "sad");
  assert.ok(any && any.withdrawnAt, "the course page can still say where they stand");
  const g = await gradesForStudent(sec.id, gone.enr.id);
  assert.ok(g, "their own grades are still readable (decision 2)");
  assert.equal(g!.graded.length >= 1, true);
  assert.match(WITHDRAWN_NOTICE, /Your work is kept; ask your instructor\.$/);
});

await t("they are out of every count", async () => {
  assert.deepEqual((await gradebook(sec.id)).students.map((s) => s.name), ["Still Here"]);
  assert.deepEqual((await examResults(exam.id)).students.map((s) => s.name), ["Still Here"]);
  assert.equal((await aolReport(sec.id)).studentCount, 1);
  assert.equal((await classAssignments(prof.id, sec.id))![0].submitted, 1);
  assert.deepEqual((await assignmentForFaculty(prof.id, asg.id))!.rows.map((r) => r.name), ["Still Here"]);
  assert.equal((await sectionResponses(sec.id)).length, 2, "one student's two answers");
  assert.equal((await classMastery(sec.id, "sad")).reduce((s, o) => s + o.served, 0), 2);
  // A list, so their play is shown and labelled rather than vanishing.
  const played = (await classCompletions(prof.id, sec.id))!;
  assert.equal(played.length, 2);
  assert.equal(played.filter((p) => p.withdrawn).length, 1);
  // The admin list counts them apart.
  const cls = (await allClasses()).find((c) => c.id === sec.id)!;
  assert.equal(cls.students, 1);
  assert.equal(cls.withdrawn, 1);
});

await t("they are out of every export, and the gradebook can still show them on request", async () => {
  const csv = await exportCsv(sec.id, "generic");
  assert.ok(!csv.includes("Gone Away"));
  assert.ok(csv.includes("Still Here"));
  for (const f of ["canvas", "d2l", "blackboard", "moodle"]) {
    assert.ok(!(await exportCsv(sec.id, f)).includes("gone@wright.edu"), `${f} must leave them out`);
  }
  const shown = await gradebook(sec.id, { includeWithdrawn: true });
  assert.equal(shown.students.length, 2, "the Show withdrawn toggle asks for them");
  assert.ok(shown.students.find((s) => s.name === "Gone Away")!.withdrawnAt);
});

await t("they are out of every bulk action", async () => {
  assert.ok(!(await notSetUp(sec.id)).some((x) => x.email === "gone@wright.edu"));
  assert.equal(await firstStudentSection(gone.user.id), null, "and not what an invitation names");
});

await t("the class list keeps the row, so faculty can see and restore it", async () => {
  const roster = await sectionRoster(sec.id);
  const row = roster.find((r) => r.email === "gone@wright.edu")!;
  assert.ok(row, "still in the roster");
  assert.ok(row.withdrawnAt, "and marked");
  const w = await withdrawnIn(sec.id);
  assert.equal(w.count, 1);
  assert.ok(w.enrolmentIds.has(gone.enr.id));
});

console.log("A withdrawal survives being re-added (decision 3)");

await t("joining again with the class code does not undo it", async () => {
  const joined = await enrollByCode(gone.user.id, sec.joinCode!);
  assert.ok(joined, "the code still matches the class");
  assert.equal(joined!.withdrawn, true, "and it reports the withdrawal");
  const row = (await db().select().from(enrolments).where(eq(enrolments.id, gone.enr.id)))[0];
  assert.ok(row.withdrawnAt, "still withdrawn");
  assert.equal(await enrolmentForBook(gone.user.id, "sad"), null, "and still shut out");
});

await t("a D2L re-import leaves it standing and says so in the preview", async () => {
  const csv = 'Name,UserName,OrgDefinedId,Role,LastAccessed\r\n"Away, Gone",gone,G1,Student,\r\n';
  // The derived address is the one this student already has, so the row matches them.
  const list = parseClassList(csv, { domain: "wright.edu" });
  const p = await previewImport(sec.id, list);
  assert.equal(p.rows[0].withdrawn, true, "the preview marks it");
  assert.equal(p.counts.withdrawn, 1);
  assert.equal(p.counts.willEmail, 0, "and it is not invited");
  const r = await commitImport(sec.id, list, { sendNow: true, baseUrl: "https://x.invalid" });
  assert.equal(r.withdrawn, 1);
  assert.equal(r.invited, 0);
  const row = (await db().select().from(enrolments).where(eq(enrolments.id, gone.enr.id)))[0];
  assert.ok(row.withdrawnAt, "an import does not restore anyone");
});

console.log("Who may");

await t("another class's faculty and a student are refused; an admin may", async () => {
  for (const who of [prof2.id, stays.user.id]) {
    const r = await withdrawStudents(who, sec.id, [stays.enr.id]);
    assert.equal(r.ok, false);
  }
  assert.equal((await db().select().from(enrolments).where(eq(enrolments.id, stays.enr.id)))[0].withdrawnAt, null);
  const asAdmin = await withdrawStudents(admin.id, sec.id, [stays.enr.id]);
  assert.ok(asAdmin.ok);
  await restoreStudents(admin.id, sec.id, [stays.enr.id]);
});

await t("an id from another class refuses the whole call, and faculty cannot be withdrawn", async () => {
  const [theirs] = await db().insert(enrolments).values({ sectionId: other.id, userId: admin.id, role: "student" }).returning();
  const r = await withdrawStudents(prof.id, sec.id, [stays.enr.id, theirs.id]);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /not in this class/);
  assert.equal((await db().select().from(enrolments).where(eq(enrolments.id, stays.enr.id)))[0].withdrawnAt, null);
  const profEnr = (await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, prof.id))))[0];
  const f = await withdrawStudents(prof.id, sec.id, [profEnr.id]);
  assert.equal(f.ok, false);
  assert.match(f.ok === false ? f.error : "", /Only students can be withdrawn/);
});

console.log("Restoring");

await t("it all comes back", async () => {
  const r = await restoreStudents(prof.id, sec.id, [gone.enr.id]);
  assert.ok(r.ok);
  assert.ok(await enrolmentForBook(gone.user.id, "sad"), "the reader again");
  assert.ok(await studentEnrolmentForBook(gone.user.id, "sad"), "the assistant again");
  assert.equal((await gradebook(sec.id)).students.length, 2);
  assert.equal((await examResults(exam.id)).students.length, 2);
  assert.equal((await aolReport(sec.id)).studentCount, 2);
  assert.equal((await classAssignments(prof.id, sec.id))![0].submitted, 2);
  assert.ok((await exportCsv(sec.id, "generic")).includes("Gone Away"));
  assert.equal((await withdrawnIn(sec.id)).count, 0);
  assert.equal((await userClasses(gone.user.id)).find((c) => c.sectionId === sec.id)!.withdrawn, false);
  const launch = await prepareLaunch(gone.user.id, "mvcfn", sec.id);
  assert.ok(launch.ok, launch.ok === false ? launch.error : "");
});

await t("withdrawing twice changes nothing the second time, and is reported", async () => {
  const first = await withdrawStudents(prof.id, sec.id, [gone.enr.id]);
  assert.equal(first.ok && first.changed, 1);
  const again = await withdrawStudents(prof.id, sec.id, [gone.enr.id]);
  assert.equal(again.ok && again.changed, 0);
  assert.equal(again.ok && again.skipped, 1);
  await restoreStudents(prof.id, sec.id, [gone.enr.id]);
  const noop = await restoreStudents(prof.id, sec.id, [gone.enr.id]);
  assert.equal(noop.ok && noop.changed, 0);
});

await t("the predicate every count shares is one definition", async () => {
  // activeStudent() is what the fifteen counting sites add. If it ever stops meaning this, the
  // fifteen move together rather than drifting apart.
  const rows = await db().select({ id: enrolments.id }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), activeStudent()));
  const byHand = await db().select({ id: enrolments.id }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.role, "student"), isNull(enrolments.withdrawnAt)));
  assert.deepEqual(rows.map((r) => r.id).sort(), byHand.map((r) => r.id).sort());
});

await t("the log records it, counting and naming nobody", async () => {
  const log = await actionsFor(sec.id, 50);
  const lines = log.map(describeAction);
  assert.ok(lines.some((l) => /^Withdrew \d+ student/.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /^Restored \d+ student/.test(l)));
  assert.ok(lines.every((l) => !/Gone Away|gone@wright\.edu/.test(l)));
});

console.log(`\n${passed} checks passed`);
