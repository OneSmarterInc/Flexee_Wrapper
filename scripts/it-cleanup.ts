// Integration test: Spec 18 §4 — removing test accounts and test classes.
//
// This is the one piece of the system whose whole job is to destroy data, so the test is written
// the other way round from the rest: most of it is about what is **not** deleted. A real student's
// account, a class nobody asked about, an account holding marks, a faculty account, and anything
// at all before `--apply` with the host typed back.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { setMailTransport } from "@/lib/mail";
import { parseClassList } from "@/lib/d2l";
import { commitImport } from "@/lib/d2l-import";
import {
  planCleanup, applyCleanup, domainAllowed, hostOf, confirmed, tableCensus, TEST_SUFFIXES,
} from "@/lib/cleanup";

const {
  users, identities, enrolments, sections, submissions, submissionFiles, assignments,
  examAttempts, examResponses, lineItems, lineItemScores, bookmarks, authTokens, sessions,
} = schema;

const TABLES = [
  "users", "identities", "sessions", "sections", "enrolments", "bookmarks", "library_uploads",
  "assignments", "assignment_files", "submissions", "submission_files", "sims", "sim_previews",
  "class_sims", "sim_launches", "sim_completions", "sim_transcripts", "roster_invites",
  "chapter_versions", "section_content_pins", "questions", "exams", "exam_attempts",
  "exam_responses", "learning_objectives", "section_outcomes", "outcome_objective_map",
  "grading_categories", "letter_scales", "line_items", "line_item_scores", "lti_platforms",
  "lti_links", "auth_tokens", "rate_counters", "announcements", "section_syllabus",
  "schedule_items", "program_outcomes", "outcome_program_map", "line_item_outcome_map",
  "aol_settings",
] as const;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
setMailTransport(() => ({ ok: true }));
const BASE = "https://wrapper.example.org";
const CSV = (...rows: string[]) => ["Name,UserName,OrgDefinedId,Role,LastAccessed", ...rows, ""].join("\r\n");
const userIdFor = async (email: string) =>
  (await db().select().from(identities).where(eq(identities.subject, email)))[0]?.userId ?? null;

// ---------------------------------------------------------------- the two gates
console.log("The gates");

await t("only reserved test domains are accepted", () => {
  for (const d of ["rehearsal.invalid", "x.test", "demo.example", "app.localhost", "invalid", "test"]) {
    assert.equal(domainAllowed(d), true, `${d} should be allowed`);
  }
  for (const d of ["wright.edu", "flexee.org", "gmail.com", "", "wright.edu ", "@wright.edu",
                   "invalid.com", "test.co.uk", "example.com", "notinvalid.net"]) {
    assert.equal(domainAllowed(d), false, `${d} must be refused`);
  }
  assert.deepEqual([...TEST_SUFFIXES], [".invalid", ".test", ".example", ".localhost"]);
});

await t("planning against a real domain refuses before it reads anything", async () => {
  await assert.rejects(() => planCleanup({ domain: "wright.edu" }), /not a reserved test domain/);
  await assert.rejects(() => planCleanup({}), /give --domain, --class, or both/);
});

await t("the host is shown without credentials, and has to be typed back exactly", () => {
  assert.equal(hostOf("postgres://user:sw0rdfish@ep-cool-123.us-east-2.aws.neon.tech/flexee?sslmode=require"),
    "ep-cool-123.us-east-2.aws.neon.tech/flexee");
  assert.ok(!hostOf("postgres://user:sw0rdfish@h/db").includes("sw0rdfish"), "never the password");
  assert.equal(hostOf(undefined), "");
  assert.equal(hostOf("not a url"), "");
  const host = "ep-cool-123.us-east-2.aws.neon.tech/flexee";
  assert.equal(confirmed(host, host), true);
  assert.equal(confirmed(` ${host} `, host), true, "trimmed, since a paste often carries a space");
  assert.equal(confirmed("", host), false);
  assert.equal(confirmed("yes", host), false);
  assert.equal(confirmed("ep-cool-123.us-east-2.aws.neon.tech", host), false, "the database name counts");
  assert.equal(confirmed("", ""), false, "no host means no confirmation is possible");
});

