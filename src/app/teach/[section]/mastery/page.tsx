import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { classMastery, studentMastery, outcomeRollup } from "@/lib/mastery";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".4rem .6rem", textAlign: "left" } as const;
const pctColor = (p: number | null) => p == null ? "var(--muted)" : p >= 75 ? "var(--ok)" : p >= 50 ? "var(--ink)" : "var(--danger)";

export default async function Mastery({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/mastery`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [cls, byStudent, rollup] = await Promise.all([classMastery(section, sec.bookId), studentMastery(section, sec.bookId), outcomeRollup(section, sec.bookId)]);
  const anyData = cls.some((c) => c.pct != null);

  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Mastery of learning</h1>
      {!anyData && <p className="ui" style={{ color: "var(--muted)" }}>No graded responses yet. Mastery fills in as students submit exams whose questions carry objectives.</p>}

      <h2 style={{ color: "var(--navy)" }}>By objective (class)</h2>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Ch</th><th style={cell}>Objective</th><th style={cell}>Class mastery</th></tr></thead>
        <tbody>
          {cls.map((o) => (
            <tr key={o.id} style={o.pct != null && o.pct < 50 ? { background: "var(--mark)" } : undefined}>
              <td style={cell}>{o.chapter}</td>
              <td style={cell}>{o.label}</td>
              <td style={{ ...cell, color: pctColor(o.pct), fontVariantNumeric: "tabular-nums" }}>{o.pct == null ? "—" : `${o.pct}% (${o.correct}/${o.served})`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {byStudent.students.length > 0 && (
        <>
          <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>By student × objective</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead><tr><th style={cell}>Student</th>{byStudent.objectives.map((o) => <th key={o.id} style={cell} title={o.label}>{o.code ?? o.id.slice(-2)}</th>)}</tr></thead>
              <tbody>
                {byStudent.students.map((s, i) => (
                  <tr key={i}><td style={cell}>{s.name}{s.isDemo && <span style={demoTag}>Demo</span>}</td>{s.cells.map((c, j) => <td key={j} style={{ ...cell, textAlign: "center", color: pctColor(c) }}>{c == null ? "—" : `${c}%`}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>Columns are objective codes; hover a header for the full statement.</p>
        </>
      )}

      {rollup.length > 0 && (
        <>
          <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>By syllabus outcome</h2>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>Objective mastery rolled up to this section's outcomes (<Link href={`/teach/${section}/syllabus`}>edit mapping</Link>).</p>
          <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead><tr><th style={cell}>Outcome</th><th style={cell}>Objectives</th><th style={cell}>Mastery</th></tr></thead>
            <tbody>{rollup.map((r, i) => <tr key={i}><td style={cell}>{r.code} — {r.description}</td><td style={cell}>{r.objectiveCount}</td><td style={{ ...cell, color: pctColor(r.pct) }}>{r.pct == null ? "—" : `${r.pct}%`}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </main>
  );
}
const demoTag = { marginLeft: ".4rem", padding: ".05rem .35rem", border: "1px solid var(--rule)", borderRadius: "4px", fontSize: ".7rem", color: "var(--muted)" } as const;
