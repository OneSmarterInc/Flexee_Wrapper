import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { simsForClass, visibleSims, classCompletions } from "@/lib/sims";
import { formatLocal } from "@/lib/time";
import { simColumnsFor, categoriesFor, SIM_RULES, SIM_RULE_LABELS, isParticipation, type SimRule } from "@/lib/gradebook";
import { addClassSimAction, removeClassSimAction, setSimRuleAction, setSimPointsAction } from "@/app/sim-actions";
import LogoutButton from "@/components/LogoutButton";
import { classPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ section: string }> }) =>
  classPageTitle("Simulations", params);

const cell = { borderBottom: "1px solid var(--rule)", padding: ".4rem .6rem", textAlign: "left" } as const;
const mins = (s: number | null) => (s == null ? "" : `${Math.round(s / 60)} min`);
const field = { padding: ".35rem .45rem", border: "1px solid var(--field-border)", borderRadius: "5px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function ClassSims({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ section }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/sims`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [inClass, available, played, columns, cats] = await Promise.all([
    simsForClass(section, false), visibleSims(user!.id), classCompletions(user!.id, section),
    simColumnsFor(section), categoriesFor(section),
  ]);
  const hasSimsCategory = cats.some((c) => c.name.trim().toLowerCase() === "simulations");
  const addable = available.filter((s) => !inClass.some((c) => c.id === s.id));
  const title = new Map(available.concat(inClass).map((s) => [s.id, s.title]));
  const launch = (sim: string, extra = "") => `/sims/launch?sim=${encodeURIComponent(sim)}&section=${encodeURIComponent(section)}${extra}`;
  return (
    <main id="main" className="catalog" style={{ maxWidth: "56rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec!.name}</Link></p>
      <h1>Simulations</h1>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      {inClass.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>No simulations in this class yet.</p>}
      {inClass.map((s) => (
        <div key={s.id} className="book-card section-card">
          <div>
            <div className="t">{s.title}</div>
            <div className="s">{s.tagline ?? ""}{s.minutes ? ` · about ${s.minutes} minutes` : ""}{s.published ? "" : " · not yet published: students cannot see it"}</div>
          </div>
          <div className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            <a className="nav-button secondary" href={launch(s.id)}>Open it yourself</a>
            {s.published && <a className="nav-button secondary" href={launch(s.id, "&mode=session&play=team")}>Run a live session</a>}
            <form action={removeClassSimAction}><input type="hidden" name="sectionId" value={section} /><input type="hidden" name="simId" value={s.id} />
              <button className="nav-button ghost" type="submit">Remove</button></form>
          </div>
          {(() => {
            const col = columns.get(s.id);
            if (!col) return null;
            const rule = (col.scoreRule ?? "report") as SimRule;
            const participation = isParticipation(col);
            return (
              <div className="ui" style={{ gridColumn: "1 / -1", marginTop: ".7rem", paddingTop: ".7rem", borderTop: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "end" }}>
                  <form action={setSimRuleAction} style={{ display: "grid", gap: ".2rem" }}>
                    <input type="hidden" name="sectionId" value={section} />
                    <input type="hidden" name="lineItemId" value={col.id} />
                    <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>In the gradebook</span>
                    <span style={{ display: "flex", gap: ".3rem" }}>
                      <select name="rule" defaultValue={rule} style={{ ...field, width: "15rem" }}>
                        {SIM_RULES.map((r) => <option key={r} value={r}>{SIM_RULE_LABELS[r]}</option>)}
                      </select>
                      <button className="nav-button secondary" type="submit">Save</button>
                    </span>
                  </form>
                  {!participation && (
                    <form action={setSimPointsAction} style={{ display: "grid", gap: ".2rem" }}>
                      <input type="hidden" name="sectionId" value={section} />
                      <input type="hidden" name="lineItemId" value={col.id} />
                      <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>Points</span>
                      <span style={{ display: "flex", gap: ".3rem" }}>
                        <input name="points" type="number" min={1} defaultValue={col.maxPoints} style={{ ...field, width: "5rem" }} />
                        <button className="nav-button secondary" type="submit">Save</button>
                      </span>
                    </form>
                  )}
                  <Link className="nav-button ghost" href={`/teach/${section}/gradebook`}>Its gradebook column →</Link>
                </div>
                <p style={{ color: "var(--muted)", fontSize: ".8rem", margin: ".5rem 0 0" }}>
                  {participation
                    ? "A participation record: the gradebook shows who finished it, and it counts towards nothing."
                    : !col.categoryId
                      ? <>This is graded but belongs to no category, so <strong>it will not count towards the course grade until you move it</strong>
                          {hasSimsCategory ? " into Simulations" : ""}. <Link href={`/teach/${section}/gradebook#grading-setup`}>Open grading setup</Link>.</>
                      : <>Graded out of {col.maxPoints}, counting in its category. <Link href={`/teach/${section}/gradebook#grading-setup`}>Grading setup</Link>.</>}
                </p>
              </div>
            );
          })()}
        </div>
      ))}
      {addable.length > 0 && (
        <form action={addClassSimAction} className="ui" style={{ display: "flex", gap: ".5rem", margin: "1rem 0", flexWrap: "wrap" }}>
          <input type="hidden" name="sectionId" value={section} />
          <select name="simId" style={{ padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px" }}>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.title}{s.published ? "" : " (preview)"}</option>)}
          </select>
          <button className="nav-button primary" type="submit">Add to this class</button>
        </form>
      )}
      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Who has played</h2>
      {(played ?? []).length === 0 ? <p className="ui" style={{ color: "var(--muted)" }}>No completions yet.</p> : (
        <table className="ui" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={cell}>Student</th><th style={cell}>Simulation</th><th style={cell}>Finished</th><th style={cell}>Time</th><th style={cell}>Summary</th></tr></thead>
          <tbody>{played!.map((c) => (
            <tr key={c.id}><td style={cell}>{c.name}{c.isDemo && <span style={demoTag}>Demo</span>}</td><td style={cell}>{title.get(c.simId) ?? c.simId}</td><td style={cell}>{formatLocal(c.createdAt)}</td>
              <td style={cell}>{mins(c.durationSeconds)}</td><td style={cell}>{(c.summary ?? "").slice(0, 120)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </main>
  );
}
const demoTag = { marginLeft: ".4rem", padding: ".05rem .35rem", border: "1px solid var(--rule)", borderRadius: "4px", fontSize: ".7rem", color: "var(--muted)" } as const;
