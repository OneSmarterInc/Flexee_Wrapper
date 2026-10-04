// Integration test: Spec 18 — D2L's demo student, matching by username, the two-step confirm, and
// the export that refuses to drop a class's grades.
//
// One group per rule of the spec. The last two groups are the ones that matter most: a class
// statistic must not count anybody who is not a student of the class (which, before this, included
// the instructor's own practice attempt), and the D2L export must never write a file D2L would
// half-apply.
import assert from "node:assert/strict";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection, sectionRoster } from "@/lib/roster";
import { setMailTransport, type Mail, type MailResult } from "@/lib/mail";
import {
  parseClassList, confirmLabel, emailSentence, nothingToWrite,
} from "@/lib/d2l";
import { previewImport, commitImport, notSetUp, canImport, demoUserIds, wouldEmail } from "@/lib/d2l-import";
import { copySetPasswordLink, completeSetPassword, inviteStatesFor, sendSetPasswordInvite } from "@/lib/recovery";
import { exportCsv, gradebook, d2lKeyConflicts, ExportBlocked, setScore } from "@/lib/gradebook";
import { classMastery, studentMastery, sectionResponses } from "@/lib/mastery";
import { examResults, createExam, setExamStatus } from "@/lib/assessment";
import { aolReport } from "@/lib/aol";
import { classAssignments, assignmentForFaculty, createAssignment } from "@/lib/assignments";
import { classCompletions } from "@/lib/sims";

const { users, identities, enrolments, examAttempts, examResponses, submissions, simCompletions, sims, classSims, lineItems, learningObjectives } = schema;
let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

process.env.D2L_EMAIL_DOMAIN = "wright.edu";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

let outbox: Mail[] = [];
setMailTransport((m): MailResult => { outbox.push(m); return { ok: true }; });
const BASE = "https://wrapper.example.org";
const tokenIn = (m: Mail) => m.text.match(/\/set-password\?token=([0-9a-f]+)/)![1];
const CSV = (...rows: string[]) => ["Name,UserName,OrgDefinedId,Role,LastAccessed", ...rows, ""].join("\r\n");

async function account(name: string, email: string, password: string | null = "x") {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}
const userIdFor = async (email: string) =>
  (await db().select().from(identities).where(eq(identities.subject, email)))[0].userId;
const enrolmentFor = async (sectionId: string, email: string) =>
  (await sectionRoster(sectionId)).find((r) => r.email === email)!;

const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const sec = await createSection(prof.id, "mis3000", "MIS 3000-01", "2027 Spring", { teach: true });

// ---------------------------------------------------------------- rule 1: the demo student
console.log("Rule 1 — D2L's Demo Student");

const FIRST = CSV(
  '"Alvarez, Maria",m204kqr,M10482913,Student,',
  '"Nakamura, Kenji",k142drf,K10228475,Student,',
  '"Student, Demo",d999dmo,D99999999,Demo Student,',
  '"Carver, Dana",d151hgp,D10664302,Faculty,',
);

await t("the demo row is a student in the preview, marked as never emailed", async () => {
  const p = await previewImport(sec.id, parseClassList(FIRST));
  assert.equal(p.counts.willCreate, 3, "two students and the demo");
  assert.equal(p.counts.demo, 1);
  assert.equal(p.counts.willEmail, 2, "the demo is not one of them");
  const demo = p.rows.find((r) => r.demo)!;
  assert.equal(demo.plan, "create");
  assert.equal(wouldEmail(demo), false);
  assert.deepEqual(p.skipped.map((s) => s.role), ["Faculty"], "a real other role is still skipped");
});

