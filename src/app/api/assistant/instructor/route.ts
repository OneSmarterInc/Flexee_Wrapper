import { currentUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai";
import { askInstructor, threadFor } from "@/lib/assistant/store";

/** Spec 20 §5: the student hands this conversation to the class's faculty. */
export async function POST(req: Request) {
  if (!aiAvailable()) return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const threadId = typeof body?.threadId === "string" ? body.threadId : "";
  if (!threadId) return new Response("Bad request", { status: 400 });
  const t = await threadFor(user.id, threadId);
  if (!t || t.as !== "student") return new Response("Forbidden", { status: 403 });
  await askInstructor(threadId, t.sectionId, t.enrolmentId);
  return Response.json({ ok: true });
}
