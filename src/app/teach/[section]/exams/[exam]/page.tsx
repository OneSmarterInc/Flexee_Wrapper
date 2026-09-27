import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { examById, examResults } from "@/lib/assessment";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;

export default async function ExamResults({ params }: { params: Promise<{ section: string; exam: string }> }) {
  const { section, exam } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/exams/${exam}`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const e = await examById(exam);
  if (!e || e.sectionId !== section) redirect(`/teach/${section}/exams`);
  const { students, items } = await examResults(exam);
  const avg = students.length ? Math.round((students.reduce((s, x) => s + (x.score ?? 0), 0) / students.length) * 10) / 10 : null;

  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}/exams`}>← Exams</Link></p>
      <h1>{e.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Status {e.status} · {students.length} submitted{avg != null ? ` · average ${avg}` : ""}</p>

      <h2 style={{ color: "var(--navy)" }}>Scores</h2>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Student</th><th style={cell}>Email</th><th style={cell}>Score</th></tr></thead>
        <tbody>
          {students.length === 0 && <tr><td style={cell} colSpan={3}>No submissions yet.</td></tr>}
          {students.map((s, i) => <tr key={i}><td style={cell}>{s.name}</td><td style={cell}>{s.email}</td><td style={cell}>{s.score}/{s.maxPoints}</td></tr>)}
        </tbody>
      </table>

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Item analysis</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>Hardest items first — where the class struggled.</p>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
        <thead><tr><th style={cell}>Question</th><th style={cell}>Correct</th></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td style={cell} colSpan={2}>No responses yet.</td></tr>}
          {items.map((it) => (
            <tr key={it.questionId} style={it.pct < 50 ? { background: "var(--mark)" } : undefined}>
              <td style={cell}>{it.stem.slice(0, 90)}{it.stem.length > 90 ? "…" : ""}</td>
              <td style={cell}>{it.correct}/{it.served} ({it.pct}%)</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
