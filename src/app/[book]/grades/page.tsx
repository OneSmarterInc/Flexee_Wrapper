import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBookAnyState } from "@/lib/enrolment";
import { gradesForStudent } from "@/lib/gradebook";
import { show } from "@/lib/grading";
import { formatLocal } from "@/lib/time";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import { WITHDRAWN_NOTICE } from "@/lib/withdraw";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;
const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

export default async function MyGrades({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/grades`)}`);
  const enr = await enrolmentForBookAnyState(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);
  if (enr!.role === "instructor") redirect(`/teach/${enr!.sectionId}/gradebook`);
  // a student's own enrolment only — never another student's
  const g = await gradesForStudent(enr!.sectionId, enr!.id);

  return (
    <main className="catalog" style={{ maxWidth: "46rem" }}>
      <LogoutButton />
      <div className="back-strip ui"><BackButton fallbackHref={`/${book}`} /><Link className="nav-button ghost" href={`/${book}`}>Course home</Link></div>
      <h1>My grades</h1>
      {enr!.withdrawnAt && <p className="ui" role="status">{WITHDRAWN_NOTICE}</p>}

      {!g || (g.graded.length === 0 && g.participation.length === 0) ? (
        <p className="ui" style={{ color: "var(--muted)" }}>Nothing has been graded yet. Your grade appears here as work is marked.</p>
      ) : (
        <>
        {g.graded.length === 0 && (
          <p className="ui" style={{ color: "var(--muted)" }}>Nothing has been graded yet. Your grade appears here as work is marked.</p>
        )}
          {g.graded.length > 0 && <>
          <div className="book-card featured-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="t">{g.total == null ? "—" : `${show(g.total)}%`}</div>
              <div className="s">Your grade so far{g.categorised && g.letter ? ` · ${g.letter}` : ""}</div>
            </div>
            {g.categorised && g.letter && <div style={{ fontSize: "2.4rem", fontWeight: 700, color: "var(--navy)" }}>{g.letter}</div>}
          </div>

          {g.categorised && (
            <>
              <h2 style={{ color: "var(--navy)", marginTop: "1.4rem" }}>By category</h2>
              <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
                <thead><tr><th style={cell}>Category</th><th style={num}>Weight</th><th style={num}>Your %</th></tr></thead>
                <tbody>
                  {g.perCategory.map((c) => (
                    <tr key={c.id}>
                      <td style={cell}>{c.name}{c.dropLowest > 0 ? <span style={{ color: "var(--muted)" }}> · lowest {c.dropLowest} dropped</span> : null}</td>
                      <td style={num}>{show(c.weight)}%</td>
                      <td style={num}>{c.pct == null ? <span style={{ color: "var(--muted)" }}>not started</span> : `${show(c.pct)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ui" style={{ color: "var(--muted)", fontSize: ".82rem" }}>
                A category with nothing graded yet is left out, and the other weights are scaled to 100% — so your
                grade reflects what has been marked, not what is still to come.
              </p>
            </>
          )}

          <h2 style={{ color: "var(--navy)", marginTop: "1.4rem" }}>Graded work</h2>
          <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead><tr><th style={cell}>Work</th><th style={num}>Score</th><th style={num}>%</th></tr></thead>
            <tbody>
              {g.graded.map((it) => (
                <tr key={it.id}>
                  <td style={cell}>{it.title}<div style={{ color: "var(--muted)", fontSize: ".78rem" }}>{it.kind}</div></td>
                  <td style={num}>{it.points} / {it.max}</td>
                  <td style={num}>{it.pct == null ? "—" : `${show(it.pct)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {g.ungradedCount > 0 && (
            <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: ".6rem" }}>
              {g.ungradedCount} other {g.ungradedCount === 1 ? "item has" : "items have"} not been graded yet and
              {g.ungradedCount === 1 ? " is" : " are"} not counted. This is your current grade, not a final one.
            </p>
          )}

          {g.categorised && (
            <p className="ui" style={{ color: "var(--muted)", fontSize: ".82rem" }}>
              Letter scale: {g.bands.map((b) => `${b.letter} ≥ ${show(b.min)}`).join(" · ")}.
            </p>
          )}
          </>}

          {g.participation.length > 0 && (
            <>
              <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Participation</h2>
              <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
                These are recorded as done or not done. They carry no marks and do not count towards your grade.
              </p>
              <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
                <thead><tr><th style={cell}>Simulation</th><th style={cell}>Status</th></tr></thead>
                <tbody>
                  {g.participation.map((p) => (
                    <tr key={p.id}>
                      <td style={cell}>{p.title}</td>
                      <td style={cell}>
                        {p.completedAt
                          ? <>Completed<div style={{ color: "var(--muted)", fontSize: ".78rem" }}>{formatLocal(p.completedAt)}</div></>
                          : <span style={{ color: "var(--muted)" }}>Not yet</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </main>
  );
}
