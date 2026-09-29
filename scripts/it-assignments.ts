// Integration test: assignments and case studies (lib/assignments) — creation and the gradebook column,
// who sees what, submitting and resubmitting, late rules, grading into the gradebook, reopening, and
// who may download each file.
import assert from "node:assert/strict";
import { db, schema } from "@/db";
import { parsePeople } from "@/lib/admin";
import { createSection, commitRoster } from "@/lib/roster";
import { gradebook } from "@/lib/gradebook";
import {
  createAssignment, updateAssignment, deleteAssignment, addAssignmentFiles, classAssignments, assignmentForFaculty,
  submissionForFaculty, gradeSubmission, reopenSubmission, studentAssignments, assignmentForStudent, submit,
  downloadable, uploadPrefix,
} from "@/lib/assignments";

const { users, identities } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const prof = await account("Prof", "prof@flexee.org");
const otherProf = await account("Other Prof", "other@flexee.org");
const ann = await account("Ann", "ann@wright.edu");
const bo = await account("Bo", "bo@wright.edu");
const outsider = await account("Outsider", "out@wright.edu");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
await createSection(otherProf.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
await commitRoster(cls.id, parsePeople("ann@wright.edu\nbo@wright.edu"), "student");
const ok = (r: any) => { assert.equal(r.ok, true, r.error); return r; };
const gbCell = async (assignmentId: string, name: string) => {
  const g = await gradebook(cls.id); const it = g.items.find((i) => i.refId === assignmentId)!;
  return { item: it, cell: g.students.find((s) => s.name === name)!.cells[it.id] };
};

console.log("Faculty create assignments");
let a1 = "", cs = "";
await t("creating an assignment adds its own gradebook column", async () => {
  a1 = ok(await createAssignment(prof.id, cls.id, { title: "Context diagram", instructions: "Draw it.", points: 20,
    dueAt: new Date("2027-02-01T23:59:00Z"), allowLate: true, published: true })).id;
  const { item } = await gbCell(a1, "Ann");
  assert.equal(item.kind, "assignment"); assert.equal(item.maxPoints, 20); assert.equal(item.title, "Context diagram");
});
await t("a case study is created unpublished; students do not see it", async () => {
  cs = ok(await createAssignment(prof.id, cls.id, { title: "Harlan Ridge case", kind: "case_study", points: 50,
    dueAt: new Date("2027-03-01T23:59:00Z"), allowLate: false, published: false })).id;
  const list = await studentAssignments(ann.id, cls.id);
  assert.deepEqual(list!.map((x) => x.id), [a1]);
  assert.equal(await assignmentForStudent(ann.id, cs), null);
  assert.equal((await submit(ann.id, cs, { text: "early", files: [] })).ok, false);
});
await t("bad input is refused: no title, points out of range", async () => {
  assert.equal((await createAssignment(prof.id, cls.id, { title: " ", points: 10 })).ok, false);
  assert.equal((await createAssignment(prof.id, cls.id, { title: "x", points: 0 })).ok, false);
  assert.equal((await createAssignment(prof.id, cls.id, { title: "x", points: 5000 })).ok, false);
});
await t("only the class's faculty can create or change its assignments", async () => {
  assert.equal((await createAssignment(otherProf.id, cls.id, { title: "x", points: 10 })).ok, false);
  assert.equal((await createAssignment(ann.id, cls.id, { title: "x", points: 10 })).ok, false);
  assert.equal((await updateAssignment(otherProf.id, a1, { title: "hijack", points: 10 })).ok, false);
  assert.equal(await classAssignments(otherProf.id, cls.id), null);
});
await t("attachments: faculty may attach under the assignment's own path only", async () => {
  ok(await addAssignmentFiles(prof.id, a1, [{ blobPath: `assignments/${a1}/brief.pdf`, fileName: "brief.pdf", sizeBytes: 1000 }]));
  assert.equal((await addAssignmentFiles(prof.id, a1, [{ blobPath: `assignments/other/x.pdf`, fileName: "x.pdf", sizeBytes: 10 }])).ok, false);
  assert.equal((await addAssignmentFiles(prof.id, a1, [{ blobPath: `assignments/${a1}/big.zip`, fileName: "big.zip", sizeBytes: 60e6 }])).ok, false);
  assert.equal((await addAssignmentFiles(ann.id, a1, [{ blobPath: `assignments/${a1}/y.pdf`, fileName: "y.pdf", sizeBytes: 10 }])).ok, false);
});

console.log("Students submit");
await t("a student submits text and a file under their own path; not late before the due date", async () => {
  const r = ok(await submit(ann.id, a1, { text: "My diagram notes", files: [{ blobPath: `submissions/${a1}/${ann.id}/d.pdf`, fileName: "d.pdf", sizeBytes: 500 }] },
    new Date("2027-01-30T10:00:00Z")));
  assert.equal(r.late, false);
  const v = await assignmentForStudent(ann.id, a1);
  assert.equal(v!.submission!.text, "My diagram notes"); assert.equal(v!.submissionFiles.length, 1);
});
await t("a student cannot file under another student's path, or submit nothing", async () => {
  assert.equal((await submit(bo.id, a1, { text: "x", files: [{ blobPath: `submissions/${a1}/${ann.id}/steal.pdf`, fileName: "s.pdf", sizeBytes: 5 }] })).ok, false);
  assert.equal((await submit(bo.id, a1, { text: "   ", files: [] })).ok, false);
});
await t("resubmitting before grading replaces the text and the files", async () => {
  ok(await submit(ann.id, a1, { text: "Revised notes", files: [] }, new Date("2027-01-31T10:00:00Z")));
  const v = await assignmentForStudent(ann.id, a1);
  assert.equal(v!.submission!.text, "Revised notes"); assert.equal(v!.submissionFiles.length, 0);
});
await t("late work is accepted and marked late when allowed; refused when not", async () => {
  const r = ok(await submit(bo.id, a1, { text: "Sorry, late", files: [] }, new Date("2027-02-03T09:00:00Z")));
  assert.equal(r.late, true);
  ok(await updateAssignment(prof.id, cs, { title: "Harlan Ridge case", kind: "case_study", points: 50, dueAt: new Date("2027-03-01T23:59:00Z"), allowLate: false, published: true }));
  assert.equal((await submit(bo.id, cs, { text: "too late", files: [] }, new Date("2027-03-02T00:00:00Z"))).ok, false);
  ok(await submit(bo.id, cs, { text: "on time", files: [] }, new Date("2027-03-01T12:00:00Z")));
});
await t("people outside the class cannot see or submit", async () => {
  assert.equal(await studentAssignments(outsider.id, cls.id), null);
  assert.equal(await assignmentForStudent(outsider.id, a1), null);
  assert.equal((await submit(outsider.id, a1, { text: "hi", files: [] })).ok, false);
  assert.equal(await uploadPrefix(outsider.id, "submission", a1), null);
});

console.log("Faculty grade");
let annSub = "";
await t("faculty see every student, with or without a submission", async () => {
  const v = await assignmentForFaculty(prof.id, a1);
  assert.deepEqual(v!.rows.map((r) => [r.name, !!r.submission]), [["Ann", true], ["Bo", true]]);
  annSub = v!.rows.find((r) => r.name === "Ann")!.submission!.id;
  assert.equal(await assignmentForFaculty(otherProf.id, a1), null);
  assert.equal(await submissionForFaculty(otherProf.id, annSub), null);
});
await t("a grade outside 0..points is refused; a valid grade lands in the gradebook with feedback", async () => {
  assert.equal((await gradeSubmission(prof.id, annSub, 25, "")).ok, false);
  assert.equal((await gradeSubmission(prof.id, annSub, -1, "")).ok, false);
  assert.equal((await gradeSubmission(otherProf.id, annSub, 10, "")).ok, false);
  ok(await gradeSubmission(prof.id, annSub, 17.5, "Good boundary; missing one data store."));
  assert.equal((await gbCell(a1, "Ann")).cell.points, 17.5);
  const v = await assignmentForStudent(ann.id, a1);
  assert.equal(v!.submission!.status, "graded"); assert.equal(v!.submission!.score, 17.5); assert.match(v!.submission!.feedback!, /data store/);
});
await t("a graded submission is locked for the student", async () => {
  assert.equal((await submit(ann.id, a1, { text: "one more try", files: [] })).ok, false);
});
await t("regrading updates the gradebook; reopening lets the student revise and removes the score", async () => {
  ok(await gradeSubmission(prof.id, annSub, 18, "Regraded."));
  assert.equal((await gbCell(a1, "Ann")).cell.points, 18);
  ok(await reopenSubmission(prof.id, annSub));
  assert.equal((await gbCell(a1, "Ann")).cell.points, null);
  ok(await submit(ann.id, a1, { text: "Revised after feedback", files: [] }, new Date("2027-02-05T10:00:00Z")));
});
await t("points cannot drop below a grade already given; changing points updates the column", async () => {
  const boSub = (await assignmentForFaculty(prof.id, a1))!.rows.find((r) => r.name === "Bo")!.submission!.id;
  ok(await gradeSubmission(prof.id, boSub, 15, "Late but solid."));
  assert.equal((await updateAssignment(prof.id, a1, { title: "Context diagram", points: 10, published: true })).ok, false);
  ok(await updateAssignment(prof.id, a1, { title: "Context diagram (v2)", points: 25, published: true }));
  const { item } = await gbCell(a1, "Bo"); assert.equal(item.maxPoints, 25); assert.equal(item.title, "Context diagram (v2)");
});
await t("an assignment with graded work cannot be deleted; one without can, with its column", async () => {
  assert.equal((await deleteAssignment(prof.id, a1)).ok, false);
  const tmp = ok(await createAssignment(prof.id, cls.id, { title: "Scratch", points: 5 })).id;
  ok(await deleteAssignment(prof.id, tmp));
  assert.ok(!(await gradebook(cls.id)).items.some((i) => i.refId === tmp));
});

console.log("Who may download each file");
await t("assignment attachments: the class's faculty and its students (once published); nobody else", async () => {
  const fileId = (await assignmentForFaculty(prof.id, a1))!.files[0].id;
  assert.ok(await downloadable(prof.id, "assignment", fileId));
  assert.ok(await downloadable(ann.id, "assignment", fileId));
  assert.equal(await downloadable(outsider.id, "assignment", fileId), null);
  assert.equal(await downloadable(otherProf.id, "assignment", fileId), null);
});
await t("submission files: the student who submitted and the class's faculty; not classmates", async () => {
  ok(await submit(bo.id, cs, { text: "with file", files: [{ blobPath: `submissions/${cs}/${bo.id}/case.docx`, fileName: "case.docx", sizeBytes: 900 }] }, new Date("2027-03-01T12:30:00Z")));
  const boFile = (await assignmentForStudent(bo.id, cs))!.submissionFiles[0].id;
  assert.ok(await downloadable(bo.id, "submission", boFile));
  assert.ok(await downloadable(prof.id, "submission", boFile));
  assert.equal(await downloadable(ann.id, "submission", boFile), null, "a classmate cannot download it");
  assert.equal(await downloadable(otherProf.id, "submission", boFile), null);
});
await t("upload paths: faculty under assignments/<id>/, students under submissions/<id>/<their id>/", async () => {
  assert.equal(await uploadPrefix(prof.id, "assignment", a1), `assignments/${a1}/`);
  assert.equal(await uploadPrefix(ann.id, "assignment", a1), null);
  assert.equal(await uploadPrefix(ann.id, "submission", a1), `submissions/${a1}/${ann.id}/`);
});

console.log(`\n${passed} passed`);