await t("committing with 'email now' creates it and emails everyone but it", async () => {
  outbox = [];
  const r = await commitImport(sec.id, parseClassList(FIRST), { sendNow: true, baseUrl: BASE });
  assert.equal(r.created, 3);
  assert.equal(r.demo, 1);
  assert.equal(r.invited, 2);
  assert.deepEqual(outbox.map((m) => m.to).sort(), ["k142drf@wright.edu", "m204kqr@wright.edu"]);
  const demoId = await userIdFor("d999dmo@wright.edu");
  const enr = (await db().select().from(enrolments).where(and(eq(enrolments.userId, demoId), eq(enrolments.sectionId, sec.id))))[0];
  assert.equal(enr.role, "student", "a student enrolment, so it can read the book and be graded");
  assert.equal(enr.isDemo, true);
});

await t("it is left out of the bulk resend, and the class list says 'Demo'", async () => {
  const waiting = await notSetUp(sec.id);
  assert.deepEqual(waiting.map((w) => w.email).sort(), ["k142drf@wright.edu", "m204kqr@wright.edu"]);
  const demoId = await userIdFor("d999dmo@wright.edu");
  assert.deepEqual((await inviteStatesFor(sec.id)).get(demoId), { state: "demo" });
  assert.deepEqual([...await demoUserIds(sec.id)], [demoId]);
});

await t("Copy link works, so faculty can sign in as the demo and see the student view", async () => {
  const demoId = await userIdFor("d999dmo@wright.edu");
  const link = await copySetPasswordLink(demoId, sec.id, "d999dmo@wright.edu", BASE);
  const done = await completeSetPassword(link.match(/token=([0-9a-f]+)/)![1], "demo-password-1");
  assert.ok(done, "the link set a password");
  assert.equal(done!.userId, demoId);
  // Still a demo afterwards: having a password does not promote it to a real student.
  assert.deepEqual((await inviteStatesFor(sec.id)).get(demoId), { state: "demo" });
});

await t("a later list that drops the Demo Student role leaves the flag where it is", async () => {
  // Faculty have been signing into this account; a role that reads "Student" on the next export
  // must not quietly turn it into someone whose marks count.
  await commitImport(sec.id, parseClassList('Name,UserName,OrgDefinedId,Role,LastAccessed\r\n"Student, Demo",d999dmo,D99999999,Student,\r\n'),
    { sendNow: false, baseUrl: BASE });
  const demoId = await userIdFor("d999dmo@wright.edu");
  const enr = (await db().select().from(enrolments).where(and(eq(enrolments.userId, demoId), eq(enrolments.sectionId, sec.id))))[0];
  assert.equal(enr.isDemo, true, "raised once, never lowered");
});

// ---------------------------------------------------------------- rule 4: the confirm step
console.log("Rule 4 — a safer confirm step");

await t("nothing to write means nothing to confirm", () => {
  assert.equal(nothingToWrite({ willCreate: 0, toEnrol: 0 }), true);
  assert.equal(confirmLabel({ willCreate: 0, toEnrol: 0 }), "Nothing to create");
  assert.equal(nothingToWrite({ willCreate: 0, toEnrol: 2 }), false, "an enrol-only import is still work");
  assert.equal(confirmLabel({ willCreate: 3, toEnrol: 0 }), "Create 3 accounts");
  assert.equal(confirmLabel({ willCreate: 1, toEnrol: 0 }), "Create 1 account");
  assert.equal(confirmLabel({ willCreate: 3, toEnrol: 2 }), "Create 3 accounts and enrol 2");
});

await t("re-importing the same file writes nothing, so the button is disabled", async () => {
  const p = await previewImport(sec.id, parseClassList(FIRST));
  const toEnrol = p.rows.filter((r) => r.plan === "enrol existing").length;
  assert.equal(p.counts.willCreate, 0);
  assert.equal(toEnrol, 0);
  assert.equal(nothingToWrite({ willCreate: p.counts.willCreate, toEnrol }), true);
});

await t("the email step states the count and the domain before anyone presses it", () => {
  assert.equal(emailSentence(28, "wright.edu"), "This will email 28 students at wright.edu.");
  assert.equal(emailSentence(1, "wright.edu"), "This will email 1 student at wright.edu.");
  assert.equal(emailSentence(0, "wright.edu"), "Nobody is waiting for an invitation.");
});

