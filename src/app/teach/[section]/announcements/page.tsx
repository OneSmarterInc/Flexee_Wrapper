import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { listAnnouncements } from "@/lib/course";
import { addAnnouncementAction, deleteAnnouncementAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
export const dynamic = "force-dynamic";
const field = { padding: ".55rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit", width: "100%" } as const;

export default async function Announcements({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/announcements`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const items = await listAnnouncements(section);
  return (
    <main className="catalog" style={{ maxWidth: "42rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Announcements</h1>
      <form action={addAnnouncementAction} className="ui" style={{ display: "grid", gap: ".5rem", margin: "0 0 1.5rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input name="title" placeholder="Title" required style={field} />
        <textarea name="body" placeholder="Message to the class" required rows={3} style={field} />
        <button type="submit" style={{ ...field, width: "fit-content", cursor: "pointer", background: "var(--navy)", color: "#fff", border: "none" }}>Post</button>
      </form>
      {items.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>No announcements yet.</p>}
      {items.map((a) => (
        <div key={a.id} className="book-card">
          <div className="t" style={{ fontSize: "1.05rem" }}>{a.title}</div>
          <div className="s ui" style={{ marginBottom: ".4rem" }}>{new Date(a.createdAt).toLocaleString()}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>
          <form action={deleteAnnouncementAction} style={{ marginTop: ".5rem" }}>
            <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="id" value={a.id} />
            <button type="submit" className="ui" style={{ border: "none", background: "transparent", color: "#b4451f", cursor: "pointer", font: "inherit" }}>Delete</button>
          </form>
        </div>
      ))}
    </main>
  );
}
