import { currentUser } from "@/lib/auth";
import { withdrawStudents, restoreStudents } from "@/lib/withdraw";

/** Withdraw or restore (Spec 19 §1). Every id is re-checked against the class inside the library. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const sectionId = typeof body?.sectionId === "string" ? body.sectionId : "";
  const ids = Array.isArray(body?.enrolmentIds) ? body.enrolmentIds.filter((x: unknown) => typeof x === "string") : [];
  const restore = body?.restore === true;
  if (!sectionId || !ids.length) return new Response("Bad request", { status: 400 });
  const r = restore
    ? await restoreStudents(user.id, sectionId, ids)
    : await withdrawStudents(user.id, sectionId, ids);
  return Response.json(r.ok ? { ok: true, changed: r.changed, skipped: r.skipped } : { ok: false, error: r.error });
}
