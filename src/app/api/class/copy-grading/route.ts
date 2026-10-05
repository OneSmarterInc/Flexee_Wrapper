import { currentUser } from "@/lib/auth";
import { previewCopy, copySetup } from "@/lib/grading-copy";

/** Spec 19 §3: preview a grading setup copy, then do it. GET previews; POST applies. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!from || !to) return new Response("Bad request", { status: 400 });
  const r = await previewCopy(user.id, from, to);
  return Response.json(r.ok ? { ok: true, preview: r.preview } : { ok: false, error: r.error });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to : "";
  if (!from || !to) return new Response("Bad request", { status: 400 });
  const r = await copySetup(user.id, from, to, { confirm: typeof body?.confirm === "string" ? body.confirm : undefined });
  return Response.json(r.ok
    ? { ok: true, categories: r.preview.categories.length, unmatched: r.preview.unmatched }
    : { ok: false, error: r.error });
}
