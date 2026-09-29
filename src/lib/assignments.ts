import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, assignmentFiles, submissions, submissionFiles, enrolments, users, lineItems, lineItemScores } from "@/db/schema";
import { ownedSection } from "@/lib/roster";
import { setScore } from "@/lib/gradebook";

// Assignments and case studies. Faculty create one in a class, attach files and publish it; students
// submit text and files (and may replace their submission until it is graded); faculty grade each
// submission with a score and written feedback, and the score goes into the gradebook under the
// assignment's own column. Every function checks who is asking — pages never decide access.

export type R<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
export type Kind = "assignment" | "case_study";
export type FileRef = { blobPath: string; fileName: string; sizeBytes: number };
const MAX_FILE = 50 * 1024 * 1024, MAX_FILES = 10, MAX_TEXT = 100_000;

const fail = (error: string) => ({ ok: false as const, error });

function cleanFields(f: { title?: string; kind?: string; instructions?: string; dueAt?: Date | null; points?: number; allowLate?: boolean; published?: boolean }) {
  const title = (f.title ?? "").trim();
  if (!title) return fail("Give the assignment a title.");
  if (title.length > 200) return fail("Keep the title under 200 characters.");
  const points = Math.round(Number(f.points));
  if (!Number.isFinite(points) || points < 1 || points > 1000) return fail("Points must be a whole number from 1 to 1000.");
  if (f.dueAt && Number.isNaN(f.dueAt.getTime())) return fail("That due date is not valid.");
  const kind: Kind = f.kind === "case_study" ? "case_study" : "assignment";
  return { ok: true as const, v: { title, kind, points, instructions: (f.instructions ?? "").slice(0, MAX_TEXT), dueAt: f.dueAt ?? null,
    allowLate: f.allowLate ?? true, published: !!f.published } };
}

