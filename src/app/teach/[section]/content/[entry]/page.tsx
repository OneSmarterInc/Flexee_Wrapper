import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { sectionContentStatus, latestVersion, getVersion, diffVersions } from "@/lib/versions";
import { db } from "@/db";
import { sectionContentPins } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { publishToSectionAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ section: string; entry: string }> }) {
  const { section, entry } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/content/${entry}`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");

  const latest = await latestVersion(sec.bookId, entry);
  const pin = (await db().select().from(sectionContentPins)
    .where(and(eq(sectionContentPins.sectionId, section), eq(sectionContentPins.entryId, entry))).limit(1))[0];
  const pinned = pin ? await getVersion(pin.versionId) : null;
  if (!latest) redirect(`/teach/${section}/content`);
  const lines = pinned ? await diffVersions(pinned.id, latest.id) : [];

  return (
    <main className="catalog" style={{ maxWidth: "52rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}/content`}>← Content</Link></p>
      <h1>{latest.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Section reads {pinned ? `v${pinned.version}` : "the working copy"} · latest is v{latest.version}
        {latest.kind === "errata" ? " (errata)" : ""}
      </p>

      <pre className="ui" style={{ overflowX: "auto", border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem", fontSize: ".82rem", lineHeight: 1.5, background: "var(--panel)" }}>
        {lines.length === 0 ? "No textual differences." : lines.map((l, i) => (
          <div key={i} style={{
            background: l.type === "add" ? "rgba(46,160,67,.12)" : l.type === "del" ? "rgba(180,69,31,.12)" : "transparent",
            color: l.type === "ctx" ? "var(--muted)" : "var(--ink)", whiteSpace: "pre-wrap",
          }}>
            <span style={{ userSelect: "none", opacity: .6 }}>{l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}</span>{l.value}
          </div>
        ))}
      </pre>

      <form action={publishToSectionAction} style={{ marginTop: "1.2rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input type="hidden" name="entryId" value={entry} />
        <input type="hidden" name="versionId" value={latest.id} />
        <button type="submit" className="ui" style={{ padding: ".6rem 1rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" }}>
          Publish v{latest.version} to this section
        </button>
      </form>
    </main>
  );
}