await t("creating accounts sends nothing at all", async () => {
  outbox = [];
  const r = await commitImport(sec.id, parseClassList(CSV('"Fresh, Face",f200new,F20000001,Student,')),
    { sendNow: false, baseUrl: BASE });
  assert.equal(r.created, 1);
  assert.equal(r.invited, 0);
  assert.deepEqual(outbox, [], "no email is sent by the first step");
  assert.ok((await notSetUp(sec.id)).some((w) => w.email === "f200new@wright.edu"), "the second step would reach them");
});

// ---------------------------------------------------------------- rule 2: match by username
console.log("Rule 2 — the same person under a different address");

const other = await createSection(prof.id, "mis3000", "MIS 3000-02", "2027 Spring", { teach: true });

await t("a username on an account with a different email enrols that account, and no twin", async () => {
  // Exactly the live situation: the rehearsal import left this student holding a .invalid address.
  await commitImport(other.id, parseClassList(CSV('"Osei, Kwame",n191fqd,N10882211,Student,'), { domain: "rehearsal.invalid" }),
    { sendNow: false, baseUrl: BASE });
  const before = (await db().select().from(users)).length;
  const real = parseClassList(CSV('"Osei, Kwame",n191fqd,N10882211,Student,'), { domain: "wright.edu" });

  const p = await previewImport(other.id, real);
  assert.equal(p.counts.willCreate, 0, "nobody is created");
  assert.equal(p.rows[0].matchedBy, "username");
  assert.equal(p.rows[0].emailOnFile, "n191fqd@rehearsal.invalid", "shown, not replaced");
  assert.equal(p.counts.willEmail, 0, "and not invited");

  outbox = [];
  const r = await commitImport(other.id, real, { sendNow: true, baseUrl: BASE });
  assert.equal(r.created, 0);
  assert.equal(r.emailDiffers, 1);
  assert.equal(r.invited, 0);
  assert.deepEqual(outbox, []);
  assert.equal((await db().select().from(users)).length, before, "no second account");
  assert.equal((await db().select().from(identities).where(eq(identities.subject, "n191fqd@wright.edu"))).length, 0);
  assert.equal((await db().select().from(identities).where(eq(identities.subject, "n191fqd@rehearsal.invalid"))).length, 1,
    "and its address is left exactly as it was");
});

await t("an account with no username yet is matched by email and given one", async () => {
  const sam = await account("Sam Signup", "s400own@wright.edu", "chosen-by-them");
  await commitImport(other.id, parseClassList(CSV('"Signup, Sam",s400own,S40000001,Student,')), { sendNow: false, baseUrl: BASE });
  const u = (await db().select().from(users).where(eq(users.id, sam.id)))[0];
  assert.equal(u.d2lUsername, "s400own");
  assert.equal((await db().select().from(identities).where(eq(identities.userId, sam.id)))[0].passwordHash, "chosen-by-them",
    "their own password is untouched");
});

// ---------------------------------------------------------------- rule 3: collisions
console.log("Rule 3 — a collision never throws, and never half-applies");

await t("two accounts matching one row is a problem row, and nothing else in the file is lost", async () => {
  // One account holds the username; a different one holds the address the file derives. Choosing
  // either would be a guess, so the row is reported and skipped.
  const [holder] = await db().insert(users).values({ displayName: "Holds The Username", d2lUsername: "y300bbb" }).returning();
  await db().insert(identities).values({ userId: holder.id, provider: "password", subject: "y300bbb@rehearsal.invalid", passwordHash: "h" });
  await account("Holds The Address", "y300bbb@wright.edu", "h");

  const list = parseClassList(CSV(
    '"Bee, Yolanda",y300bbb,Y30000001,Student,',
    '"Innocent, Bystander",b500ok1,B50000001,Student,',
  ));
  const p = await previewImport(other.id, list);
  assert.equal(p.rows.length, 1, "the ambiguous row is not planned");
  assert.ok(p.problems.some((x) => x.reason === "two accounts match this row"));

  const r = await commitImport(other.id, list, { sendNow: false, baseUrl: BASE });
  assert.equal(r.created, 1, "the other student is still imported");
  assert.ok(r.problems.some((x) => x.reason === "two accounts match this row"));
  assert.equal((await db().select().from(identities).where(eq(identities.subject, "b500ok1@wright.edu"))).length, 1);
});

