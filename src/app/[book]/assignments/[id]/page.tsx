import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { assignmentForStudent } from "@/lib/assignments";
import { formatLocal } from "@/lib/time";
import { submitAction } from "@/app/assignment-actions";
import FilePicker from "@/components/FilePicker";
import LogoutButton from "@/components/LogoutButton";
import { bookPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ book: string }> }) =>
  bookPageTitle("An assignment", params);

const field = { padding: ".55rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function MyAssignment({ params, searchParams }: { params: Promise<{ book: string; id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ book, id }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/assignments/${id}`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);
  const v = await assignmentForStudent(user!.id, id);
  if (!v || v.assignment.sectionId !== enr!.sectionId) redirect(`/${book}/assignments`);
  const { assignment: a, files, submission: s, submissionFiles } = v!;
  const graded = s?.status === "graded";
  const closed = !!a.dueAt && new Date() > a.dueAt && !a.allowLate;
  return (
    <main id="main" className="catalog" style={{ maxWidth: "46rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/${book}/assignments`}>← Assignments</Link></p>
      <h1>{a.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>{a.kind === "case_study" ? "Case study" : "Assignment"} · due {formatLocal(a.dueAt)} · {a.points} points{a.allowLate ? "" : " · no late work"}</p>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      {a.instructions && <div style={{ whiteSpace: "pre-wrap" }}>{a.instructions}</div>}
      {files.length > 0 && <><h2 style={{ color: "var(--navy)" }}>Files</h2><ul className="ui">{files.map((f) => <li key={f.id}><a href={`/api/files/assignment/${f.id}`}>{f.fileName}</a></li>)}</ul></>}

      {graded && (
        <div className="ui" style={{ border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem", margin: "1rem 0" }}>
          <div style={{ fontSize: "1.3rem", color: "var(--navy)" }}>{s!.score} / {a.points}</div>
          {s!.feedback && <div style={{ whiteSpace: "pre-wrap", marginTop: ".5rem" }}>{s!.feedback}</div>}
        </div>
      )}
      {s && (
        <>
          <h2 style={{ color: "var(--navy)" }}>Your submission</h2>
          <p className="ui" style={{ color: "var(--muted)" }}>Submitted {formatLocal(s.submittedAt)}{s.late ? " · late" : ""}</p>
          {s.text && <div className="ui" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--rule)", borderRadius: "8px", padding: ".8rem" }}>{s.text}</div>}
          {submissionFiles.length > 0 && <ul className="ui">{submissionFiles.map((f) => <li key={f.id}><a href={`/api/files/submission/${f.id}`}>{f.fileName}</a></li>)}</ul>}
        </>
      )}
      {!graded && !closed && (
        <form action={submitAction} className="ui" style={{ display: "grid", gap: ".6rem", marginTop: "1.2rem" }}>
          <h2 style={{ color: "var(--navy)", margin: 0 }}>{s ? "Replace your submission" : "Submit"}</h2>
          <input type="hidden" name="book" value={book} /><input type="hidden" name="assignmentId" value={a.id} />
          <textarea name="text" rows={8} placeholder="Your answer (optional if you attach files)" defaultValue={s?.text ?? ""} style={field} />
          <FilePicker name="files" purpose="submission" assignmentId={a.id} label="Attach files (each up to 50 MB)" />
          {s && <span style={{ color: "var(--muted)" }}>Submitting again replaces your text and files.</span>}
          <button className="nav-button primary" type="submit">{s ? "Resubmit" : "Submit"}</button>
        </form>
      )}
      {closed && !s && <p className="ui" style={{ color: "var(--danger)" }}>The due date has passed and this assignment does not accept late work.</p>}
    </main>
  );
}
