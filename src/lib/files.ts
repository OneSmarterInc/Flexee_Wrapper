import "server-only";
import { createWriteStream, createReadStream, existsSync, mkdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { filesDir } from "@/lib/paths";

/**
 * Assignment attachments and student submissions, on disk (Spec 28 commit 5).
 *
 * These were browser-direct uploads to Vercel Blob: the server issued a scoped one-time token and
 * the browser sent the bytes to Blob. On AWS they stream through the app to `FILES_DIR` on the data
 * volume instead. The authorisation is unchanged — `uploadPrefix()` and `downloadable()` in
 * `lib/assignments.ts` still decide everything — and so are the stored keys, which keep the shape
 * `submissions/<assignmentId>/<userId>/<name>` that the `blobPath` columns already hold.
 *
 * The body is streamed rather than buffered. `await req.formData()` would read a whole file into
 * memory before anything is written, which is tolerable for 50 MB and wrong for the 200 MB book zip
 * that commit 6 sends through the same path.
 */

/** The cap the app enforces. nginx's `client_max_body_size` must be set above this, or a person sees its 413 rather than our message. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The cap for a book zip (Spec 28 commit 6). Four times the attachment cap and the same number the
 * intake has always enforced, in `recordUpload` and again in `runJob`; the largest real book today
 * is 32 MB zipped, so this is headroom rather than a limit anyone meets.
 *
 * nginx gets `256m` on `/api/library/upload` and `64m` on `/api/files/upload` — per location, each
 * above the cap beside it, so an oversized file meets the message below instead of a bare 413.
 */
export const MAX_BOOK_BYTES = 200 * 1024 * 1024;

/**
 * Where a book zip lands: `uploads/<bookId>/<safe name>`.
 *
 * Under `FILES_DIR`, deliberately, and not under `CONTENT_DIR`. Vercel Blob held the zips and the
 * published books in one store, separated by the `live/` prefix; on a filesystem `CONTENT_DIR` *is*
 * the content root, so an `uploads/` directory inside it would be a sibling of the books — and
 * `listDirs("")` is how both `listBooks()` and `/admin/status` find books. The status check counts
 * every directory not starting with `_`, so it would have reported a book that is a folder of zips.
 *
 * Not `INTAKE_WORK_DIR` either: that is scratch the intake unpacks into and deletes, and the first
 * person freeing disk space will empty it. A zip has to survive from upload until the faculty member
 * approves the book, which can be days.
 *
 * The shape matches what `library_uploads.blobPath` already holds and what `recordUpload()` already
 * enforces — `^uploads/<bookId>/[^/]+\.zip$` — so no row changes meaning.
 */
export const bookUploadPrefix = (bookId: string) => `uploads/${bookId}/`;

/**
 * The absolute path of a stored file, or null if it is not there.
 *
 * For the intake, which hands the zip's path to `tools/safe_unzip.py` instead of reading it. A
 * 200 MB `download()` into a Uint8Array and a `writeFileSync` into the work directory is 200 MB of
 * memory in a worker with a modest `MemoryMax`, and 200 MB of a shared 28 GB disk, to produce a
 * second copy of a file that is already on that disk.
 */
export function uploadPath(key: string): string | null {
  let f: string;
  try { f = fullPath(key); } catch { return null; }
  return existsSync(f) && statSync(f).isFile() ? f : null;
}

export class UploadTooLarge extends Error {
  // Declared, not a constructor parameter property: this repository runs TypeScript through
  // --experimental-strip-types, which rejects `constructor(readonly limit: number)` outright.
  limit: number;
  constructor(limit: number) {
    super(`That file is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
    this.name = "UploadTooLarge";
    this.limit = limit;
  }
}

/**
 * A filename reduced to something safe to put on a disk, with a short random suffix.
 *
 * Two reasons for the suffix, and the second is the one that matters. It keeps a student from
 * silently replacing their own earlier file of the same name — `essay.pdf` submitted twice would
 * otherwise overwrite the copy an earlier submission row still points at. Vercel Blob was doing
 * this for us with `addRandomSuffix: true`, so dropping it would have been a quiet regression.
 *
 * Separators, dots and control characters go, because this string becomes a path segment. The stem
 * is capped so a pathological name cannot exhaust the filesystem's own limit once the suffix and
 * the prefix are added.
 */
export function safeFileName(raw: string): string {
  const base = (raw || "file").replace(/[\x00-\x1f\x7f]/g, "").split(/[\\/]/).pop() || "file";
  const ext = path.extname(base).slice(0, 12).replace(/[^A-Za-z0-9.]/g, "");
  const stem = path.basename(base, path.extname(base))
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")              // a leading dot would make it hidden, and ".." a traversal
    .slice(0, 80) || "file";
  return `${stem}-${randomBytes(4).toString("hex")}${ext}`;
}

/**
 * Refuse a key that could leave `FILES_DIR`. The same rule `safeKey()` applies to book content and
 * `fsOps()` applies to the intake's writes; stated again here because this one guards a different
 * root and these keys arrive from a request.
 */
export function safeFileKey(key: string): string {
  const parts = String(key).split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length) throw new Error(`unsafe file key: ${key}`);
  if (parts.some((p) => p === ".." || p.includes("\0") || p.includes("\\"))) {
    throw new Error(`unsafe file key: ${key}`);
  }
  return parts.join("/");
}

const fullPath = (key: string) => {
  const f = path.join(filesDir(), ...safeFileKey(key).split("/"));
  // Belt and braces, as in fsOps: the parts check should make this unreachable, and a symlink
  // inside the volume is the case it would not catch.
  if (!path.resolve(f).startsWith(path.resolve(filesDir()))) throw new Error(`unsafe file key: ${key}`);
  return f;
};

/**
 * Write a request body to `<prefix><safe name>` under `FILES_DIR`, and return what the caller
 * records in the database.
 *
 * The cap is enforced **while streaming**, by counting bytes, not by trusting `Content-Length` —
 * a header is a claim and the body is the fact. A file that goes over is deleted rather than left
 * as a truncated fragment someone might later serve.
 */
export async function saveUpload(
  prefix: string,
  rawName: string,
  body: ReadableStream<Uint8Array> | null,
  limit = MAX_UPLOAD_BYTES,
): Promise<{ blobPath: string; fileName: string; sizeBytes: number }> {
  if (!body) throw new Error("That upload had no content.");
  const key = safeFileKey(`${prefix}${safeFileName(rawName)}`);
  const dest = fullPath(key);
  mkdirSync(path.dirname(dest), { recursive: true });

  let written = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > limit) throw new UploadTooLarge(limit);
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(body.pipeThrough(count) as any), createWriteStream(dest));
  } catch (e) {
    // Never leave a partial file behind: a half-written PDF that a reader can download is worse
    // than no file, because nothing downstream knows it is incomplete.
    try { rmSync(dest, { force: true }); } catch { /* the error below is the one that matters */ }
    throw e;
  }
  // fileName is the name the person chose, kept for display and for the download's
  // Content-Disposition; blobPath is the sanitised key the bytes actually live under. They are
  // deliberately different, and conflating them is how a filename ends up in a path.
  return { blobPath: key, fileName: rawName, sizeBytes: written };
}

/** A stored file, for the download route. Null when it is not on the volume. */
export function openUpload(key: string): { stream: ReadableStream<Uint8Array>; sizeBytes: number } | null {
  let f: string;
  try { f = fullPath(key); } catch { return null; }
  if (!existsSync(f) || !statSync(f).isFile()) return null;
  return {
    stream: Readable.toWeb(createReadStream(f)) as ReadableStream<Uint8Array>,
    sizeBytes: statSync(f).size,
  };
}

/**
 * Remove a stored file, returning the bytes it freed, or null if it was not there.
 *
 * Used for one thing only (Spec 28 commit 7b): a book zip whose book has been published. It never
 * throws for an absent or unsafe key — a caller deleting a file after the work is done must not be
 * able to undo the work by failing.
 *
 * The book's own directory is removed when it empties, which keeps uploads/ from filling with
 * empty directories, one per book per version. rmdir refuses a directory that is not empty, so a
 * second upload of the same book in flight is never affected.
 */
export function deleteUpload(key: string): number | null {
  let f: string;
  try { f = fullPath(key); } catch { return null; }
  let freed: number;
  try {
    const st = statSync(f);
    if (!st.isFile()) return null;
    freed = st.size;
    rmSync(f, { force: true });
  } catch { return null; }
  // rmdirSync, not rmSync: rmSync on a directory without recursive throws EISDIR, and a caught
  // EISDIR that silently does nothing is how the first draft of fsOps left husks behind.
  try { rmdirSync(path.dirname(f)); } catch { /* not empty, or gone: either is fine */ }
  return freed;
}

/** Whether a stored file is still on the volume, without opening it. For diagnostics. */
export function uploadExists(key: string): boolean {
  try { const f = fullPath(key); return existsSync(f) && statSync(f).isFile(); } catch { return false; }
}
