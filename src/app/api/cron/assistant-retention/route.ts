import { sweepThreads } from "@/lib/assistant/store";

/**
 * Spec 20 §3: delete threads whose last message is older than ASSISTANT_RETENTION_DAYS (120 by
 * default). Vercel Cron calls this daily with `Authorization: Bearer $CRON_SECRET`; nothing else
 * can, and with no secret configured it refuses rather than running unguarded.
 *
 * It logs a count. Not a thread, not a class, not a student.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await sweepThreads();
  console.log(`[assistant] retention sweep: ${r.deleted} thread(s) older than ${r.retentionDays} days`);
  return Response.json({ ok: true, deleted: r.deleted, retentionDays: r.retentionDays });
}
