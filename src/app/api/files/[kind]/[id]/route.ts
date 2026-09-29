import { currentUser } from "@/lib/auth";
import { downloadable } from "@/lib/assignments";

// Downloads an assignment attachment or a submission file, after checking this person may have it.
// Files are private blobs; their storage address never reaches the browser.
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  if (kind !== "assignment" && kind !== "submission") return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401 });
  const f = await downloadable(user.id, kind, id);
  if (!f) return new Response("Not found", { status: 404 });
  const { get } = await import("@vercel/blob");
  const r = await get(f.blobPath, { access: "private" });
  if (!r || !r.stream) return new Response("That file is no longer in storage.", { status: 410 });
  const name = f.fileName.replace(/[\r\n"]/g, "_");
  return new Response(r.stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
