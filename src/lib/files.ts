import "server-only";
import { createWriteStream, createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
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
 * that arrives in the next commit through the same path.
 */

/** The cap the app enforces. nginx's `client_max_body_size` must be set above this, or a person sees its 413 rather than our message. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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

/** Whether a stored file is still on the volume, without opening it. For diagnostics. */
export function uploadExists(key: string): boolean {
  try { const f = fullPath(key); return existsSync(f) && statSync(f).isFile(); } catch { return false; }
}
