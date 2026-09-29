import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { uploadPrefix } from "@/lib/assignments";

// Issues one-time tokens for browser-to-Blob uploads of assignment attachments (faculty) and
// submission files (students). The token only allows the path this person is entitled to.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body, request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await currentUser();
        if (!user) throw new Error("Sign in again to upload.");
        let p: { purpose?: string; assignmentId?: string } = {};
        try { p = JSON.parse(clientPayload || "{}"); } catch { /* handled below */ }
        const purpose = p.purpose === "assignment" ? "assignment" : "submission";
        const prefix = p.assignmentId ? await uploadPrefix(user.id, purpose, p.assignmentId) : null;
        if (!prefix || !pathname.startsWith(prefix) || pathname.slice(prefix.length).includes("/")) {
          throw new Error("You cannot upload files here.");
        }
        return { maximumSizeInBytes: 50 * 1024 * 1024, addRandomSuffix: true };
      },
      onUploadCompleted: async () => { /* the form records its files when it is submitted */ },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
