import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { questionBankForChapter, questionCounts } from "@/lib/assessment";
import WorkspaceShell from "@/components/WorkspaceShell";
import { classPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ section: string }> }) =>
  classPageTitle("The question bank", params);


type Option = { id: string; text: string; correct?: boolean };
function options(json: string): Option[] {
  try { const value = JSON.parse(json); return Array.isArray(value) ? value : []; } catch { return []; }
}
function reviewStatus(json: string | null): string {
  try {
    const value = json ? JSON.parse(json) : null;
    if (value?.review?.status && value.review.status !== "approved") return `Review: ${value.review.status}`;
    if (value?.use === "practice") return "Practice only";
  } catch {}
  return "Available for exams";
}

export default async function QuestionBank({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ chapter?: string }>;
}) {
  const [{ section }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/questions`)}`);
  const sec = await ownedSection(user.id, section);
  if (!sec) redirect("/faculty");
  const counts = await questionCounts(sec.bookId);
  const requested = Number(sp.chapter);
  const chapter = counts.chapters.includes(requested) ? requested : counts.chapters[0];
  const bank = chapter === undefined ? [] : await questionBankForChapter(sec.bookId, chapter);

  return (
    <WorkspaceShell active="faculty" isAdmin={user.systemRole === "admin"} canTeach displayName={user.displayName}
      links={[{ href: `/teach/${section}`, label: "Class workspace" }, { href: `/teach/${section}/exams`, label: "Exams" }]}>
      <header className="workspace-heading"><div>
        <Link className="ui" href={`/teach/${section}`}>← {sec.name}</Link>
        <div className="page-kicker ui" style={{ marginTop: ".8rem" }}>Faculty · Assessment</div>
        <h1>Question bank</h1>
        <p className="ui">Review the questions imported with this book. Only faculty assigned to this class can see the answers.</p>
      </div><Link className="nav-button primary" href={`/teach/${section}/exams`}>Create an exam</Link></header>
      <div className="workspace-stats ui" aria-label="Question bank summary">
        <div className="workspace-stat"><strong>{counts.total}</strong><span>Questions in this book</span></div>
        <div className="workspace-stat"><strong>{counts.chapters.length}</strong><span>Chapters with questions</span></div>
        <div className="workspace-stat"><strong>{bank.length}</strong><span>Questions in this chapter</span></div>
      </div>
      <section className="workspace-panel ui">
        <h2>Browse by chapter</h2>
        {counts.total === 0 ? <p>No questions are loaded for this book. Add them with a book package in the <Link href="/library">book library</Link>.</p> : (
          <nav className="button-row" aria-label="Question bank chapters">
            {counts.chapters.map((ch) => <Link key={ch} className={`nav-button ${chapter === ch ? "primary" : "ghost"}`}
              href={`/teach/${section}/questions?chapter=${ch}`} aria-current={chapter === ch ? "page" : undefined}>Chapter {ch}</Link>)}
          </nav>
        )}
      </section>
      {bank.length > 0 && <section aria-label={`Chapter ${chapter} questions`}>
        <div className="workspace-section-heading"><h2>Chapter {chapter}</h2><span className="ui">{bank.length} questions</span></div>
        {bank.map((q, index) => <details key={q.id} className="workspace-panel ui workspace-question">
          <summary><strong>{index + 1}. {q.stem}</strong><span>{q.difficulty} · {q.points} point{q.points === 1 ? "" : "s"} · {reviewStatus(q.metaJson)}</span></summary>
          <p>Question ID: <code>{q.id}</code>{q.section ? ` · Section ${q.section}` : ""}</p>
          <ol>{options(q.optionsJson).map((opt) => <li key={opt.id} className={opt.correct ? "correct-answer" : undefined}>
            {opt.text}{opt.correct && <strong> · Correct answer</strong>}
          </li>)}</ol>
        </details>)}
      </section>}
    </WorkspaceShell>
  );
}
