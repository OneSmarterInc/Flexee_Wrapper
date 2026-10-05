"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { recordUpload, approveUpload, dismissUpload, dismissAllNotAdded, retryIntake } from "@/lib/library";
import { retireBook, restoreBook } from "@/lib/retire";

export async function registerUploadAction(input: { bookId: string; blobPath: string; fileName: string; sizeBytes: number }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Your session has ended. Sign in again." };
  return recordUpload(user.id, {
    bookId: String(input.bookId || "").trim().toLowerCase(), blobPath: String(input.blobPath || ""),
    fileName: String(input.fileName || ""), sizeBytes: Math.max(0, Math.floor(Number(input.sizeBytes) || 0)),
  });
}

export async function approveUploadAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/library/${id}`)}`);
  const r = await approveUpload(user!.id, id);
  redirect(`/library/${id}?${r.ok ? "ok=" + encodeURIComponent("Adding the book to the library. This takes a minute or two.") : "error=" + encodeURIComponent(r.error)}`);
}

// Spec 22 §1: retire and restore. Admin-only, enforced in the library rather than by hiding the
// button, so a forged post is refused too. Both redirect back to the list with a plain message.
export async function retireBookAction(formData: FormData) {
  const bookId = String(formData.get("bookId") || "");
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  const r = await retireBook(user!.id, bookId);
  redirect(`/library?${r.ok
    ? "ok=" + encodeURIComponent(`${bookId} is retired. Classes using it keep working.`)
    : "error=" + encodeURIComponent(r.error)}#books`);
}

export async function restoreBookAction(formData: FormData) {
  const bookId = String(formData.get("bookId") || "");
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  const r = await restoreBook(user!.id, bookId);
  redirect(`/library?${r.ok
    ? "ok=" + encodeURIComponent(`${bookId} is back in the library.`)
    : "error=" + encodeURIComponent(r.error)}#books`);
}

// Spec 22 §2: dismiss a record, or every record not yet added. The uploader or any admin; never a
// record whose book is in the library.
export async function dismissUploadAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  const r = await dismissUpload(user!.id, id);
  redirect(`/library?${r.ok
    ? "ok=" + encodeURIComponent("Record dismissed. The uploaded file is untouched.")
    : "error=" + encodeURIComponent(r.error)}#uploads`);
}

export async function dismissAllAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  // The count the page showed is re-counted here from the same rule, so what is hidden is what was
  // described even if a record changed status in between.
  const expected = Number(formData.get("count") || 0);
  const r = await dismissAllNotAdded(user!.id);
  if (!r.ok) redirect(`/library?error=${encodeURIComponent(r.error)}#uploads`);
  const n = r.count ?? 0;
  const note = n === expected ? "" : ` (${expected} when the page was drawn)`;
  redirect(`/library?ok=${encodeURIComponent(
    `Dismissed ${n} record${n === 1 ? "" : "s"}${note}. No uploaded file was touched.`)}#uploads`);
}

// Spec 22 §6: the Retry button on a record whose start failed.
export async function retryIntakeAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/library/${id}`)}`);
  const r = await retryIntake(user!.id, id);
  redirect(`/library/${id}?${r.ok
    ? "ok=" + encodeURIComponent("Starting the check again.")
    : "error=" + encodeURIComponent(r.error)}`);
}
