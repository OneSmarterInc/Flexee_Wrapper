import { diagnosticBody, mayDiagnose, publicBody } from "@/lib/health";

/**
 * C2-2 v1.1 §5 step 1 — `learn.flexee.org` must answer `/api/health` **with no redirect** before
 * any sim's `PLATFORM_URL` is repointed at it.
 *
 * "With no redirect" is the whole requirement, and it is why this is a route handler at exactly
 * that path rather than anything cleverer. Three ways it could acquire a redirect, all avoided:
 * `trailingSlash` stays at its default (checked by test:external-paths, because it would also
 * break the roster call), there is no rewrite or alias for this path, and nothing here reads a
 * session or redirects to sign-in.
 *
 * It is also the Wrapper's only unauthenticated endpoint that answers 200 by design, so the public
 * body is deliberately boring: two fixed fields, the same for every deployment, revealing nothing
 * about configuration, build or state. Everything useful is behind `HEALTH_SECRET`.
 */

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store, max-age=0, must-revalidate", "content-type": "application/json; charset=utf-8" };

function answer(req: Request) {
  if (!mayDiagnose(req.headers.get("x-health-key"))) {
    return new Response(JSON.stringify(publicBody()), { status: 200, headers });
  }
  const url = new URL(req.url);
  const body = diagnosticBody(process.env, {
    proto: req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", ""),
    host: req.headers.get("host") ?? url.host,
  });
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export async function GET(req: Request) { return answer(req); }

// Monitors commonly use HEAD, and Next would otherwise answer it by running GET and discarding the
// body — which works, but spells it out here so the method list is deliberate.
export async function HEAD(req: Request) {
  const r = answer(req);
  return new Response(null, { status: r.status, headers: r.headers });
}

const wrongMethod = () =>
  new Response(JSON.stringify({ error: "GET only" }), { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
export const POST = wrongMethod;
export const PUT = wrongMethod;
export const PATCH = wrongMethod;
export const DELETE = wrongMethod;
