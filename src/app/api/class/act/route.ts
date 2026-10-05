import { currentUser } from "@/lib/auth";
import { removeStudents, resendTo } from "@/lib/class-actions";
import { withdrawStudents, restoreStudents } from "@/lib/withdraw";

/**
 * One endpoint for the class list's bulk actions (Spec 19 §1).
 *
 * Every library it calls re-checks each id against the class, so **nothing from the page is
 * trusted**: a selection that carries an id from another class is refused whole, not filtered.
 * Admin-only actions are not here at all — they live on their own routes, so forcing this one
 * cannot reach them.
 */
const ACTIONS = ["resend", "withdraw", "restore", "remove"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const sectionId = typeof body?.sectionId === "string" ? body.sectionId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const ids: string[] = Array.isArray(body?.enrolmentIds)
    ? body.enrolmentIds.filter((x: unknown) => typeof x === "string") : [];
  if (!sectionId || !ids.length || !ACTIONS.includes(action as Action)) {
    return new Response("Bad request", { status: 400 });
  }
  const url = new URL(req.url);
  const baseUrl = `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("host") ?? url.host}`;

  if (action === "resend") {
    const r = await resendTo(user.id, sectionId, ids, baseUrl);
    return Response.json(r.ok
      ? { ok: true, message: summarise(r.sent, r.skipped, r.reasons) }
      : { ok: false, error: r.error });
  }
  if (action === "withdraw" || action === "restore") {
    const r = action === "withdraw"
      ? await withdrawStudents(user.id, sectionId, ids)
      : await restoreStudents(user.id, sectionId, ids);
    if (!r.ok) return Response.json({ ok: false, error: r.error });
    const verb = action === "withdraw" ? "Withdrew" : "Restored";
    return Response.json({
      ok: true,
      message: `${verb} ${r.changed} student${r.changed === 1 ? "" : "s"}` +
        (r.skipped ? `, ${r.skipped} already ${action === "withdraw" ? "withdrawn" : "active"}` : "") + ".",
    });
  }
  const r = await removeStudents(user.id, sectionId, ids, {
    confirm: typeof body?.confirm === "string" ? body.confirm : undefined,
  });
  return Response.json(r.ok
    ? { ok: true, message: `Removed ${r.removed} student${r.removed === 1 ? "" : "s"}.` }
    : { ok: false, error: r.error, needsTyping: !!r.needsTyping, phrase: r.expect });
}

/** "Sent 24, skipped 6: 4 already set up, 1 demo account, 1 withdrawn." */
function summarise(sent: number, skipped: number, reasons: Record<string, number>) {
  const why = Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ");
  return `Sent ${sent}${skipped ? `, skipped ${skipped}` : ""}${why ? `: ${why}` : ""}.`;
}
