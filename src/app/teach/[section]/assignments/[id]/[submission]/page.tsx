import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { submissionForFaculty } from "@/lib/assignments";
import { formatLocal } from "@/lib/time";
import { gradeAction, reopenAction } from "@/app/assignment-actions";
import LogoutButton from "@/components/LogoutButton";
import { classPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ section: string }> }) =>
  classPageTitle("A submission", params);

const field = { padding: ".5rem .65rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function GradePage({ params, searchParams }: { params: Promise<{ section: string; id: string; submission: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ section, id, submission }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/assignments/${id}/${submission}`)}`);
  const v = await submissionForFaculty(user!.id, submission);
  if (!v || v.assignment.id !== id || v.assignment.sectionId !== section) redirect(`/teach/${section}/assignments/${id}`);
  const { assignment: a, submission: s, student, files } = v!;
  return (
    <main id="main" className="catalog" style={{ maxWidth: "52rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}/assignments/${id}`}>← {a.title}</Link></p>
      <h1>{student}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Submitted {formatLocal(s.submittedAt)}{s.late ? " · late" : ""} · {s.status === "graded" ? `graded ${s.score} / ${a.points}` : "not graded yet"}</p>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      {s.text && <div className="ui" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem" }}>{s.text}</div>}
      {files.length > 0 && <ul className="ui">{files.map((f) => <li key={f.id}><a href={`/api/files/submission/${f.id}`}>{f.fileName}</a> <span style={{ color: "var(--muted)" }}>({(f.sizeBytes / 1024).toFixed(0)} KB)</span></li>)}</ul>}
      <form action={gradeAction} className="ui" style={{ display: "grid", gap: ".55rem", maxWidth: "40rem", marginTop: "1.2rem" }}>
        <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="assignmentId" value={a.id} /><input type="hidden" name="submissionId" value={s.id} />
        <label>Score <input type="number" name="score" min={0} max={a.points} step="0.5" defaultValue={s.score ?? ""} required style={{ ...field, width: "7rem" }} /> / {a.points}</label>
        <textarea name="feedback" rows={6} placeholder="Feedback for the student" defaultValue={s.feedback ?? ""} style={field} />
        <button className="nav-button primary" type="submit">{s.status === "graded" ? "Update grade" : "Save grade"}</button>
      </form>
      {s.status === "graded" && (
        <form action={reopenAction} className="ui" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="assignmentId" value={a.id} /><input type="hidden" name="submissionId" value={s.id} />
          <button className="nav-button ghost" type="submit">Reopen for revision</button>
          <span style={{ color: "var(--muted)", marginLeft: ".6rem" }}>The student can resubmit; the score is removed until you grade again.</span>
        </form>
      )}
    </main>
  );
}
