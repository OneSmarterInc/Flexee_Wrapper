import { currentUser } from "@/lib/auth";
import { ownedSection, commitRoster } from "@/lib/roster";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const sectionId = body?.sectionId as string | undefined;
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!sectionId || !rows) return new Response("Bad request", { status: 400 });
  if (!(await ownedSection(user.id, sectionId))) return new Response("Forbidden", { status: 403 });
  const clean = rows
    .map((r: any) => ({ email: String(r.email ?? "").trim(), name: r.name ? String(r.name).trim() : undefined }))
    .filter((r: any) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
  const result = await commitRoster(sectionId, clean);
  return Response.json({ ok: true, ...result });
}