// ---------------------------------------------------------------- the data
console.log("A database with real students, test students, and work");

const prof = await (async () => {
  const [u] = await db().insert(users).values({ displayName: "Prof" }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: "prof@flexee.org", passwordHash: "x" });
  return u;
})();
const real = await createSection(prof.id, "mis3000", "MIS 3000-01 (real)", "2027 Spring", { teach: true });
const rehearsal = await createSection(prof.id, "mis3000", "Rehearsal", "2027 Spring", { teach: true });

// The real class, under the real domain: these must survive everything below.
await commitImport(real.id, parseClassList(CSV(
  '"Real, Rita",r700rea,R70000001,Student,',
  '"Keeper, Karl",k700kee,K70000002,Student,',
)), { sendNow: true, baseUrl: BASE });

// The rehearsal class, under the test domain, as the live rehearsal left it.
await commitImport(rehearsal.id, parseClassList(CSV(
  '"Alvarez, Maria",m204kqr,M10482913,Student,',
  '"Nakamura, Kenji",k142drf,K10228475,Student,',
  '"Marked, Mary",w900mrk,W90000001,Student,',
  '"Student, Demo",d999dmo,D99999999,Demo Student,',
), { domain: "rehearsal.invalid" }), { sendNow: true, baseUrl: BASE });

// A faculty account on the test domain, and a test account holding marks.
const testProf = await (async () => {
  const [u] = await db().insert(users).values({ displayName: "Test Prof" }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: "tp@rehearsal.invalid", passwordHash: "x" });
  await db().insert(enrolments).values({ sectionId: rehearsal.id, userId: u.id, role: "instructor" });
  return u;
})();
const testAdmin = await (async () => {
  const [u] = await db().insert(users).values({ displayName: "Test Admin" }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: "ta@rehearsal.invalid", passwordHash: "x" });
  await setAdminByEmail("ta@rehearsal.invalid");
  return u;
})();

// Mary has a grade and a submission, so she is spared by default.
const maryEnr = (await db().select({ id: enrolments.id, userId: enrolments.userId }).from(enrolments)
  .where(eq(enrolments.sectionId, rehearsal.id)));
const maryUserId = (await userIdFor("w900mrk@rehearsal.invalid"))!;
const maryEnrolment = maryEnr.find((e) => e.userId === maryUserId)!;
const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, rehearsal.id)))[0];
await db().insert(lineItemScores).values({ lineItemId: li.id, enrolmentId: maryEnrolment.id, points: 7, updatedAt: new Date() });
const [asg] = await db().insert(assignments).values({ sectionId: rehearsal.id, title: "Worksheet", points: 10, createdBy: prof.id }).returning();
const [sub] = await db().insert(submissions).values({ assignmentId: asg.id, enrolmentId: maryEnrolment.id, status: "submitted", text: "mine" }).returning();
await db().insert(submissionFiles).values({ submissionId: sub.id, blobPath: "submissions/x.pdf", fileName: "x.pdf", sizeBytes: 11 });

// Maria has an exam attempt — also work.
const mariaUserId = (await userIdFor("m204kqr@rehearsal.invalid"))!;
const mariaEnrolment = maryEnr.find((e) => e.userId === mariaUserId)!;
const [ex] = await db().insert(schema.exams).values({ sectionId: rehearsal.id, title: "E1", blueprintJson: "{}", status: "open", feedback: "after_close", attemptLimit: 1 }).returning();
const [att] = await db().insert(examAttempts).values({ examId: ex.id, enrolmentId: mariaEnrolment.id, servedJson: "[]", maxPoints: 2, score: 2, submittedAt: new Date() }).returning();
await db().insert(examResponses).values({ attemptId: att.id, questionId: "q1", correct: true });
await db().insert(bookmarks).values({ enrolmentId: mariaEnrolment.id, bookId: "mis3000", entryId: "ch01", chapterVersion: 1, scroll: 0.5, updatedAt: new Date() });

