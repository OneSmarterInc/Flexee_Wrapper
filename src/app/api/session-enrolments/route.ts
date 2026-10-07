import { sessionRoster } from "@/lib/session-roster";

/**
 * C2-2 §2 — POST /api/session-enrolments, the class roster a sim's facilitator console reads.
 *
 * Unlike the Wrapper's other three sim endpoints, this one sends **no CORS headers** and has no
 * OPTIONS handler, because C2-2 says "No CORS needed": the call is made by the sim's server, not by
 * a browser, so there is no preflight to answer and no origin to allow. Adding the headers anyway
 * would widen it to any web page on the internet for no gain.
 *
 * It reads no cookie. The instructor's launch pass in `x-launch-token` is the only credential.
 *
 * It must not redirect, ever (C2-2 §1): the sims call it with `redirect: 'error'` and a four-second
 * timeout, so a 308 from a trailing-slash or host normalisation ends the call rather than following
 * it. That is a deployment property as much as a code one — see the change note.
 */

const NO_STORE = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: NO_STORE });

export async function POST(req: Request) {
  let body: any = {};
  try { const t = await req.text(); body = t ? JSON.parse(t) : {}; } catch { body = {}; }
  const r = await sessionRoster(req.headers.get("x-launch-token") ?? "", body?.courseId);
  return json(r.status, r.body);
}

// Any method other than POST is 405 (C2-2 §2). Spelled out rather than left to the framework's
// default, so the answer is the contract's and carries no-store like every other reply here.
const wrongMethod = () =>
  new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...NO_STORE, allow: "POST" } });
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const PATCH = wrongMethod;
export const DELETE = wrongMethod;
export const HEAD = wrongMethod;
