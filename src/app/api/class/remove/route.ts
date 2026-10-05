import { currentUser } from "@/lib/auth";
import { removeStudents } from "@/lib/class-actions";

/**
 * Remove enrolments and the records that hang off them (Spec 19 §1).
 *
 * Every id is re-checked against the class inside `removeStudents`, so nothing the page sent is
 * trusted — and when attempts, submissions or scores exist, the typed phrase is checked here, on
 * the server, not in the browser.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const sectionId = typeof body?.sectionId === "string" ? body.sectionId : "";
  const ids = Array.isArray(body?.enrolmentIds) ? body.enrolmentIds.filter((x: unknown) => typeof x === "string") : [];
  if (!sectionId || !ids.length) return new Response("Bad request", { status: 400 });
  const r = await removeStudents(user.id, sectionId, ids, {
    confirm: typeof body?.confirm === "string" ? body.confirm : undefined,
  });
  // A refusal is an answer the dialog shows, not a failure to swallow.
  return Response.json(r.ok
    ? { ok: true, removed: r.removed }
    : { ok: false, error: r.error, needsTyping: !!r.needsTyping, phrase: r.expect });
}