async function assignmentFor(id: string) {
  return (await db().select().from(assignments).where(eq(assignments.id, id)).limit(1))[0] ?? null;
}
/** The assignment, if this user teaches its class. */
async function taughtAssignment(userId: string, id: string) {
  const a = await assignmentFor(id);
  return a && (await ownedSection(userId, a.sectionId)) ? a : null;
}
/** The user's student enrolment in a class, if any. */
async function studentEnrolment(userId: string, sectionId: string) {
  return (await db().select().from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student"))).limit(1))[0] ?? null;
}
function checkFiles(files: FileRef[], prefix: string): string | null {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`;
  for (const f of files) {
    if (!f.blobPath.startsWith(prefix)) return "A file was not uploaded for this assignment.";
    if (!f.fileName || f.fileName.length > 200) return "A file name is missing or too long.";
    if (!(f.sizeBytes > 0 && f.sizeBytes <= MAX_FILE)) return "Each file must be under 50 MB.";
  }
  return null;
}

// ---- faculty ---------------------------------------------------------------------------------------
export async function createAssignment(userId: string, sectionId: string, fields: Parameters<typeof cleanFields>[0]): Promise<R<{ id: string }>> {
  if (!(await ownedSection(userId, sectionId))) return fail("Only this class's faculty can add assignments.");
  const c = cleanFields(fields); if (!c.ok) return c;
  const [a] = await db().insert(assignments).values({ sectionId, ...c.v, createdBy: userId }).returning();
  await db().insert(lineItems).values({ sectionId, kind: "assignment", refId: a.id, title: a.title, maxPoints: a.points, weight: 1 });
  return { ok: true, id: a.id };
}

export async function updateAssignment(userId: string, id: string, fields: Parameters<typeof cleanFields>[0]): Promise<R> {
  const a = await taughtAssignment(userId, id); if (!a) return fail("Only this class's faculty can change this assignment.");
  const c = cleanFields(fields); if (!c.ok) return c;
  const graded = await db().select({ s: submissions.score }).from(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.status, "graded")));
  const top = graded.reduce((m, g) => Math.max(m, g.s ?? 0), 0);
  if (c.v.points < top) return fail(`A submission is already graded ${top}; points cannot go below that.`);
  await db().update(assignments).set({ ...c.v, updatedAt: new Date() }).where(eq(assignments.id, id));
  await db().update(lineItems).set({ title: c.v.title, maxPoints: c.v.points })
    .where(and(eq(lineItems.sectionId, a.sectionId), eq(lineItems.refId, id)));
  return { ok: true };
}

/** Delete an assignment and its gradebook column — only while no submission has been graded. */
export async function deleteAssignment(userId: string, id: string): Promise<R> {
  const a = await taughtAssignment(userId, id); if (!a) return fail("Only this class's faculty can delete this assignment.");
  const g = await db().select({ id: submissions.id }).from(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.status, "graded"))).limit(1);
  if (g.length) return fail("Some submissions are graded, so the assignment and its grades are kept. Unpublish it instead.");
  await db().delete(lineItems).where(and(eq(lineItems.sectionId, a.sectionId), eq(lineItems.refId, id)));
  await db().delete(assignments).where(eq(assignments.id, id));
  return { ok: true };
}

export async function addAssignmentFiles(userId: string, id: string, files: FileRef[]): Promise<R> {
  const a = await taughtAssignment(userId, id); if (!a) return fail("Only this class's faculty can attach files.");
  const bad = checkFiles(files, `assignments/${id}/`); if (bad) return fail(bad);
  const have = await db().select({ id: assignmentFiles.id }).from(assignmentFiles).where(eq(assignmentFiles.assignmentId, id));
  if (have.length + files.length > MAX_FILES) return fail(`An assignment can have at most ${MAX_FILES} attachments.`);
  if (files.length) await db().insert(assignmentFiles).values(files.map((f) => ({ assignmentId: id, ...f })));
  return { ok: true };
}

export async function removeAssignmentFile(userId: string, id: string, fileId: string): Promise<R> {
  const a = await taughtAssignment(userId, id); if (!a) return fail("Only this class's faculty can remove attachments.");
  await db().delete(assignmentFiles).where(and(eq(assignmentFiles.id, fileId), eq(assignmentFiles.assignmentId, id)));
  return { ok: true };
}

/** A class's assignments for its faculty, with submission counts. */
export async function classAssignments(userId: string, sectionId: string) {
  if (!(await ownedSection(userId, sectionId))) return null;
  const list = await db().select().from(assignments).where(eq(assignments.sectionId, sectionId)).orderBy(asc(assignments.dueAt), asc(assignments.createdAt));
  const subs = list.length ? await db().select({ a: submissions.assignmentId, s: submissions.status }).from(submissions)
    .where(inArray(submissions.assignmentId, list.map((x) => x.id))) : [];
  return list.map((a) => ({ ...a,
    submitted: subs.filter((s) => s.a === a.id).length,
    graded: subs.filter((s) => s.a === a.id && s.s === "graded").length }));
}

/** One assignment for its faculty: files, every student with their submission (or none). */
export async function assignmentForFaculty(userId: string, id: string) {
  const a = await taughtAssignment(userId, id); if (!a) return null;
  const files = await db().select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, id)).orderBy(asc(assignmentFiles.createdAt));
  const students = await db().select({ enrolmentId: enrolments.id, name: users.displayName }).from(enrolments)
    .innerJoin(users, eq(users.id, enrolments.userId)).where(and(eq(enrolments.sectionId, a.sectionId), eq(enrolments.role, "student")));
  const subs = await db().select().from(submissions).where(eq(submissions.assignmentId, id));
  const rows = students.map((s) => ({ ...s, submission: subs.find((x) => x.enrolmentId === s.enrolmentId) ?? null }))
    .sort((x, y) => x.name.localeCompare(y.name));
  return { assignment: a, files, rows };
}

/** One submission for grading. */
export async function submissionForFaculty(userId: string, submissionId: string) {
  const s = (await db().select().from(submissions).where(eq(submissions.id, submissionId)).limit(1))[0];
  if (!s) return null;
  const a = await taughtAssignment(userId, s.assignmentId); if (!a) return null;
  const student = (await db().select({ name: users.displayName }).from(enrolments).innerJoin(users, eq(users.id, enrolments.userId))
    .where(eq(enrolments.id, s.enrolmentId)).limit(1))[0];
  const files = await db().select().from(submissionFiles).where(eq(submissionFiles.submissionId, s.id)).orderBy(asc(submissionFiles.createdAt));
  return { assignment: a, submission: s, student: student?.name ?? "Student", files };
}

/** Grade a submission (or change its grade). The score goes into the gradebook. */
export async function gradeSubmission(userId: string, submissionId: string, score: number, feedback: string): Promise<R> {
  const s = (await db().select().from(submissions).where(eq(submissions.id, submissionId)).limit(1))[0];
  if (!s) return fail("That submission no longer exists.");
  const a = await taughtAssignment(userId, s.assignmentId); if (!a) return fail("Only this class's faculty can grade it.");
  const pts = Number(score);
  if (!Number.isFinite(pts) || pts < 0 || pts > a.points) return fail(`Score must be between 0 and ${a.points}.`);
  const rounded = Math.round(pts * 100) / 100;
  await db().update(submissions).set({ status: "graded", score: rounded, feedback: (feedback ?? "").slice(0, 20_000), gradedBy: userId, gradedAt: new Date() })
    .where(eq(submissions.id, s.id));
  const item = (await db().select({ id: lineItems.id }).from(lineItems).where(and(eq(lineItems.sectionId, a.sectionId), eq(lineItems.refId, a.id))).limit(1))[0];
  const lineItemId = item?.id ?? (await db().insert(lineItems).values({ sectionId: a.sectionId, kind: "assignment", refId: a.id, title: a.title, maxPoints: a.points, weight: 1 }).returning())[0].id;
  await setScore(lineItemId, s.enrolmentId, rounded);
  return { ok: true };
}

/** Let the student revise: the submission reopens and its gradebook score is removed. */
export async function reopenSubmission(userId: string, submissionId: string): Promise<R> {
  const s = (await db().select().from(submissions).where(eq(submissions.id, submissionId)).limit(1))[0];
  if (!s) return fail("That submission no longer exists.");
  const a = await taughtAssignment(userId, s.assignmentId); if (!a) return fail("Only this class's faculty can reopen it.");
  await db().update(submissions).set({ status: "submitted", score: null, gradedBy: null, gradedAt: null }).where(eq(submissions.id, s.id));
  const item = (await db().select({ id: lineItems.id }).from(lineItems).where(and(eq(lineItems.sectionId, a.sectionId), eq(lineItems.refId, a.id))).limit(1))[0];
  if (item) await db().delete(lineItemScores).where(and(eq(lineItemScores.lineItemId, item.id), eq(lineItemScores.enrolmentId, s.enrolmentId)));
  return { ok: true };
}

// ---- students --------------------------------------------------------------------------------------
/** A class's published assignments, with this student's own submission state. */
export async function studentAssignments(userId: string, sectionId: string) {
  const enr = await studentEnrolment(userId, sectionId); if (!enr) return null;
  const list = await db().select().from(assignments).where(and(eq(assignments.sectionId, sectionId), eq(assignments.published, true)))
    .orderBy(asc(assignments.dueAt), asc(assignments.createdAt));
  const subs = list.length ? await db().select().from(submissions)
    .where(and(eq(submissions.enrolmentId, enr.id), inArray(submissions.assignmentId, list.map((x) => x.id)))) : [];
  return list.map((a) => ({ ...a, submission: subs.find((s) => s.assignmentId === a.id) ?? null }));
}

/** One published assignment for a student in its class, with attachments and their own submission. */
export async function assignmentForStudent(userId: string, id: string) {
  const a = await assignmentFor(id); if (!a || !a.published) return null;
  const enr = await studentEnrolment(userId, a.sectionId); if (!enr) return null;
  const files = await db().select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, id)).orderBy(asc(assignmentFiles.createdAt));
  const sub = (await db().select().from(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.enrolmentId, enr.id))).limit(1))[0] ?? null;
  const subFiles = sub ? await db().select().from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id)).orderBy(asc(submissionFiles.createdAt)) : [];
  return { assignment: a, files, submission: sub, submissionFiles: subFiles };
}

/** Submit, or replace a submission that has not been graded yet. */
export async function submit(userId: string, id: string, input: { text: string; files: FileRef[] }, now = new Date()): Promise<R<{ late: boolean }>> {
  const a = await assignmentFor(id);
  if (!a || !a.published) return fail("That assignment is not open.");
  const enr = await studentEnrolment(userId, a.sectionId); if (!enr) return fail("You are not a student in this class.");
  const late = !!a.dueAt && now > a.dueAt;
  if (late && !a.allowLate) return fail("The due date has passed and this assignment does not accept late work.");
  const text = (input.text ?? "").slice(0, MAX_TEXT).trim();
  const files = input.files ?? [];
  if (!text && files.length === 0) return fail("Write something or attach a file before submitting.");
  const bad = checkFiles(files, `submissions/${id}/${userId}/`); if (bad) return fail(bad);
  const prev = (await db().select().from(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.enrolmentId, enr.id))).limit(1))[0];
  if (prev?.status === "graded") return fail("This submission has been graded. Ask your instructor to reopen it if you need to revise.");
  let subId: string;
  if (prev) {
    await db().update(submissions).set({ text, late, submittedAt: now, status: "submitted" }).where(eq(submissions.id, prev.id));
    await db().delete(submissionFiles).where(eq(submissionFiles.submissionId, prev.id)); // a resubmission replaces the files too
    subId = prev.id;
  } else {
    subId = (await db().insert(submissions).values({ assignmentId: id, enrolmentId: enr.id, text, late, submittedAt: now }).returning())[0].id;
  }
  if (files.length) await db().insert(submissionFiles).values(files.map((f) => ({ submissionId: subId, ...f })));
  return { ok: true, late };
}

// ---- who may download a file -----------------------------------------------------------------------
/** The file's storage path and name if this user may download it; otherwise null. */
export async function downloadable(userId: string, kind: "assignment" | "submission", fileId: string) {
  if (kind === "assignment") {
    const f = (await db().select().from(assignmentFiles).where(eq(assignmentFiles.id, fileId)).limit(1))[0]; if (!f) return null;
    const a = await assignmentFor(f.assignmentId); if (!a) return null;
    if (await ownedSection(userId, a.sectionId)) return f;
    if (a.published && (await studentEnrolment(userId, a.sectionId))) return f;
    return null;
  }
  const f = (await db().select().from(submissionFiles).where(eq(submissionFiles.id, fileId)).limit(1))[0]; if (!f) return null;
  const s = (await db().select().from(submissions).where(eq(submissions.id, f.submissionId)).limit(1))[0]; if (!s) return null;
  const a = await assignmentFor(s.assignmentId); if (!a) return null;
  if (await ownedSection(userId, a.sectionId)) return f;
  const mine = (await db().select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.id, s.enrolmentId), eq(enrolments.userId, userId))).limit(1))[0];
  return mine ? f : null;
}

/** May this user upload files for this assignment, and under which path? (Used to issue upload tokens.) */
export async function uploadPrefix(userId: string, purpose: "assignment" | "submission", id: string) {
  const a = await assignmentFor(id); if (!a) return null;
  if (purpose === "assignment") return (await ownedSection(userId, a.sectionId)) ? `assignments/${id}/` : null;
  if (!a.published || !(await studentEnrolment(userId, a.sectionId))) return null;
  return `submissions/${id}/${userId}/`;
}
