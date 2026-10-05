"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { recordUpload, approveUpload } from "@/lib/library";
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