const before = await tableCensus(TABLES);

// ---------------------------------------------------------------- the dry run
console.log("The dry run");

await t("it deletes nothing, and says what it would", async () => {
  const plan = await planCleanup({ domain: "rehearsal.invalid" });
  assert.deepEqual(await tableCensus(TABLES), before, "not one row moved");
  assert.equal(plan.accounts.matched, 6, "four students, a test instructor, a test admin");
  assert.equal(plan.accounts.sparedHoldingWork, 2, "Mary's grade and submission, Maria's attempt");
  assert.equal(plan.accounts.sparedFacultyOrAdmin, 2, "the test instructor and the test admin");
  assert.equal(plan.accounts.deleting, 2, "Kenji and the demo");
  assert.equal(plan.perTable.users, 2);
  assert.ok(plan.perTable.identities === 2 && plan.perTable.enrolments === 2);
  assert.equal(plan.perTable.auth_tokens, 1, "Kenji's invitation goes with him; the demo never had one");
  assert.equal(plan.perTable.sections, undefined, "no class was named");
});

await t("--include-work and --include-faculty widen it, and say so in the numbers", async () => {
  const work = await planCleanup({ domain: "rehearsal.invalid", includeWork: true });
  assert.equal(work.accounts.deleting, 4, "the two holding work join them");
  assert.equal(work.accounts.sparedHoldingWork, 0);
  assert.equal(work.perTable.exam_attempts, 1);
  assert.equal(work.perTable.exam_responses, 1);
  assert.equal(work.perTable.submissions, 1);
  assert.equal(work.perTable.submission_files, 1);
  assert.equal(work.perTable.line_item_scores, 1);
  assert.equal(work.perTable.bookmarks, 1);
  assert.equal(work.orphanedUploads, 1, "one uploaded file would be left in Blob storage");

  const everything = await planCleanup({ domain: "rehearsal.invalid", includeWork: true, includeFaculty: true });
  assert.equal(everything.accounts.deleting, 6);
  assert.deepEqual(await tableCensus(TABLES), before, "still a dry run");
});

await t("naming the class adds the class's own rows", async () => {
  const plan = await planCleanup({ domain: "rehearsal.invalid", sectionId: rehearsal.id });
  assert.equal(plan.classes, 1);
  assert.equal(plan.perTable.sections, 1);
  assert.equal(plan.perTable.assignments, 1);
  assert.equal(plan.perTable.exams, 1);
  assert.ok(plan.perTable.line_items >= 1, "the starter gradebook columns");
  assert.equal(plan.perTable.enrolments, 6, "four students and both instructors");
  await assert.rejects(() => planCleanup({ sectionId: "no-such-class" }), /No class with that id/);
});

// ---------------------------------------------------------------- applying it
console.log("Applying it");

await t("the default pass takes the two safe accounts and nothing else", async () => {
  const done = await applyCleanup({ domain: "rehearsal.invalid" });
  assert.equal(done.accounts.deleting, 2);
  const after = await tableCensus(TABLES);
  assert.equal(before.users - after.users, 2);
  assert.equal(await userIdFor("k142drf@rehearsal.invalid"), null, "Kenji is gone");
  assert.equal(await userIdFor("d999dmo@rehearsal.invalid"), null, "so is the demo");
  assert.ok(await userIdFor("w900mrk@rehearsal.invalid"), "Mary holds marks, so she stays");
  assert.ok(await userIdFor("m204kqr@rehearsal.invalid"), "Maria holds an attempt, so she stays");
  assert.ok(await userIdFor("tp@rehearsal.invalid"), "the test instructor stays");
  assert.ok(await userIdFor("ta@rehearsal.invalid"), "the test admin stays");
  assert.ok(await userIdFor("r700rea@wright.edu"), "and the real class is untouched");
  assert.ok(await userIdFor("k700kee@wright.edu"));
});

