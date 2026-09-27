import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { gradebook } from "@/lib/gradebook";
import { sectionHasLtiLink } from "@/lib/lti";
import { setWeightsAction, addLineItemAction, setScoreAction, pushGradesAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".4rem .55rem", textAlign: "left", whiteSpace: "nowrap" } as const;
const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
const field = { padding: ".3rem .4rem", border: "1px solid var(--rule)", borderRadius: "5px", background: "var(--panel)", color: "var(--ink)", font: "inherit", width: "4rem" } as const;

export default async function Gradebook({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ pushed?: string; skipped?: string; push_error?: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/gradebook`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const { items, students } = await gradebook(section);
  const [ltiLinked, spx] = await Promise.all([sectionHasLtiLink(section), searchParams]);

  return (
    <main className="catalog" style={{ maxWidth: "min(100%, 70rem)" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Gradebook</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Weighted total is the average of each column's percentage, weighted per column, over the items a student has been graded on. Exams appear automatically; add manual columns below.
      </p>

      {items.length === 0 ? <p className="ui" style={{ color: "var(--muted)" }}>No columns yet — create an exam or add a manual column.</p> : (
        <div style={{ overflowX: "auto" }}>
          <form action={setWeightsAction}>
            <input type="hidden" name="sectionId" value={section} />
            <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr>
                  <th style={cell}>Student</th>
                  {items.map((it) => <th key={it.id} style={num}>{it.title}<div style={{ fontWeight: 400, color: "var(--muted)" }}>/ {it.maxPoints} · {it.kind}</div></th>)}
                  <th style={num}>Total %</th>
                </tr>
                <tr>
                  <th style={{ ...cell, color: "var(--muted)", fontWeight: 400 }}>weight →</th>
                  {items.map((it) => <th key={it.id} style={num}><input name={`weight_${it.id}`} defaultValue={it.weight} style={field} type="number" min={0} step="0.5" /></th>)}
                  <th style={num}><button type="submit" style={{ ...field, width: "auto", cursor: "pointer", background: "var(--navy)", color: "#fff", border: "none" }}>Save</button></th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 && <tr><td style={cell} colSpan={items.length + 2}>No students enrolled yet.</td></tr>}
                {students.map((s) => (
                  <tr key={s.enrolmentId}>
                    <td style={cell}>{s.name}<div style={{ color: "var(--muted)", fontSize: ".78rem" }}>{s.email}</div></td>
                    {items.map((it) => {
                      const c = s.cells[it.id];
                      if (it.kind === "manual") return (
                        <td key={it.id} style={num}>
                          <form action={setScoreAction} style={{ display: "inline-flex", gap: ".2rem" }}>
                            <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="lineItemId" value={it.id} /><input type="hidden" name="enrolmentId" value={s.enrolmentId} />
                            <input name="points" defaultValue={c.points ?? ""} placeholder="—" style={{ ...field, width: "3.2rem" }} />
                          </form>
                        </td>
                      );
                      return <td key={it.id} style={num}>{c.points == null ? <span style={{ color: "var(--muted)" }}>—</span> : c.points}</td>;
                    })}
                    <td style={{ ...num, fontWeight: 600, color: "var(--navy)" }}>{s.total == null ? "—" : `${s.total}%`}<div style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".72rem" }}>{s.graded}/{items.length}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </form>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>Manual-column cells are editable inline (press Enter to save). Exam columns are the latest submitted attempt.</p>
        </div>
      )}

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Add a manual column</h2>
      <form action={addLineItemAction} className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input name="title" placeholder="Column title (e.g. Participation)" required style={{ ...field, width: "16rem" }} />
        <input name="maxPoints" type="number" min={1} defaultValue={100} style={field} title="Max points" />
        <input name="weight" type="number" min={0} step="0.5" defaultValue={1} style={field} title="Weight" />
        <button type="submit" style={{ ...field, width: "auto", cursor: "pointer", background: "var(--navy)", color: "#fff", border: "none" }}>Add</button>
      </form>

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Export</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        Download a CSV to import into your LMS. Confirm the exact shape against your institution's importer.
      </p>
      <div className="ui" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {["generic", "canvas", "d2l", "blackboard", "moodle"].map((f) => (
          <a key={f} href={`/api/gradebook/export?section=${section}&format=${f}`}>{f === "d2l" ? "Brightspace/D2L" : f[0].toUpperCase() + f.slice(1)} CSV</a>
        ))}
      </div>

      {ltiLinked && (
        <>
          <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Push grades to the LMS</h2>
          {spx.pushed && <p className="ui" style={{ color: "#2a7d3f" }}>Pushed {spx.pushed} score(s){spx.skipped && Number(spx.skipped) > 0 ? `, skipped ${spx.skipped} (no score or no LMS user)` : ""}.</p>}
          {spx.push_error && <p className="ui" style={{ color: "#b4451f" }}>{spx.push_error}</p>}
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>This section is linked to an LMS via LTI. Push creates a line item per column and sends each student's points.</p>
          <form action={pushGradesAction}><input type="hidden" name="sectionId" value={section} /><button type="submit" style={{ padding: ".55rem 1rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" }}>Push grades to LMS</button></form>
        </>
      )}
    </main>
  );
}
