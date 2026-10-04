import { currentUser } from "@/lib/auth";
import { parseClassList } from "@/lib/d2l";
import { canImport, previewImport, emailDomain } from "@/lib/d2l-import";

// The class list, read and counted. Nothing is written, and the text is not kept: it is parsed
// into rows, counted against the class, and dropped when this request ends.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const sectionId = typeof body?.sectionId === "string" ? body.sectionId : "";
  const csv = typeof body?.csv === "string" ? body.csv : "";
  if (!sectionId || !csv) return new Response("Bad request", { status: 400 });
  if (!(await canImport(user.id, sectionId))) return new Response("Forbidden", { status: 403 });
  const list = parseClassList(csv, { domain: emailDomain() });
  if (list.missing.length) {
    return Response.json({ ok: false, error: `That file has no ${list.missing.join(", ")} column.`, headers: list.headers }, { status: 200 });
  }
  return Response.json({ ok: true, preview: await previewImport(sectionId, list) });
}
