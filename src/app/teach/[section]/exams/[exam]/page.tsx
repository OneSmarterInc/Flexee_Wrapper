import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { examById, examResults, COUNTED_ATTEMPT_RULES, COUNTED_ATTEMPT_LABELS } from "@/lib/assessment";
import { attemptsForStudent } from "@/lib/gradebook";
import { show, type CountedAttempt } from "@/lib/grading";
import { formatLocal } from "@/lib/time";
import { setExamRulesAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;
const field = { padding: ".35rem .45rem", border: "1px solid var(--field-border)", borderRadius: "5px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function ExamResults({ params, searchParams }: { params: Promise<{ section: string; exam: string }>; searchParams: Promise<{ ok?: string; error?: string; student?: string }> }) {
  const [{ section, exam }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/exams/${exam}`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const e = await examById(exam);
  if (!e || e.sectionId !== section) redirect(`/teach/${section}/exams`);
  const { students, items } = await examResults(exam);
  const rule = (e.countedAttempt ?? "latest") as CountedAttempt;
  // one row per student now, so this is a class average and not an average of attempts
  const scored = students.filter((s) => s.score != null);
  const avg = scored.length ? scored.reduce((s, x) => s + (x.score as number), 0) / scored.length : null;
  const retakeable = e.attemptLimit > 1;

  // the attempts of one student, when faculty open a row
  const chosen = sp.student ? students.find((s) => s.enrolmentId === sp.student) : undefined;
  const detail = chosen ? await attemptsForStudent(exam, chosen.enrolmentId, rule) : null;

  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}/exams`}>← Exams</Link></p>
      <h1>{e.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        {e.kind === "quiz" ? "Quiz" : "Exam"} · status {e.status} · {students.length} submitted
        {avg != null ? ` · average ${show(avg)}` : ""}
      </p>

      <h2 style={{ color: "var(--navy)" }}>Retake rules</h2>
      {sp.ok && <p className="ui" style={{ color: "var(--ok)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }} role="alert">{sp.error}</p>}
      <form action={setExamRulesAction} className="ui" style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input type="hidden" name="examId" value={exam} />
        <label style={{ display: "grid", gap: ".2rem" }}>
          <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>This is a</span>
          <select name="kind" defaultValue={e.kind} style={{ ...field, width: "7rem" }}>
            <option value="exam">Exam</option>
            <option value="quiz">Quiz</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: ".2rem" }}>
          <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>Attempts allowed</span>
          <input name="attemptLimit" type="number" min={1} defaultValue={e.attemptLimit} style={{ ...field, width: "6rem" }} />
        </label>
        <label style={{ display: "grid", gap: ".2rem" }}>
          <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>Which attempt counts</span>
          <select name="countedAttempt" defaultValue={rule} style={{ ...field, width: "13rem" }}>
            {COUNTED_ATTEMPT_RULES.map((r) => <option key={r} value={r}>{COUNTED_ATTEMPT_LABELS[r]}</option>)}
          </select>
        </label>
        <button type="submit" className="nav-button primary">Save</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".82rem" }}>
        Changing which attempt counts recomputes the gradebook from the attempts already on record — no attempt is ever deleted.
        Lowering the number allowed below what a student has already used keeps their attempts; it only stops new ones.
      </p>

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Scores</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        One row per student, showing the score that counts under “{COUNTED_ATTEMPT_LABELS[rule]}”.
      </p>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Student</th><th style={cell}>Email</th><th style={cell}>Counts</th>{retakeable && <th style={cell}>Attempts</th>}</tr></thead>
        <tbody>
          {students.length === 0 && <tr><td style={cell} colSpan={retakeable ? 4 : 3}>No submissions yet.</td></tr>}
          {students.map((s) => (
            <tr key={s.enrolmentId} style={chosen?.enrolmentId === s.enrolmentId ? { background: "var(--mark)" } : undefined}>
              <td style={cell}>{s.name}</td>
              <td style={cell}>{s.email}</td>
              <td style={cell}>{s.score == null ? "—" : `${show(s.score)}/${s.maxPoints}`}</td>
              {retakeable && (
                <td style={cell}>
                  {s.attempts > 1
                    ? <Link href={`/teach/${section}/exams/${exam}?student=${s.enrolmentId}`}>{s.attempts} attempts →</Link>
                    : <span style={{ color: "var(--muted)" }}>1</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {chosen && detail && (
        <>
          <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>{chosen.name}&apos;s attempts</h2>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
            Every attempt is kept. The one that counts under “{COUNTED_ATTEMPT_LABELS[rule]}” is marked.
            {rule === "average" && " An average is computed across all of them, so no single attempt is marked."}
          </p>
          <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead><tr><th style={cell}>#</th><th style={cell}>Submitted</th><th style={cell}>Score</th><th style={cell}>Counts</th></tr></thead>
            <tbody>
              {detail.attempts.map((a, i) => (
                <tr key={a.id} style={a.id === detail.countedId ? { background: "var(--mark)" } : undefined}>
                  <td style={cell}>{i + 1}</td>
                  <td style={cell}>{a.submittedAt ? formatLocal(a.submittedAt) : <span style={{ color: "var(--muted)" }}>in progress</span>}</td>
                  <td style={cell}>{a.score == null ? "—" : `${a.score}/${a.maxPoints}`}</td>
                  <td style={cell}>{a.id === detail.countedId ? <strong>counts</strong> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ui" style={{ marginTop: ".5rem" }}>
            Counted score: <strong>{detail.counted ? `${show(detail.counted.score)}/${show(detail.counted.maxPoints)}` : "—"}</strong>
            {" · "}<Link href={`/teach/${section}/exams/${exam}`}>close</Link>
          </p>
        </>
      )}

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
