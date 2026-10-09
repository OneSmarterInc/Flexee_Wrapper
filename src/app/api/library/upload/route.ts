import { currentUser } from "@/lib/auth";
import { canUpload, validBookId } from "@/lib/library";
import { saveUpload, UploadTooLarge, MAX_BOOK_BYTES, bookUploadPrefix } from "@/lib/files";

/**
 * Receives a book's zip and writes it to `uploads/<bookId>/` under `FILES_DIR` (Spec 28 commit 6).
 *
 * This replaced a Vercel Blob token issuer. `handleUpload` from `@vercel/blob/client` minted a
 * one-time token and the browser sent 30-odd MB straight to Blob, which was the point: large files
 * never passed through the server. On the box they do, through the same streaming path commit 5
 * built for attachments, so nothing is held in memory and nginx needs `client_max_body_size 256m`
 * on this location.
 *
 * The gate is the same `canUpload()` it always was. What changed is that the client no longer names
 * the path: it sends a book id and a filename, and the prefix comes from `bookUploadPrefix()` here.
 * The old route checked that a client-supplied pathname started with `uploads/` and ended `.zip`,
 * which is a weaker thing to be able to check.
 *
 * The row is still written by `registerUploadAction` from the page, exactly as before, so the
 * intake is still started by `recordUpload()` — and `recordUpload()` re-checks `canUpload`, the
 * book id, the retired list, the `^uploads/<bookId>/[^/]+\.zip$` shape and the 200 MB cap against
 * what the browser then reports. Writing the row here instead would be a larger change than this
 * commit is, and would move the intake's start away from the place every other caller uses.
 */

export const runtime = "nodejs";     // it streams to a filesystem; never the edge runtime
export const dynamic = "force-dynamic";

const bad = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const bookId = (q.get("bookId") ?? "").trim().toLowerCase();
  const name = q.get("name") ?? "";
  if (!validBookId(bookId)) {
    return bad(400, "Book id: lowercase letters and digits, starting with a letter (e.g. mis4950).");
  }
  if (!/\.zip$/i.test(name)) return bad(400, "Upload a .zip of the book's folder.");

  const user = await currentUser();
  if (!user) return bad(401, "Sign in again to upload.");
  // The whole of the authorisation, unchanged from the Blob version: faculty and administrators.
  if (!(await canUpload(user.id))) return bad(403, "Only faculty and administrators can upload books.");

  try {
    const saved = await saveUpload(bookUploadPrefix(bookId), name, req.body, MAX_BOOK_BYTES);
    return Response.json(saved, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof UploadTooLarge) return bad(413, e.message);
    // Never the message: it can carry a filesystem path.
    console.error("book upload failed", (e as { code?: string })?.code ?? "write_error");
    return bad(500, "That file could not be saved. Try again.");
  }
}

/** The cap, so the form can refuse an oversized zip before spending ten minutes uploading it. */
export async function GET() {
  return Response.json({ maxBytes: MAX_BOOK_BYTES }, { headers: { "cache-control": "no-store" } });
}
