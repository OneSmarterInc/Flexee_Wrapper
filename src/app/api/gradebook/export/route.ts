import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { exportCsv, ExportBlocked } from "@/lib/gradebook";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section") || "";
  const format = url.searchParams.get("format") || "generic";
  if (!(await ownedSection(user.id, sectionId))) return new Response("Forbidden", { status: 403 });
  let csv: string;
  try {
    csv = await exportCsv(sectionId, format);
  } catch (e) {
    // Spec 18: a file D2L would silently half-apply is not written at all. The reason names the
    // students so faculty can put it right; it goes back to them, and is never logged.
    if (e instanceof ExportBlocked) {
      return new Response(e.message, { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    throw e;
  }
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gradebook-${sectionId}-${format}.csv"`,
    },
  });
}
