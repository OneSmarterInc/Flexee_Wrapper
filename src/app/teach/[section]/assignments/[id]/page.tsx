import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { assignmentForFaculty } from "@/lib/assignments";
import { formatLocal } from "@/lib/time";
import { updateAssignmentAction, deleteAssignmentAction, addFilesAction, removeFileAction } from "@/app/assignment-actions";
import AssignmentFields from "@/components/AssignmentFields";
import FilePicker from "@/components/FilePicker";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const cell = { borderBottom: "1px solid var(--rule)", padding: ".45rem .6rem", textAlign: "left" } as const;

export default async function AssignmentPage({ params, searchParams }: { params: Promise<{ section: string; id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ section, id }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/assignments/${id}`)}`);
  const v = await assignmentForFaculty(user!.id, id);
  if (!v || v.assignment.sectionId !== section) redirect(`/teach/${section}/assignments`);
  const { assignment: a, files, rows } = v!;
  const submitted = rows.filter((r) => r.submission).length;
  return (
    <main className="catalog" style={{ maxWidth: "56rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}/assignments`}>← Assignments</Link></p>
      <h1>{a.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>{a.kind === "case_study" ? "Case study" : "Assignment"} · due {formatLocal(a.dueAt)} · {a.points} points · {a.published ? "published" : "draft"}</p>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}

      <h2 style={{ color: "var(--navy)" }}>Submissions — {submitted} of {rows.length}</h2>
      <table className="ui" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th style={cell}>Student</th><th style={cell}>Submitted</th><th style={cell}>Score</th><th style={cell}></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.enrolmentId}>
              <td style={cell}>{r.name}{r.isDemo && <span style={demoTag}>Demo</span>}</td>
              <td style={cell}>{r.submission ? <>{formatLocal(r.submission.submittedAt)}{r.submission.late && <strong style={{ color: "#b4451f" }}> · late</strong>}</> : <span style={{ color: "var(--muted)" }}>not submitted</span>}</td>
              <td style={cell}>{r.submission?.status === "graded" ? `${r.submission.score} / ${a.points}` : r.submission ? <span style={{ color: "#b4451f" }}>to grade</span> : ""}</td>
              <td style={cell}>{r.submission && <Link href={`/teach/${section}/assignments/${a.id}/${r.submission.id}`}>{r.submission.status === "graded" ? "View" : "Grade"} →</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Attachments for students</h2>
      <ul className="ui">
        {files.map((f) => (
          <li key={f.id}>
            <a href={`/api/files/assignment/${f.id}`}>{f.fileName}</a>{" "}
            <form action={removeFileAction} style={{ display: "inline" }}>
              <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="fileId" value={f.id} />
              <button type="submit" style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer" }}>remove</button>
            </form>
          </li>
        ))}
        {files.length === 0 && <li style={{ color: "var(--muted)" }}>None.</li>}
      </ul>
      <form action={addFilesAction} className="ui" style={{ display: "grid", gap: ".5rem", maxWidth: "36rem" }}>
        <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="id" value={a.id} />
        <FilePicker name="files" purpose="assignment" assignmentId={a.id} prefix={`assignments/${a.id}/`} label="Add files (each up to 50 MB)" />
        <button className="nav-button secondary" type="submit">Attach</button>
      </form>

      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Edit</h2>
      <form action={updateAssignmentAction} className="ui" style={{ display: "grid", gap: ".55rem", maxWidth: "40rem" }}>
        <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="id" value={a.id} />
        <AssignmentFields a={a} />
        <button className="nav-button primary" type="submit">Save</button>
      </form>
      <form action={deleteAssignmentAction} className="ui" style={{ marginTop: "1.5rem" }}>
        <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="id" value={a.id} />
        <button className="nav-button ghost" type="submit">Delete this assignment</button>
        <span style={{ color: "var(--muted)", marginLeft: ".6rem" }}>Only possible while nothing is graded.</span>
      </form>
    </main>
  );
}
const demoTag = { marginLeft: ".4rem", padding: ".05rem .35rem", border: "1px solid var(--rule)", borderRadius: "4px", fontSize: ".7rem", color: "var(--muted)" } as const;
