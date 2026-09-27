import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { exportCsv } from "@/lib/gradebook";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section") || "";
  const format = url.searchParams.get("format") || "generic";
  if (!(await ownedSection(user.id, sectionId))) return new Response("Forbidden", { status: 403 });
  const csv = await exportCsv(sectionId, format);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gradebook-${sectionId}-${format}.csv"`,
    },
  });
}
