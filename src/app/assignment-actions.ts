"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { parseLocal } from "@/lib/time";
import {
  createAssignment, updateAssignment, deleteAssignment, addAssignmentFiles, removeAssignmentFile,
  gradeSubmission, reopenSubmission, submit, type FileRef,
} from "@/lib/assignments";

const s = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v.trim() : ""; };
const to = (path: string, r: { ok: boolean; error?: string }, ok: string) =>
  redirect(`${path}?${r.ok ? "ok=" + encodeURIComponent(ok) : "error=" + encodeURIComponent(r.error ?? "Something went wrong.")}`);
async function me(next: string) {
  const u = await currentUser(); if (!u) redirect(`/login?next=${encodeURIComponent(next)}`); return u!;
}
function files(f: FormData, k: string): FileRef[] {
  try {
    const a = JSON.parse(s(f, k) || "[]");
    return Array.isArray(a) ? a.filter((x) => x && typeof x.blobPath === "string").map((x) => ({
      blobPath: String(x.blobPath), fileName: String(x.fileName ?? ""), sizeBytes: Math.floor(Number(x.sizeBytes) || 0) })) : [];
  } catch { return []; }
}
function fields(f: FormData) {
  return { title: s(f, "title"), kind: s(f, "kind"), instructions: s(f, "instructions"), dueAt: parseLocal(s(f, "due")),
    points: Number(s(f, "points")), allowLate: f.get("allowLate") === "on", published: f.get("published") === "on" };
}
const base = (sectionId: string) => `/teach/${encodeURIComponent(sectionId)}/assignments`;

export async function createAssignmentAction(f: FormData) {
  const sectionId = s(f, "sectionId"); const u = await me(base(sectionId));
  const r = await createAssignment(u.id, sectionId, fields(f));
  if (r.ok) redirect(`${base(sectionId)}/${r.id}?ok=${encodeURIComponent("Created. Attach files if you need to, and publish it when it is ready.")}`);
  to(base(sectionId), r, "");
}
export async function updateAssignmentAction(f: FormData) {
  const sectionId = s(f, "sectionId"), id = s(f, "id"); const u = await me(`${base(sectionId)}/${id}`);
  to(`${base(sectionId)}/${id}`, await updateAssignment(u.id, id, fields(f)), "Saved.");
}
export async function deleteAssignmentAction(f: FormData) {
  const sectionId = s(f, "sectionId"), id = s(f, "id"); const u = await me(base(sectionId));
  const r = await deleteAssignment(u.id, id);
  if (r.ok) to(base(sectionId), r, "Deleted, with its gradebook column.");
  to(`${base(sectionId)}/${id}`, r, "");
}
export async function addFilesAction(f: FormData) {
  const sectionId = s(f, "sectionId"), id = s(f, "id"); const u = await me(`${base(sectionId)}/${id}`);
  to(`${base(sectionId)}/${id}`, await addAssignmentFiles(u.id, id, files(f, "files")), "Attached.");
}
export async function removeFileAction(f: FormData) {
  const sectionId = s(f, "sectionId"), id = s(f, "id"); const u = await me(`${base(sectionId)}/${id}`);
  to(`${base(sectionId)}/${id}`, await removeAssignmentFile(u.id, id, s(f, "fileId")), "Attachment removed.");
}
export async function gradeAction(f: FormData) {
  const sectionId = s(f, "sectionId"), id = s(f, "assignmentId"), sub = s(f, "submissionId");
  const u = await me(`${base(sectionId)}/${id}/${sub}`);
  const r = await gradeSubmission(u.id, sub, Number(s(f, "score")), s(f, "feedback"));
  if (r.ok) to(`${base(sectionId)}/${id}`, r, "Graded. The score is in the gradebook, and the student can see it with your feedback.");
  to(`${base(sectionId)}/${id}/${sub}`, r, "");
}
export async function reopenAction(f: FormData) {
  const sectionId = s(f, "sectionId"), id = s(f, "assignmentId"), sub = s(f, "submissionId");
  const u = await me(`${base(sectionId)}/${id}/${sub}`);
  to(`${base(sectionId)}/${id}/${sub}`, await reopenSubmission(u.id, sub), "Reopened. The student can revise and resubmit; the score was removed from the gradebook.");
}
export async function submitAction(f: FormData) {
  const book = s(f, "book"), id = s(f, "assignmentId"); const path = `/${encodeURIComponent(book)}/assignments/${id}`;
  const u = await me(path);
  const r = await submit(u.id, id, { text: s(f, "text"), files: files(f, "files") });
  to(path, r, r.ok && r.late ? "Submitted — after the due date, so it is marked late." : "Submitted. You can replace it until it is graded.");
}
