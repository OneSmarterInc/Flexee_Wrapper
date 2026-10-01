import { currentUser } from "@/lib/auth";
import { prepareLaunch } from "@/lib/sims";

// /sims/launch?sim=<id>&section=<class id>[&mode=session&play=team|individual&session=<code>]
// Checks the person may launch this sim in this class, records the launch, and sends them to the sim
// with the signed pass in the address fragment (#lt=…), which browsers never send to a server.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const sim = q.get("sim") ?? "", section = q.get("section") ?? "";
  const user = await currentUser();
  if (!user) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/sims/launch?${q}`)}`, req.url), 302);
  try {
    const r = await prepareLaunch(user.id, sim, section, {
      mode: q.get("mode") === "session" ? "session" : "play", play: q.get("play") ?? undefined, session: q.get("session") ?? undefined,
    });
    if (!r.ok) return new Response(r.error, { status: r.status ?? 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(null, { status: 302, headers: { Location: r.url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (e: any) {
    if (e?.code === "NO_SECRET") return new Response("This site has no launch secret set, so it cannot hand you over to a simulation.", { status: 500 });
    throw e;
  }
}
