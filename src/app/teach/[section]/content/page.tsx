import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { sectionContentStatus } from "@/lib/versions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;

export default async function ContentPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/content`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const status = await sectionContentStatus(section, sec.bookId);
  const updates = status.filter((s) => s.hasUpdate).length;

  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Content</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        This section reads a pinned version of each entry. {updates ? `${updates} update${updates === 1 ? "" : "s"} available.` : "Up to date."}
      </p>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Entry</th><th style={cell}>Reading</th><th style={cell}>Latest</th><th style={cell}></th></tr></thead>
        <tbody>
          {status.map((s) => (
            <tr key={s.entryId} style={s.hasUpdate ? { background: "var(--mark)" } : undefined}>
              <td style={cell}>{s.title}</td>
              <td style={cell}>{s.pinnedVersion != null ? `v${s.pinnedVersion}` : "—"}</td>
              <td style={cell}>{s.latestVersion != null ? `v${s.latestVersion}${s.latestKind === "errata" ? " (errata)" : ""}` : "—"}</td>
              <td style={cell}>
                {s.hasUpdate
                  ? <Link href={`/teach/${section}/content/${s.entryId}`}>Review &amp; publish →</Link>
                  : <span style={{ color: "var(--muted)" }}>current</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem", fontSize: ".85rem" }}>
        Errata are pushed automatically. Feature upgrades wait here for your review.
      </p>
    </main>
  );
}