await t("a failure part way through writes nothing at all", async () => {
  const census = async () => ({
    users: Number((await db().select({ c: count() }).from(users))[0].c),
    identities: Number((await db().select({ c: count() }).from(identities))[0].c),
    enrolments: Number((await db().select({ c: count() }).from(enrolments))[0].c),
  });
  const before = await census();
  // A row whose display name is impossible to store: the insert fails inside the transaction,
  // after the first row has already been written, so the transaction is what saves the roster.
  const list = parseClassList(CSV(
    '"Good, Row",g600aaa,G60000001,Student,',
    '"Bad, Row",b600bbb,B60000002,Student,',
  ));
  (list.students[1] as { name: unknown }).name = null; // display_name is NOT NULL
  await assert.rejects(() => commitImport(other.id, list, { sendNow: false, baseUrl: BASE }));
  assert.deepEqual(await census(), before, "the good row was rolled back with the bad one");
  assert.equal((await db().select().from(identities).where(eq(identities.subject, "g600aaa@wright.edu"))).length, 0);
});

// ---------------------------------------------------------------- the statistics
console.log("Statistics — only this class's students, and never a demo");

// A class with one real student, one demo, and an instructor who tries the exam himself.
const stats = await createSection(prof.id, "mis3000", "MIS 3000-03", "2027 Spring", { teach: true });
await commitImport(stats.id, parseClassList(CSV(
  '"Real, Rita",r700rea,R70000001,Student,',
  '"Student, Demo",d700dmo,D70000001,Demo Student,',
)), { sendNow: false, baseUrl: BASE });

const rita = await enrolmentFor(stats.id, "r700rea@wright.edu");
const demoEnr = await enrolmentFor(stats.id, "d700dmo@wright.edu");
const profEnr = (await db().select().from(enrolments)
  .where(and(eq(enrolments.sectionId, stats.id), eq(enrolments.userId, prof.id))))[0];

// A real objective, so class mastery has something to aggregate against.
await db().insert(learningObjectives).values({ id: "mis3000-c01-o1", bookId: "mis3000", chapter: 1, label: "Explain the thing" });

const exam = await createExam(stats.id, {
  title: "Chapter 1", blueprint: { mode: "fixed" as const, ids: ["q1", "q2"] },
  feedback: "after_close", timeLimitMin: null, attemptLimit: 1,
});
await setExamStatus(exam.id, "open");
// Rita gets one right out of two; the demo and the instructor each get both right, which would
// lift the average and the item analysis if either were counted.
async function attempt(enrolmentId: string, correct: boolean[], score: number) {
  const served = JSON.stringify([{ questionId: "q1", snap: { objectiveId: "mis3000-c01-o1" } }, { questionId: "q2", snap: { objectiveId: "mis3000-c01-o1" } }]);
  const [a] = await db().insert(examAttempts)
    .values({ examId: exam.id, enrolmentId, servedJson: served, maxPoints: 2, score, submittedAt: new Date() }).returning();
  await db().insert(examResponses).values([
    { attemptId: a.id, questionId: "q1", correct: correct[0] },
    { attemptId: a.id, questionId: "q2", correct: correct[1] },
  ]);
}
await attempt(rita.enrolmentId, [true, false], 1);
await attempt(demoEnr.enrolmentId, [true, true], 2);
await attempt(profEnr.id, [true, true], 2);

