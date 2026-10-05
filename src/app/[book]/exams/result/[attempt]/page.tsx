import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { attemptEnrolmentId, attemptResult } from "@/lib/assessment";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function ExamResult({ params }: { params: Promise<{ book: string; attempt: string }> }) {
  const { book, attempt } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/exams`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr || (await attemptEnrolmentId(attempt)) !== enr.id) redirect(`/${book}/exams`);
  const result = await attemptResult(attempt);
  if (!result) redirect(`/${book}/exams`);

  return (
    <main className="catalog exam-result" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref={`/${book}/exams`} />
        <Link className="nav-button ghost" href={`/${book}/exams`}>Exams</Link>
      </div>
      <h1>Your score: {result.score}/{result.maxPoints}</h1>
      {!result.showFeedback && <p className="ui" style={{ color: "var(--muted)" }}>Answers and explanations will be available after the exam closes.</p>}
      {result.showFeedback && result.items.map((it, i) => (
        <div key={i} className="book-card result-card">
          <p style={{ marginTop: 0 }}>{it.stem}</p>
          <p className="ui" style={{ fontSize: ".9rem", color: it.correct ? "var(--ok)" : "var(--danger)" }}>
            {it.correct ? "Correct" : "Incorrect"} - you chose: {it.selected}
          </p>
          {!it.correct && it.answer && <p className="ui" style={{ fontSize: ".9rem" }}>Correct answer: {it.answer}</p>}
          {it.rationale && <p className="ui" style={{ fontSize: ".88rem", color: "var(--muted)" }}>{it.rationale}</p>}
        </div>
      ))}
    </main>
  );
}
