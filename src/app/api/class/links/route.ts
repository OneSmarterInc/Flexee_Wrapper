import { currentUser } from "@/lib/auth";
import { invitationLinks, linksCsv } from "@/lib/class-actions";

/**
 * Spec 19 §4: a CSV of fresh invitation links, generated on the fly and never stored.
 *
 * The file holds sign-in links, so it is served as an attachment with no-store, and nothing about
 * it is logged but the count. GET, because a browser has to be able to download it.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section") || "";
  if (!sectionId) return new Response("Bad request", { status: 400 });
  const ids = url.searchParams.getAll("enrolment").filter(Boolean);
  const baseUrl = `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("host") ?? url.host}`;
  const r = await invitationLinks(user.id, sectionId, baseUrl, { enrolmentIds: ids });
  if (!r.ok) return new Response(r.error, { status: 403 });
  return new Response(linksCsv(r.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${r.filename}"`,
      "cache-control": "no-store, max-age=0",
    },
  });
}