await t("the rest of it, class and all, leaves nothing dangling", async () => {
  const realBefore = {
    users: (await db().select({ c: count() }).from(users)
      .where(eq(users.displayName, "Rita Real")).then((r) => Number(r[0].c))),
    enrolments: Number((await db().select({ c: count() }).from(enrolments)
      .where(eq(enrolments.sectionId, real.id)))[0].c),
  };
  await applyCleanup({ domain: "rehearsal.invalid", sectionId: rehearsal.id, includeWork: true, includeFaculty: true });

  // Nothing references a deleted account or the deleted class: a census, then the joins.
  assert.equal(Number((await db().select({ c: count() }).from(sections).where(eq(sections.id, rehearsal.id)))[0].c), 0);
  for (const email of ["m204kqr@rehearsal.invalid", "w900mrk@rehearsal.invalid", "tp@rehearsal.invalid", "ta@rehearsal.invalid"]) {
    assert.equal(await userIdFor(email), null, `${email} is gone`);
  }
  const orphans = {
    enrolments: Number((await db().select({ c: count() }).from(enrolments).where(eq(enrolments.sectionId, rehearsal.id)))[0].c),
    assignments: Number((await db().select({ c: count() }).from(assignments).where(eq(assignments.sectionId, rehearsal.id)))[0].c),
    exams: Number((await db().select({ c: count() }).from(schema.exams).where(eq(schema.exams.sectionId, rehearsal.id)))[0].c),
    lineItems: Number((await db().select({ c: count() }).from(lineItems).where(eq(lineItems.sectionId, rehearsal.id)))[0].c),
    submissions: Number((await db().select({ c: count() }).from(submissions).where(eq(submissions.assignmentId, asg.id)))[0].c),
    submissionFiles: Number((await db().select({ c: count() }).from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id)))[0].c),
    attempts: Number((await db().select({ c: count() }).from(examAttempts).where(eq(examAttempts.id, att.id)))[0].c),
    responses: Number((await db().select({ c: count() }).from(examResponses).where(eq(examResponses.attemptId, att.id)))[0].c),
    scores: Number((await db().select({ c: count() }).from(lineItemScores).where(eq(lineItemScores.enrolmentId, maryEnrolment.id)))[0].c),
    bookmarks: Number((await db().select({ c: count() }).from(bookmarks).where(eq(bookmarks.enrolmentId, mariaEnrolment.id)))[0].c),
    tokens: Number((await db().select({ c: count() }).from(authTokens).where(eq(authTokens.sectionId, rehearsal.id)))[0].c),
    sessions: Number((await db().select({ c: count() }).from(sessions).where(eq(sessions.userId, testProf.id)))[0].c),
  };
  assert.deepEqual(orphans, {
    enrolments: 0, assignments: 0, exams: 0, lineItems: 0, submissions: 0, submissionFiles: 0,
    attempts: 0, responses: 0, scores: 0, bookmarks: 0, tokens: 0, sessions: 0,
  });

  // And the other class is exactly as it was.
  const after = {
    users: Number((await db().select({ c: count() }).from(users).where(eq(users.displayName, "Rita Real")))[0].c),
    enrolments: Number((await db().select({ c: count() }).from(enrolments).where(eq(enrolments.sectionId, real.id)))[0].c),
  };
  assert.deepEqual(after, realBefore, "the real class did not notice");
  assert.ok(await userIdFor("prof@flexee.org"), "and neither did its instructor");
});

await t("a second run has nothing left to do", async () => {
  const plan = await planCleanup({ domain: "rehearsal.invalid" });
  assert.equal(plan.accounts.matched, 0);
  assert.equal(plan.accounts.deleting, 0);
  assert.deepEqual(plan.perTable, {});
});

