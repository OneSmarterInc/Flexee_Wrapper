import { currentUser } from "@/lib/auth";
import { downloadable } from "@/lib/assignments";

// Downloads an assignment attachment or a submission file, after checking this person may have it.
// The file lives on the data volume (Spec 28 commit 5, previously private Vercel Blob); its
// storage key never reaches the browser either way.
export const runtime = "nodejs";   // it streams from a filesystem
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  if (kind !== "assignment" && kind !== "submission") return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401 });
  // `downloadable()` is the whole of the authorisation and is unchanged: faculty who own the class,
  // or the student whose own submission it is.
  const f = await downloadable(user.id, kind, id);
  if (!f) return new Response("Not found", { status: 404 });
  const { openUpload } = await import("@/lib/files");
  const r = openUpload(f.blobPath);
  if (!r) return new Response("That file is no longer in storage.", { status: 410 });
  const name = f.fileName.replace(/[\r\n"]/g, "_");
  return new Response(r.stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(r.sizeBytes),
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
