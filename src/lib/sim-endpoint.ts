// Shared shape of the three endpoints the RapidSims call (register, complete, transcript): POST with a JSON
// body carrying the signed pass, open to any origin (sims post from their own servers and browsers),
// answering with the same JSON and status codes as the frozen RapidSims platform.
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function preflight() { return new Response(null, { status: 204, headers: cors }); }
export async function readBody(req: Request): Promise<any> {
  try { const t = await req.text(); return t ? JSON.parse(t) : {}; } catch { return {}; }
}
export function answer(r: { ok: boolean; error?: string; status?: number } & Record<string, unknown>) {
  if (r.ok) { const { ok, status, ...rest } = r; return Response.json({ ok: true, ...rest }, { status: 200, headers: cors }); }
  return Response.json({ error: r.error }, { status: r.status ?? 400, headers: cors });
}
export function failure(e: any) {
  if (e?.code === "NO_SECRET") return Response.json({ error: "no_secret" }, { status: 500, headers: cors });
  console.error("sim endpoint failure", e?.message);
  return Response.json({ error: "server_error" }, { status: 500, headers: cors });
}