await t("the exam's class average and item analysis count Rita only", async () => {
  const r = await examResults(exam.id);
  assert.deepEqual(r.students.map((s) => s.name), ["Rita Real"], "one row, not three");
  const avg = r.students.reduce((s, x) => s + (x.score ?? 0), 0) / r.students.length;
  assert.equal(avg, 1, "not 1.67, which is what counting the demo and the instructor gave");
  const q2 = r.items.find((i) => i.questionId === "q2")!;
  assert.equal(q2.served, 1);
  assert.equal(q2.pct, 0, "q2 looks hard because the only student got it wrong");
});

await t("class mastery counts Rita only; the per-student matrix still shows the demo", async () => {
  assert.equal((await sectionResponses(stats.id)).length, 2, "Rita's two answers");
  assert.equal((await sectionResponses(stats.id, { includeDemo: true })).length, 4, "and the demo's two");
  const byStudent = await studentMastery(stats.id, "mis3000");
  const names = byStudent.students.map((s) => `${s.name}${s.isDemo ? " [demo]" : ""}`).sort();
  assert.deepEqual(names, ["Demo Student [demo]", "Rita Real"], "listed, and labelled");
  const cls = await classMastery(stats.id, "mis3000");
  const served = cls.reduce((s, o) => s + o.served, 0);
  assert.equal(served, 2, "the class figure is Rita's answers alone");
});

await t("the AoL report's student count and measures leave the demo out", async () => {
  const r = await aolReport(stats.id);
  assert.equal(r.studentCount, 1, "Rita, not Rita and a demo");
});

await t("'12 submitted' means twelve students, not eleven and a demo", async () => {
  const made = await createAssignment(prof.id, stats.id, { title: "Worksheet 1", points: 10 } as never);
  assert.ok(made.ok, "the assignment was created");
  const id = (made as { ok: true; id: string }).id;
  await db().insert(submissions).values([
    { assignmentId: id, enrolmentId: rita.enrolmentId, status: "submitted", text: "mine" },
    { assignmentId: id, enrolmentId: demoEnr.enrolmentId, status: "submitted", text: "demo" },
  ]);
  const list = (await classAssignments(prof.id, stats.id))!;
  assert.equal(list.find((a) => a.id === id)!.submitted, 1, "the demo's submission is not counted");
  const detail = (await assignmentForFaculty(prof.id, id))!;
  const rows = detail.rows.map((r) => `${r.name}${r.isDemo ? " [demo]" : ""}`).sort();
  assert.deepEqual(rows, ["Demo Student [demo]", "Rita Real"], "but it is listed, and labelled");
});

await t("'Who has played' lists the demo, labelled", async () => {
  await db().insert(sims).values({ id: "mvcfn", title: "MVCFN", launchUrl: "https://example.invalid/s", published: true });
  await db().insert(classSims).values({ sectionId: stats.id, simId: "mvcfn", addedBy: prof.id });
  const demoUser = await userIdFor("d700dmo@wright.edu");
  await db().insert(simCompletions).values({ userId: demoUser, simId: "mvcfn", sectionId: stats.id, metrics: "{}" });
  const played = (await classCompletions(prof.id, stats.id))!;
  assert.equal(played.length, 1);
  assert.equal(played[0].isDemo, true, "shown, and marked");
});

await t("the demo is in the gradebook, flagged, and in all five exports", async () => {
  const gb = await gradebook(stats.id);
  const demo = gb.students.find((s) => s.name === "Demo Student")!;
  assert.equal(demo.isDemo, true);
  for (const format of ["generic", "canvas", "d2l", "blackboard", "moodle"]) {
    const csv = await exportCsv(stats.id, format);
    // Blackboard and Moodle split the name into columns, so the address is the needle that works
    // in every format; the D2L file keys on the username.
    assert.ok(csv.includes(format === "d2l" ? '"d700dmo"' : "d700dmo@wright.edu"),
      `the demo row is in the ${format} export`);
  }
});

// ---------------------------------------------------------------- the export refusal
console.log("Addition (a) — the export refuses to drop a class's grades");

