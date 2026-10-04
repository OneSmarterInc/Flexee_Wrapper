import { currentUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai";
import { askAssistant } from "@/lib/assistant/service";

/**
 * The one endpoint a student's question goes through (Spec 20 rules 1, 2 and 5).
 *
 * It refuses before it reads anything when the global switch is off, which is what makes deploying
 * this change nothing: with `AI_ENABLED` unset there is no panel and no endpoint worth calling.
 *
 * Nothing here logs the question, the answer, or who asked.
 */
export async function POST(req: Request) {
  if (!aiAvailable()) return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const bookId = typeof body?.bookId === "string" ? body.bookId : "";
  const question = typeof body?.question === "string" ? body.question : "";
  if (!bookId || !question) return new Response("Bad request", { status: 400 });

  const r = await askAssistant({
    userId: user.id, bookId, question,
    threadId: typeof body?.threadId === "string" ? body.threadId : undefined,
    assignmentId: typeof body?.assignmentId === "string" ? body.assignmentId : undefined,
  });
  if (!r.ok) {
    // 200 with a reason: a refusal is an answer to show, not a failure to swallow.
    return Response.json({ ok: false, reason: r.reason, message: r.message });
  }
  return Response.json({
    ok: true, threadId: r.threadId,
    text: r.answer.text, citations: r.answer.citations, offerInstructor: r.answer.offerInstructor,
  });
}
