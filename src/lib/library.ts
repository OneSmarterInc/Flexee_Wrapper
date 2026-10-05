import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { libraryUploads, enrolments, users } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { isRetired } from "@/lib/retire";

// Books enter the library by upload. Faculty or admins upload a book folder as a zip (downloaded
// from Drive); the intake runs in GitHub Actions (.github/workflows/library-intake.yml), using the
// same tested intake and validator as ever, and writes its report back here. When the report says
// ready, the uploader or an admin adds the book to the library; the job then publishes it to Blob
// under live/<book>/ (the previous version is archived) and loads its chapters and questions.
// Students see it only once a class's faculty publish it to that class (lib/publish).

export type UploadStatus = "checking" | "ready" | "stopped" | "failed" | "publishing" | "published";
export type Result = { ok: true; id?: string } | { ok: false; error: string };

/** Admins, and anyone who teaches at least one class. */
export async function canUpload(userId: string) {
  if (await isAdmin(userId)) return true;
  const r = await db().select({ id: enrolments.id }).from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.role, "instructor"))).limit(1);
  return r.length > 0;
}

/** A book id: lowercase letters and digits, as used in content/<book>/ and question ids (e.g. sad, mis3000). */
export function validBookId(id: string) { return /^[a-z][a-z0-9]{1,30}$/.test(id); }

// ---- starting the intake in GitHub Actions -------------------------------------------------------
// Settings: GITHUB_DISPATCH_TOKEN (fine-grained token with Actions: write on the repository),
// GITHUB_REPO (e.g. OneSmarterInc/Flexee_Wrapper), GITHUB_REF (branch, default main).
type Fetch = typeof fetch;
let _fetch: Fetch = (...a) => fetch(...a);
export function setDispatchFetch(f: Fetch) { _fetch = f; } // tests

