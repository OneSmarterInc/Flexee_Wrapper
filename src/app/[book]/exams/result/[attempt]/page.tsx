import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { attemptEnrolmentId, attemptResult } from "@/lib/assessment";
import LogoutButton from "@/components/LogoutButton";

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
    <main className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/${book}/exams`}>← Exams</Link></p>
      <h1>Your score: {result.score}/{result.maxPoints}</h1>
      {!result.showFeedback && <p className="ui" style={{ color: "var(--muted)" }}>Answers and explanations will be available after the exam closes.</p>}
      {result.showFeedback && result.items.map((it, i) => (
        <div key={i} style={{ border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem 1.2rem", margin: "0 0 1rem" }}>
          <p style={{ marginTop: 0 }}>{it.stem}</p>
          <p className="ui" style={{ fontSize: ".9rem", color: it.correct ? "#2a7d3f" : "#b4451f" }}>
            {it.correct ? "Correct" : "Incorrect"} — you chose: {it.selected}
          </p>
          {!it.correct && it.answer && <p className="ui" style={{ fontSize: ".9rem" }}>Correct answer: {it.answer}</p>}
          {it.rationale && <p className="ui" style={{ fontSize: ".88rem", color: "var(--muted)" }}>{it.rationale}</p>}
        </div>
      ))}
    </main>
  );
}
