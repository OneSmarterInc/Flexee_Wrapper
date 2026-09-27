"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { createSection, commitRoster, removeEnrolment, type ClassRole } from "@/lib/roster";
import { classById, parsePeople, removeInvite } from "@/lib/admin";

const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const msg = (path: string, key: "ok" | "error", text: string) => `${path}?${key}=${encodeURIComponent(text)}`;

// Every admin action starts here: signed in, and an admin — otherwise nothing happens.
async function requireAdmin(next = "/admin") {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user!.systemRole !== "admin") redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  return user!;
}

export async function createClassAction(formData: FormData) {
  const admin = await requireAdmin();
  const bookId = clean(formData.get("bookId")), name = clean(formData.get("name"));
  const term = clean(formData.get("term")) || undefined;
  if (!bookId || !name) redirect(msg("/admin", "error", "Choose a book and name the class."));
  const sec = await createSection(admin.id, bookId, name, term, { teach: formData.get("teach") === "on" });
  redirect(msg(`/admin/${sec.id}`, "ok", `Class "${name}" created. Add its faculty and students below.`));
}

export async function addPeopleAction(formData: FormData) {
  const sectionId = clean(formData.get("sectionId"));
  await requireAdmin(`/admin/${sectionId}`);
  if (!(await classById(sectionId))) redirect(msg("/admin", "error", "That class no longer exists."));
  const role: ClassRole = clean(formData.get("role")) === "instructor" ? "instructor" : "student";
  let text = clean(formData.get("people"));
  const file = formData.get("file");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > 1_000_000) redirect(msg(`/admin/${sectionId}`, "error", "That file is too large for a class list (1 MB limit)."));
    text += "\n" + (await file.text());
  }
  const rows = parsePeople(text);
  const who = role === "instructor" ? "faculty" : "students";
  if (!rows.length) redirect(msg(`/admin/${sectionId}`, "error", `No valid email addresses found to add as ${who}.`));
  const { enrolled, invited } = await commitRoster(sectionId, rows, role);
  redirect(msg(`/admin/${sectionId}`, "ok",
    `Added ${rows.length} ${who}: ${enrolled} already had accounts and are in the class now; ${invited} will join it when they sign up with that email.`));
}

export async function removePersonAction(formData: FormData) {
  const sectionId = clean(formData.get("sectionId"));
  await requireAdmin(`/admin/${sectionId}`);
  await removeEnrolment(sectionId, clean(formData.get("enrolmentId")));
  redirect(msg(`/admin/${sectionId}`, "ok", "Removed from the class."));
}

export async function removeInviteAction(formData: FormData) {
  const sectionId = clean(formData.get("sectionId"));
  await requireAdmin(`/admin/${sectionId}`);
  await removeInvite(sectionId, clean(formData.get("inviteId")));
  redirect(msg(`/admin/${sectionId}`, "ok", "Invitation withdrawn."));
}
