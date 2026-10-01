import crypto from "node:crypto";

// The launch pass shared with the RapidSims (Flexee Systems Map, contract C2). Identical to
// Disaster_New/platform/lib/launch.js, so the sims verify the Wrapper's passes and the Wrapper verifies
// theirs with no code change on either side:
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

/** The pass a sim receives at launch. Sixty minutes, so it outlives the longest sim. */
export function launchPass(a: { userId: string; name: string; email?: string | null; role: "student" | "faculty" | "faculty_preview";
  simId: string; sectionId?: string | null; mode?: string; minutes?: number }, env = process.env) {
  const now = Date.now();
  return signPass({ sub: a.userId, name: a.name, email: a.email || null, role: a.role, sim: a.simId,
    mode: a.mode || "play", course: a.sectionId || null, iat: now, exp: now + (a.minutes ?? 60) * 60000 }, env);
}
