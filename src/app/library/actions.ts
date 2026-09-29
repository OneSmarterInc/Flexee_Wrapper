"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { recordUpload, approveUpload } from "@/lib/library";

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
