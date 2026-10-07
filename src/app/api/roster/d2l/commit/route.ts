import { currentUser } from "@/lib/auth";
import { parseClassList } from "@/lib/d2l";
import { canImport, commitImport, emailDomain } from "@/lib/d2l-import";
import { appUrl } from "@/lib/app-url";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const sectionId = typeof body?.sectionId === "string" ? body.sectionId : "";
  const csv = typeof body?.csv === "string" ? body.csv : "";
  const sendNow = body?.sendNow === true;
  if (!sectionId || !csv) return new Response("Bad request", { status: 400 });
  if (!(await canImport(user.id, sectionId))) return new Response("Forbidden", { status: 403 });
  const list = parseClassList(csv, { domain: emailDomain() });
  if (list.missing.length) return new Response("Bad request", { status: 400 });
  const url = new URL(req.url);
  const baseUrl = await appUrl(req);
  const result = await commitImport(sectionId, list, { sendNow, baseUrl });
  return Response.json({ ok: true, result });
}
