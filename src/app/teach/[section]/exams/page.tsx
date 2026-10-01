import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { examsForSection, questionCounts } from "@/lib/assessment";
import { createExamAction, examStatusAction } from "@/app/actions";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";
const field = { padding: ".5rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;

export default async function Exams({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/exams`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [list, counts] = await Promise.all([examsForSection(section), questionCounts(sec.bookId)]);

  return (
    <WorkspaceShell active="faculty" isAdmin={user.systemRole === "admin"} canTeach displayName={user.displayName}
      links={[{ href: `/teach/${section}`, label: "Class workspace" }, { href: "#exams", label: "Exams" }, { href: "#new-exam", label: "Create exam" }]}>
      <header className="workspace-heading"><div><Link className="ui" href={`/teach/${section}`}>← {sec.name}</Link><div className="page-kicker ui" style={{ marginTop: ".8rem" }}>Faculty · Assessment</div><h1>Exams</h1><p className="ui">Create an exam from this book&apos;s question bank, then open it for the class.</p></div><Link className="nav-button primary" href="#new-exam">Create exam</Link></header>
      <section className="workspace-panel ui" id="exams"><h2>Class exams</h2>

      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Title</th><th style={cell}>Blueprint</th><th style={cell}>Status</th><th style={cell}></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td style={cell} colSpan={4}>No exams yet.</td></tr>}
          {list.map((e) => {
            const bp = JSON.parse(e.blueprintJson);
            const summary = bp.mode === "draw" ? bp.rules.map((r: any) => `${r.count} × ch${r.chapter} (${r.difficulty})`).join(", ") : `${bp.ids.length} fixed`;
            return (
              <tr key={e.id}>
                <td style={cell}><Link href={`/teach/${section}/exams/${e.id}`}>{e.title}</Link></td>
                <td style={cell}>{summary}</td>
                <td style={cell}>{e.status}</td>
                <td style={cell}>
                  <form action={examStatusAction} style={{ display: "inline" }}>
                    <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="examId" value={e.id} />
                    <input type="hidden" name="status" value={e.status === "open" ? "closed" : "open"} />
                    <button style={{ border: "none", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit" }}>
                      {e.status === "open" ? "Close" : "Open"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </section>

      <section className="workspace-panel ui" id="new-exam"><h2>Create an exam</h2>
      <p>Question bank for this book: {counts.total} questions across chapter{counts.chapters.length === 1 ? "" : "s"} {counts.chapters.join(", ") || "—"}. <Link href={`/teach/${section}/questions`}>Browse questions and answers</Link>. Select a chapter and the number of questions to draw.</p>
      {counts.total === 0 && <p className="workspace-alert error" role="alert">This book has no questions yet. Upload a book package with a question bank through the <Link href="/library">book library</Link>.</p>}
      <form action={createExamAction} className="ui" style={{ display: "grid", gap: ".6rem", maxWidth: "30rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <label>Exam title <input name="title" placeholder="e.g. Chapter 1 quiz" required style={{ ...field, display: "block", width: "100%" }} /></label>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <select name="chapter" style={{ ...field, flex: 1 }} aria-label="Chapter">
            {counts.chapters.map((c) => <option key={c} value={c}>Chapter {c}</option>)}
          </select>
          <select name="difficulty" style={{ ...field, flex: 1 }} aria-label="Difficulty">
            <option value="any">any difficulty</option><option value="recall">recall</option>
            <option value="apply">apply</option><option value="analyse">analyse</option>
          </select>
          <input name="count" type="number" min={1} defaultValue={5} style={{ ...field, width: "5rem" }} title="How many questions" />
        </div>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <select name="feedback" style={{ ...field, flex: 1 }} aria-label="When students see answers">
            <option value="after_close">feedback after close</option>
            <option value="immediate">feedback immediately</option>
          </select>
          <input name="attemptLimit" type="number" min={1} defaultValue={1} style={{ ...field, width: "6rem" }} title="Attempts allowed" />
          <select name="kind" style={{ ...field, width: "7rem" }} aria-label="Exam or quiz" title="A quiz counts the highest attempt; an exam counts the first">
            <option value="exam">Exam</option>
            <option value="quiz">Quiz</option>
          </select>
        </div>
        <button type="submit" style={{ ...field, cursor: "pointer", background: "var(--navy)", color: "#fff", border: "none" }}>Create (draft)</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: ".6rem" }}>
        A draw serves a random selection per student. Create as a draft, then open it when the class is ready.
        A quiz counts the highest attempt by default and an exam the first; change that on its own page.
      </p>
      </section>
    </WorkspaceShell>
  );
}
