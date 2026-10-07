import crypto from "node:crypto";

// The launch pass shared with the RapidSims (Flexee Systems Map, contract C2). The wire format is
// identical to Disaster_New/platform/lib/launch.js, so the sims verify the Wrapper's passes and the
// Wrapper verifies theirs with no code change on either side:
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(first part, LAUNCH_SECRET))
// A pass is rejected if its signature does not match (constant-time compare) or its `exp` has passed.

function secret(env = process.env) {
  const s = env.LAUNCH_SECRET;
  if (!s) { const e: any = new Error("LAUNCH_SECRET is not set"); e.code = "NO_SECRET"; throw e; }
  return s;
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function signPass(payload: Record<string, unknown>, env = process.env) {
  const body = b64(payload);
  return body + "." + crypto.createHmac("sha256", secret(env)).update(body).digest("base64url");
}

export function verifyPass(token: unknown, env = process.env): Record<string, any> | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  let expect: string;
  try { expect = crypto.createHmac("sha256", secret(env)).update(body).digest("base64url"); } catch { return null; }
  const a = Buffer.from(mac || ""), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p: any;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}

/** How long a pass lasts when the caller does not say. Contract change C2-1. */
export const PASS_MINUTES = 120;

/**
 * The pass a sim receives at launch. Two hours, so it outlives the longest sim (contract change
 * C2-1, 7 October 2026).
 *
 * The default has to outlive the longest sim, not the shortest, because every sim except 04
 * re-checks the pass before it reports completion — so a pass that expires mid-run loses the
 * student's result silently. At sixty minutes two sims were already over the line: RapidSim+ 01
 * declares 70 minutes and RapidSim+ 02 declares 65, and both run every request through a guard
 * that calls verifyLaunch, their final submit included.
 *
 * This is the one place the Wrapper's default differs from the old platform's launch.js, which
 * still says 60. The format is unchanged, so passes stay interchangeable: a sim reads `exp` and
 * does not care how it was chosen.
 */
export function launchPass(a: { userId: string; name: string; email?: string | null; role: "student" | "faculty" | "faculty_preview";
  simId: string; sectionId?: string | null; mode?: string; minutes?: number }, env = process.env) {
  const now = Date.now();
  return signPass({ sub: a.userId, name: a.name, email: a.email || null, role: a.role, sim: a.simId,
    mode: a.mode || "play", course: a.sectionId || null, iat: now, exp: now + (a.minutes ?? PASS_MINUTES) * 60000 }, env);
}
