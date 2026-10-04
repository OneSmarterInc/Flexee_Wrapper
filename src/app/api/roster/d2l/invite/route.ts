import { currentUser } from "@/lib/auth";
import { canImport, notSetUp, emailDomain } from "@/lib/d2l-import";
import { rateLimit, sendSetPasswordInvite, RESEND_MAX_PER_HOUR } from "@/lib/recovery";

/**
 * Spec 18 §2: emailing the invitations is its own step. The import creates the accounts; this is
 * the second click, and it is the same list the class page's "Resend to everyone not set up" uses,
 * so there is one definition of who gets an email. Demo enrolments are not in it.
 *
 * GET answers how many would be emailed, so the button can state the count and the domain before
 * anyone presses it. POST sends.
 */
async function guard(req: Request) {
  const user = await currentUser();
  if (!user) return { res: new Response("Unauthorized", { status: 401 }) };
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section") || "";
  if (!sectionId) return { res: new Response("Bad request", { status: 400 }) };
  if (!(await canImport(user.id, sectionId))) return { res: new Response("Forbidden", { status: 403 }) };
  return { sectionId };
}

export async function GET(req: Request) {
  const g = await guard(req);
  if (g.res) return g.res;
  return Response.json({ ok: true, count: (await notSetUp(g.sectionId!)).length, domain: emailDomain() });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g.res) return g.res;
  const sectionId = g.sectionId!;
  const url = new URL(req.url);
  const baseUrl = `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("host") ?? url.host}`;
  let sent = 0, failed = 0, limited = 0;
  let firstReason: string | null = null;
  // One failure never stops the rest: each student is invited on their own account.
  for (const s of await notSetUp(sectionId)) {
    if (!s.email) continue;
    if (!(await rateLimit(`invite:${s.userId}`, RESEND_MAX_PER_HOUR, 3600))) { limited++; continue; }
    const r = await sendSetPasswordInvite(s.userId, sectionId, s.email, baseUrl);
    if (r.ok) sent++;
    else { failed++; firstReason ??= r.error ?? "send failed"; }
  }
  return Response.json({ ok: true, sent, failed, limited, reason: firstReason });
}
