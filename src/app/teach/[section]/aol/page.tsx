import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { aolConfig, aolReport, getSettings, listPrograms, programOutcomesFor } from "@/lib/aol";
import { saveAolSettingsAction, toggleProgramMapAction, setEvidenceAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
export const dynamic = "force-dynamic";
const field = { padding: ".4rem .5rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const cell = { border: "1px solid var(--rule)", padding: ".35rem .55rem", textAlign: "left", verticalAlign: "top" } as const;
const small = { border: "none", background: "transparent", cursor: "pointer", font: "inherit", padding: 0 } as const;

export default async function Aol({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/aol`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [settings, programs, cfg, report] = await Promise.all([getSettings(section), listPrograms(), aolConfig(section), aolReport(section)]);
  const pos = settings.program ? await programOutcomesFor(settings.program) : [];
  const manual = cfg.lineItems.filter((l) => l.kind === "manual");
  return (
    <main className="catalog" style={{ maxWidth: "58rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link> · <Link href={`/teach/${section}/syllabus`}>Syllabus outcomes</Link></p>
      <h1>Assurance of learning</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Course outcomes come from the syllabus page. Here you set the benchmark, say which program outcomes each course outcome serves, and which gradebook columns (simulation, graded work) count as evidence.</p>

      <h2 style={{ color: "var(--navy)" }}>Benchmark</h2>
      <form action={saveAolSettingsAction} className="ui" style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="sectionId" value={section} />
        <label>Program<br /><select name="program" defaultValue={settings.program ?? ""} style={field}><option value="">—</option>{programs.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Meets at %<br /><input name="meetsPct" type="number" defaultValue={settings.meetsPct} style={{ ...field, width: "5rem" }} /></label>
        <label>Exceeds at %<br /><input name="exceedsPct" type="number" defaultValue={settings.exceedsPct} style={{ ...field, width: "5rem" }} /></label>
        <label>Target share %<br /><input name="targetPct" type="number" defaultValue={settings.targetPct} style={{ ...field, width: "5rem" }} /></label>
        <label>Minimum n<br /><input name="minN" type="number" defaultValue={settings.minN} style={{ ...field, width: "4.5rem" }} /></label>
        <button type="submit" className="nav-button primary">Save</button>
      </form>

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Mapping</h2>
      {cfg.outcomes.length === 0 && <p className="ui">No course outcomes yet — add them on the syllabus page first.</p>}
      {cfg.outcomes.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem", width: "100%" }}>
            <thead><tr><th style={cell}>Course outcome</th>{pos.map((p) => <th key={p.id} style={cell} title={p.label}>{p.code}</th>)}<th style={cell}>Evidence columns</th></tr></thead>
            <tbody>{cfg.outcomes.map((o) => (
              <tr key={o.id}>
                <td style={cell}><strong>{o.code}</strong> {o.description}<div style={{ color: "var(--muted)" }}>{o.objectiveIds.length} book objectives</div></td>
                {pos.map((p) => { const on = o.programOutcomeIds.includes(p.id); return (
                  <td key={p.id} style={{ ...cell, textAlign: "center" }}>
                    <form action={toggleProgramMapAction}><input type="hidden" name="sectionId" value={section} /><input type="hidden" name="outcomeId" value={o.id} /><input type="hidden" name="programOutcomeId" value={p.id} /><input type="hidden" name="on" value={on ? "0" : "1"} />
                      <button type="submit" style={small} title={on ? "Remove" : "Add"}>{on ? "●" : "○"}</button></form>
                  </td>); })}
                <td style={cell}>{manual.map((l) => { const ev = o.evidence.find((e) => e.lineItemId === l.id); return (
                  <form key={l.id} action={setEvidenceAction} style={{ display: "flex", gap: ".3rem", alignItems: "center" }}>
                    <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="outcomeId" value={o.id} /><input type="hidden" name="lineItemId" value={l.id} />
                    <span style={{ minWidth: "8rem" }}>{l.title}</span>
                    <select name="evidenceType" defaultValue={ev?.evidenceType ?? ""} style={field}><option value="">not evidence</option><option value="simulation">simulation</option><option value="graded work">graded work</option></select>
                    <button type="submit" style={small}>set</button>
                  </form>); })}{!manual.length && <span style={{ color: "var(--muted)" }}>No manual gradebook columns</span>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Report</h2>
      <p className="ui"><a href={`/api/aol/report?section=${section}&format=md`}>Download report (Markdown)</a> · <a href={`/api/aol/report?section=${section}&format=csv`}>Download data (CSV)</a></p>
      {report.courseOutcomes.map((o) => (
        <div key={o.id} className="book-card ui">
          <div className="t" style={{ fontSize: "1rem" }}>{o.code} — {o.description}</div>
          {!o.measures.length ? <div className="s">No evidence mapped.</div> : (o.measures.length > 1 && o.combined ? [...o.measures, o.combined] : o.measures).map((m, i) => (
            <div key={i} className="s">{m.label}: {m.n} assessed{m.tooFew ? " (too few)" : ""} · {m.shareMeeting ?? "—"}% meeting · benchmark {m.benchmarkMet == null ? "—" : m.benchmarkMet ? "met" : "not met"}</div>))}
        </div>
      ))}
      {report.programResults.length > 0 && (
        <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem", width: "100%", marginTop: "1rem" }}>
          <thead><tr><th style={cell}>Program outcome</th><th style={cell}>Contributing</th><th style={cell}>Status</th></tr></thead>
          <tbody>{report.programResults.map((p) => (
            <tr key={p.id}><td style={cell}>{p.code}. {p.label}</td><td style={cell}>{p.contributing.map((c) => `${c.code} (${c.shareMeeting ?? "—"}%)`).join("; ") || "—"}</td><td style={cell}>{p.status}</td></tr>))}</tbody>
        </table>
      )}
    </main>
  );
}