await t("the real class still exports, and its students still have their marks", async () => {
  const { exportCsv } = await import("@/lib/gradebook");
  const csv = await exportCsv(real.id, "d2l");
  assert.ok(csv.includes('"r700rea"') && csv.includes('"k700kee"'));
  assert.equal(Number((await db().select({ c: count() }).from(enrolments)
    .where(and(eq(enrolments.sectionId, real.id), eq(enrolments.role, "student"))))[0].c), 2);
});

// ---------------------------------------------------------------- the command itself
console.log("The command");

await t("the command refuses a real domain, and an empty invocation, before touching anything", () => {
  const run = (args: string[]) => {
    try {
      const out = execFileSync(process.execPath,
        ["--import", "./scripts/run-support/register.mjs", "--experimental-strip-types", "scripts/cleanup-test-data.ts", ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: "" } });
      return { code: 0, out };
    } catch (e: unknown) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };
  const bad = run(["--domain", "wright.edu"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /not a reserved test domain/);
  assert.match(bad.out, /\.invalid, \.test, \.example, \.localhost/);
  assert.ok(!/Deleted/.test(bad.out), "it never got as far as deleting");

  const nothing = run([]);
  assert.equal(nothing.code, 1);
  assert.match(nothing.out, /give --domain, --class, or both/);

  // --apply with no database to speak of refuses rather than reaching for one.
  const applyNoDb = run(["--apply", "--domain", "rehearsal.invalid"]);
  assert.equal(applyNoDb.code, 1);
  assert.ok(!/Deleted/.test(applyNoDb.out), "nothing was deleted");
});

await t("the dry run is the default, and the host check comes before the delete", () => {
  // No database is configured for a child process here, so this holds the ordering rather than
  // the outcome: the dry-run exit and the typed-host check both come before applyCleanup.
  const src = readFileSync("scripts/cleanup-test-data.ts", "utf8");
  assert.match(src, /DRY RUN — nothing will be deleted/);
  assert.ok(src.indexOf("if (!apply)") < src.indexOf("await applyCleanup"), "the dry-run exit comes first");
  assert.ok(src.indexOf("confirmed(typed, host)") < src.indexOf("await applyCleanup"),
    "and a host that does not match exits before anything is deleted");
});

// ---------------------------------------------------------------- rule 6
console.log("Rule 6 — the real import afterwards");

await t("the real-format list imports under wright.edu with no error, and no duplicates", async () => {
  const spring = await createSection(prof.id, "mis3000", "MIS 3000-02 (spring)", "2027 Spring", { teach: true });
  const fixture = readFileSync(path.join("scripts", "fixtures", "d2l_class_list.csv"), "utf8");
  const list = parseClassList(fixture, { domain: "wright.edu" });
  const r = await commitImport(spring.id, list, { sendNow: false, baseUrl: BASE });
  // The fixture's own two bad rows are still bad rows — a blank username and a duplicate — and
  // that is all: nothing is left over from the rehearsal to trip on.
  assert.deepEqual(r.problems.map((x) => x.reason).sort(), ["blank username", "duplicate username"]);
  assert.ok(!r.problems.some((x) => x.reason === "two accounts match this row"), "no collisions");
  assert.equal(r.emailDiffers, 0, "and nobody matched under a stale address");
  assert.equal(r.created + r.enrolled, list.students.length);
  // Twice: the second run changes nothing, which is what "no duplicates" means.
  const again = await commitImport(spring.id, list, { sendNow: false, baseUrl: BASE });
  assert.equal(again.created, 0);
  assert.equal(again.alreadyInClass, list.students.length);
  const { exportCsv } = await import("@/lib/gradebook");
  const csv = await exportCsv(spring.id, "d2l");
  assert.ok(csv.includes('"m204kqr"'), "and the export writes, so no two students share a key");
});

console.log(`\n${passed} checks passed`);
