import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { aolReport, reportMarkdown, reportCsv } from "@/lib/aol";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section") ?? "";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "md";
  const user = await currentUser();
  if (!user || !(await ownedSection(user.id, sectionId))) return new NextResponse("Not found", { status: 404 });
  const r = await aolReport(sectionId);
  const base = `AoL_${r.section.bookId}_${(r.section.term ?? "").replace(/\s+/g, "")}_${r.section.name.replace(/\s+/g, "")}`;
  const body = format === "csv" ? reportCsv(r) : reportMarkdown(r);
  return new NextResponse(body, { headers: {
    "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${base}.${format}"` } });
}
