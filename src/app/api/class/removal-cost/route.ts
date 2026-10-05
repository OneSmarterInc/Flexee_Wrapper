import { currentUser } from "@/lib/auth";
import { canManageClass } from "@/lib/publish";
import { removalCost, describeCost, hasRecords, REMOVE_PHRASE } from "@/lib/class-actions";

/** What a removal would delete, counted from the tables the delete will reach (Spec 19 §1). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section") || "";
  const ids = url.searchParams.getAll("enrolment").filter(Boolean);
  if (!sectionId || !ids.length) return new Response("Bad request", { status: 400 });
  if (!(await canManageClass(user.id, sectionId))) return new Response("Forbidden", { status: 403 });
  const costs = await removalCost(sectionId, ids);
  if (costs.length !== ids.length) return new Response("Not in this class", { status: 404 });
  const total = costs.reduce((a, c) => ({
    attempts: a.attempts + c.attempts, submissions: a.submissions + c.submissions, scores: a.scores + c.scores,
    bookmarks: a.bookmarks + c.bookmarks, threads: a.threads + c.threads,
    simCompletions: a.simCompletions + c.simCompletions, simLaunches: a.simLaunches + c.simLaunches,
    simTranscripts: a.simTranscripts + c.simTranscripts,
  }), { attempts: 0, submissions: 0, scores: 0, bookmarks: 0, threads: 0, simCompletions: 0, simLaunches: 0, simTranscripts: 0 });
  return Response.json({
    ok: true, cost: total, sentence: describeCost(costs),
    needsTyping: costs.some(hasRecords), phrase: REMOVE_PHRASE,
  });
}