await t("two students with one Username key stops the file, naming them", async () => {
  // The duplicate accounts the old matching made are only one way here. Reproduce the shape
  // directly: one account carries the username, another has no username and an address whose
  // local part is the same word, which is what the fallback keys on.
  const twin = await account("Rita Real (duplicate)", "r700rea@rehearsal.invalid", null);
  await db().update(users).set({ d2lUsername: null }).where(eq(users.id, twin.id));
  const dupSection = await createSection(prof.id, "mis3000", "MIS 3000-04", "2027 Spring", { teach: true });
  const ritaUser = await userIdFor("r700rea@wright.edu");
  await db().insert(enrolments).values([
    { sectionId: dupSection.id, userId: ritaUser, role: "student" },
    { sectionId: dupSection.id, userId: twin.id, role: "student" },
  ]);
  const gb = await gradebook(dupSection.id);
  assert.deepEqual(d2lKeyConflicts(gb.students).map((c) => c.key), ["r700rea"], "both rows key the same cell");

  await assert.rejects(() => exportCsv(dupSection.id, "d2l"), (e: unknown) => {
    assert.ok(e instanceof ExportBlocked, "a refusal, not a crash");
    assert.match((e as Error).message, /"r700rea"/, "it names the key");
    assert.match((e as Error).message, /Rita Real/, "and the students involved");
    assert.match((e as Error).message, /Merge the duplicate accounts/, "and what to do about it");
    return true;
  });
  // The other formats key on the address, which is still unique, so they are unaffected.
  assert.ok((await exportCsv(dupSection.id, "generic")).includes("r700rea@rehearsal.invalid"));
});

await t("a blank key is not a duplicate, however many there are", async () => {
  assert.deepEqual(d2lKeyConflicts([
    { name: "A", d2lUsername: null, email: null },
    { name: "B", d2lUsername: null, email: null },
  ]), [], "blanks are flagged on the export page, and D2L matches nobody to them");
  assert.deepEqual(d2lKeyConflicts([
    { name: "A", d2lUsername: "x", email: "x@wright.edu" },
    { name: "B", d2lUsername: "y", email: "y@wright.edu" },
  ]), []);
});

await t("a class with one key per student still exports", async () => {
  const csv = await exportCsv(stats.id, "d2l");
  assert.ok(csv.startsWith('"Username"'));
  assert.ok(csv.includes('"r700rea"') && csv.includes('"d700dmo"'));
});

// ---------------------------------------------------------------- who may import (unchanged)
await t("rule 8 still holds: the class's faculty and admins, nobody else", async () => {
  assert.equal(await canImport(prof.id, sec.id), true);
  assert.equal(await canImport(admin.id, sec.id), true);
  const rita2 = await userIdFor("r700rea@wright.edu");
  assert.equal(await canImport(rita2, sec.id), false);
});

// A score, so the gradebook above is not an empty shell in the last assertions.
await t("the demo's own marks are its own, and nobody else's total moves", async () => {
  const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, stats.id)))[0];
  await setScore(li.id, demoEnr.enrolmentId, 10);
  const gb = await gradebook(stats.id);
  const demo = gb.students.find((s) => s.isDemo)!;
  const real = gb.students.find((s) => !s.isDemo)!;
  assert.ok(demo.cells[li.id].points === 10, "the demo carries its own score");
  assert.equal(real.cells[li.id].points, null, "and Rita's cell is untouched");
  // The sent-mail check for the whole group: the demo was never written to.
  assert.deepEqual(outbox.filter((m) => m.to.startsWith("d7")), []);
  assert.deepEqual(outbox.filter((m) => m.to.startsWith("d9")), []);
  await sendSetPasswordInvite(await userIdFor("r700rea@wright.edu"), stats.id, "r700rea@wright.edu", BASE);
  assert.ok(outbox.some((m) => m.to === "r700rea@wright.edu"), "a real student still gets one");
  assert.ok(tokenIn(outbox[outbox.length - 1]).length > 0);
});

console.log(`\n${passed} checks passed`);
