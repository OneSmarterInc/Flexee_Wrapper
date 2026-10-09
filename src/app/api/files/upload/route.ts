import { currentUser } from "@/lib/auth";
import { uploadPrefix } from "@/lib/assignments";
import { saveUpload, UploadTooLarge, MAX_UPLOAD_BYTES } from "@/lib/files";

/**
 * Receives one assignment attachment or submission file and writes it under FILES_DIR
 * (Spec 28 commit 5).
 *
 * This replaced a Vercel Blob token issuer. `handleUpload` from `@vercel/blob/client` minted a
 * one-time token and the browser sent the bytes straight to Blob; now the bytes come here. **The
 * authorisation is the same `uploadPrefix()` call it always was** — that function decides whether
 * this person may write under this assignment at all, and the prefix it returns is the only place
 * a file can land. The old route also checked that the client's pathname stayed inside the prefix
 * and had no further slash; that is now `saveUpload`'s job, which builds the key itself from the
 * prefix and a sanitised name rather than accepting a path from the caller.
 *
 * The file arrives as the **raw request body**, with its name in the query string, rather than as
 * multipart. `await req.formData()` would read the whole thing into memory before a byte reached
 * the disk, which is tolerable at 50 MB and wrong for the 200 MB book zip that will use this same
 * path in the next commit.
 */

export const runtime = "nodejs";     // it streams to a filesystem; never the edge runtime
export const dynamic = "force-dynamic";

const bad = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const purpose = q.get("purpose") === "assignment" ? "assignment" : "submission";
  const assignmentId = q.get("assignmentId") ?? "";
  const name = q.get("name") ?? "";
  if (!assignmentId || !name) return bad(400, "That upload was missing its assignment or its name.");

  const user = await currentUser();
  if (!user) return bad(401, "Sign in again to upload.");

  // The whole of the authorisation, unchanged: faculty may write an attachment to an assignment
  // they own; a student may write a submission only to a published assignment in a class they are
  // in, and only under their own user id. `purpose` is the client's claim; this is what decides.
  const prefix = await uploadPrefix(user.id, purpose, assignmentId);
  if (!prefix) return bad(403, "You cannot upload files here.");

  try {
    const saved = await saveUpload(prefix, name, req.body);
    return Response.json(saved, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof UploadTooLarge) return bad(413, e.message);
    // Never the message: it can carry a filesystem path.
    console.error("file upload failed", (e as { code?: string })?.code ?? "write_error");
    return bad(500, "That file could not be saved. Try again.");
  }
}

/** The cap, so the client can refuse an oversized file before spending a minute uploading it. */
export async function GET() {
  return Response.json({ maxBytes: MAX_UPLOAD_BYTES }, { headers: { "cache-control": "no-store" } });
}
