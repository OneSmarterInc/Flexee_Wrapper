import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b?.bookId || !b?.entryId) return new Response("Bad request", { status: 400 });
  const enr = await enrolmentForBook(user.id, b.bookId);
  if (!enr) return new Response("Not enrolled", { status: 403 });

  const scroll = Math.max(0, Math.min(1, Number(b.scroll) || 0));
  const chapterVersion = Number(b.chapterVersion) || 1;
  await db()
    .insert(bookmarks)
    .values({
      enrolmentId: enr.id, bookId: b.bookId, entryId: b.entryId,
      chapterVersion, sectionAnchor: b.sectionAnchor ?? null, scroll, updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [bookmarks.enrolmentId, bookmarks.bookId],
      set: { entryId: b.entryId, chapterVersion, sectionAnchor: b.sectionAnchor ?? null, scroll, updatedAt: new Date() },
    });
  return Response.json({ ok: true });
}
