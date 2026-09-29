"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { chooseClassBook, publishClassBook, unpublishClassBook, type ClassResult } from "@/lib/publish";

const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
// Only return to pages inside the app.
const back = (v: string) => (v.startsWith("/teach/") || v.startsWith("/admin/") ? v : "/teach");

async function run(formData: FormData, act: (userId: string, sectionId: string) => Promise<ClassResult>, done: string) {
  const to = back(clean(formData.get("back")));
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(to)}`);
  const r = await act(user!.id, clean(formData.get("sectionId")));
  redirect(`${to}?${r.ok ? "ok" : "error"}=${encodeURIComponent(r.ok ? done : r.error)}`);
}

export async function publishBookAction(formData: FormData) {
  await run(formData, publishClassBook, "Published. Students in this class can now open the book.");
}
export async function unpublishBookAction(formData: FormData) {
  await run(formData, unpublishClassBook, "Unpublished. Students in this class can no longer open the book.");
}
export async function chooseBookAction(formData: FormData) {
  const bookId = clean(formData.get("bookId"));
  await run(formData, (u, s) => chooseClassBook(u, s, bookId), "Book changed. Publish it when you are ready for students to see it.");
}
