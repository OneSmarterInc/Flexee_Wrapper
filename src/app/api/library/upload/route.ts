import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { canUpload } from "@/lib/library";

// Issues a one-time token so the browser can send a book zip straight to private Blob storage
// (large files never pass through this server). Faculty and admins only; zips only.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body, request,
      onBeforeGenerateToken: async (pathname) => {
        const user = await currentUser();
        if (!user || !(await canUpload(user.id))) throw new Error("Only faculty and administrators can upload books.");
        if (!pathname.startsWith("uploads/") || !pathname.toLowerCase().endsWith(".zip")) throw new Error("Upload a .zip of the book's folder.");
        return {
          allowedContentTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => { /* the page records the upload itself (see library/actions.ts) */ },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
