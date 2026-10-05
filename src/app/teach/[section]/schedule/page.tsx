import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { listSchedule } from "@/lib/course";
import { addScheduleItemAction, deleteScheduleItemAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import { classPageTitle } from "@/lib/page-title";
export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ section: string }> }) =>
  classPageTitle("Schedule", params);

const field = { padding: ".5rem .6rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;

export default async function Schedule({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/schedule`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const items = await listSchedule(section);
  return (
    <main id="main" className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Schedule — what's due when</h1>
      <form action={addScheduleItemAction} className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "end", margin: "0 0 1.4rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input name="title" placeholder="Item (e.g. Read Chapter 3)" required style={{ ...field, flex: "2 1 14rem" }} />
        <label className="field-stack">Due<input name="dueAt" type="datetime-local" style={field} /></label>
        <label className="field-stack">Type<select name="kind" style={field}><option value="">type…</option><option>reading</option><option>exam</option><option>assignment</option><option>other</option></select></label>
        <button type="submit" className="nav-button primary">Add</button>
      </form>
      {items.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>Nothing scheduled yet.</p>}
      {items.length > 0 && (
        <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
          <thead><tr><th style={cell}>Due</th><th style={cell}>Item</th><th style={cell}>Type</th><th style={cell}><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td style={cell}>{i.dueAt ? new Date(i.dueAt).toLocaleString() : "—"}</td>
                <td style={cell}>{i.title}</td>
                <td style={cell}>{i.kind ?? ""}</td>
                <td style={cell}>
                  <form action={deleteScheduleItemAction}><input type="hidden" name="sectionId" value={section} /><input type="hidden" name="id" value={i.id} />
                    <button type="submit" style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", font: "inherit" }}>Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