export async function dispatchIntake(action: "check" | "publish", uploadId: string, bookId: string, env = process.env): Promise<Result> {
  const token = env.GITHUB_DISPATCH_TOKEN, repo = env.GITHUB_REPO;
  if (!token || !repo) return { ok: false, error: "The intake runner is not set up (GITHUB_DISPATCH_TOKEN and GITHUB_REPO are missing). Ask your developer." };
  const res = await _fetch(`https://api.github.com/repos/${repo}/actions/workflows/library-intake.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: env.GITHUB_REF || "main", inputs: { upload_id: uploadId, book_id: bookId, action } }),
  });
  if (res.status === 204) return { ok: true };
  return { ok: false, error: `Could not start the intake (GitHub answered ${res.status}). Ask your developer to check the runner settings.` };
}

// ---- uploads ---------------------------------------------------------------------------------------
export async function recordUpload(userId: string, u: { bookId: string; blobPath: string; fileName: string; sizeBytes: number }): Promise<Result> {
  if (!(await canUpload(userId))) return { ok: false, error: "Only faculty and administrators can upload books." };
  if (!validBookId(u.bookId)) return { ok: false, error: "Book id must be lowercase letters and digits, starting with a letter (e.g. sad, mis3000, mis4950)." };
  // Spec 22 decision 7: validBookId stays permissive, but a retired id is refused here rather than
  // silently reviving the book by uploading over it. Restoring is a deliberate act an admin takes.
  if (await isRetired(u.bookId)) return { ok: false, error: "This book is retired; restore it first." };
  if (!new RegExp(`^uploads/${u.bookId}/[^/]+\\.zip$`, "i").test(u.blobPath) || !u.fileName.toLowerCase().endsWith(".zip"))
    return { ok: false, error: "Upload a .zip of the book's folder." };
  if (u.sizeBytes < 1 || u.sizeBytes > 200 * 1024 * 1024)
    return { ok: false, error: "The book zip must be no larger than 200 MB." };
  const [row] = await db().insert(libraryUploads).values({ ...u, uploadedBy: userId, status: "checking" }).returning();
  const d = await dispatchIntake("check", row.id, u.bookId);
  if (!d.ok) await setStatus(row.id, "failed", { message: d.error });
  return { ok: true, id: row.id };
}

export async function listUploads(limit = 50) {
  return db().select({
    id: libraryUploads.id, bookId: libraryUploads.bookId, fileName: libraryUploads.fileName, sizeBytes: libraryUploads.sizeBytes,
    status: libraryUploads.status, registerVersion: libraryUploads.registerVersion, message: libraryUploads.message,
    createdAt: libraryUploads.createdAt, publishedAt: libraryUploads.publishedAt, uploadedBy: libraryUploads.uploadedBy,
    uploaderName: users.displayName,
  }).from(libraryUploads).innerJoin(users, eq(users.id, libraryUploads.uploadedBy))
    .where(isNull(libraryUploads.dismissedAt))
    .orderBy(desc(libraryUploads.createdAt)).limit(limit);
}

// ---- dismissing a record (Spec 22 §2) --------------------------------------------------------

/**
 * The statuses a record may be dismissed in: everything short of being in the library.
 *
 * A record whose book was added is history — it is the receipt for a book students may be reading
 * right now — so it is never dismissible (decision 5). `checking` and `publishing` are excluded too,
 * for a different reason: the intake is still running and about to write to that row.
 */
export const DISMISSIBLE: UploadStatus[] = ["failed", "stopped", "ready"];

export function mayDismiss(status: string) {
  return (DISMISSIBLE as string[]).includes(status);
}

/** The uploader or any admin (decision 5). */
export async function canDismiss(userId: string, upload: { uploadedBy: string }) {
  return upload.uploadedBy === userId || (await isAdmin(userId));
}

export async function dismissUpload(userId: string, id: string): Promise<Result> {
  const u = await getUpload(id);
  if (!u) return { ok: false, error: "That upload record no longer exists." };
  if (!(await canDismiss(userId, u))) {
    return { ok: false, error: "Only the person who uploaded it, or an administrator, can dismiss a record." };
  }
  if (u.dismissedAt) return { ok: true };                      // already hidden; not an error
  if (!mayDismiss(u.status)) {
    return { ok: false, error: u.status === "published"
      ? "That book is in the library, so its record is kept as history."
      : "The intake is still running on that upload. Wait for it to finish." };
  }
  await db().update(libraryUploads).set({ dismissedAt: new Date(), dismissedBy: userId })
    .where(eq(libraryUploads.id, id));
  return { ok: true };
}

/** How many records a bulk dismiss would hide, counted from the same rule that will hide them. */
export async function dismissableFor(userId: string) {
  const admin = await isAdmin(userId);
  const rows = await db().select({ id: libraryUploads.id, status: libraryUploads.status, uploadedBy: libraryUploads.uploadedBy })
    .from(libraryUploads).where(isNull(libraryUploads.dismissedAt));
  return rows.filter((r) => mayDismiss(r.status) && (admin || r.uploadedBy === userId)).map((r) => r.id);
}

/** Dismiss every record not yet added. The count shown first comes from `dismissableFor`. */
export async function dismissAllNotAdded(userId: string): Promise<Result & { count?: number }> {
  const ids = await dismissableFor(userId);
  if (!ids.length) return { ok: true, count: 0 };
  await db().update(libraryUploads).set({ dismissedAt: new Date(), dismissedBy: userId })
    .where(and(inArray(libraryUploads.id, ids), isNull(libraryUploads.dismissedAt)));
  return { ok: true, count: ids.length };
}

export async function getUpload(id: string) {
  return (await db().select().from(libraryUploads).where(eq(libraryUploads.id, id)).limit(1))[0] ?? null;
}

/** The uploader or an admin may add a checked book to the library. */
export async function canApprove(userId: string, upload: { uploadedBy: string }) {
  return upload.uploadedBy === userId || (await isAdmin(userId));
}

export async function approveUpload(userId: string, id: string): Promise<Result> {
  const u = await getUpload(id);
  if (!u) return { ok: false, error: "That upload no longer exists." };
  if (!(await canApprove(userId, u))) return { ok: false, error: "Only the person who uploaded this book, or an administrator, can add it to the library." };
  if (u.status !== "ready") return { ok: false, error: `This upload is ${u.status}; only a book whose check came back ready can be added.` };
  const [claimed] = await db().update(libraryUploads).set({ status: "publishing", publishedBy: userId, updatedAt: new Date(), message: null })
    .where(and(eq(libraryUploads.id, id), eq(libraryUploads.status, "ready"))).returning({ id: libraryUploads.id });
  if (!claimed) return { ok: false, error: "This upload is already being added to the library." };
  const d = await dispatchIntake("publish", id, u.bookId);
  if (!d.ok) { await setStatus(id, "ready", { message: d.error }); return { ok: false, error: d.error }; }
  return { ok: true, id };
}

// ---- written by the intake job (scripts/library-intake.ts) -----------------------------------------
export async function setStatus(id: string, status: UploadStatus,
  extra: { report?: string | null; registerVersion?: string | null; runUrl?: string | null; message?: string | null; publishedAt?: Date | null } = {}) {
  await db().update(libraryUploads).set({ status, ...extra, updatedAt: new Date() }).where(eq(libraryUploads.id, id));
}
