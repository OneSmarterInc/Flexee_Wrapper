import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { openExamsForSection } from "@/lib/assessment";
import { startExamAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import { bookPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ book: string }> }) =>
  bookPageTitle("Exams and quizzes", params);


export default async function StudentExams({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/exams`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);
  const exams = await openExamsForSection(enr.sectionId, enr.id);

  return (
    <main id="main" className="catalog exam-list">
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref={`/${book}`} />
        <Link className="nav-button ghost" href={`/${book}`}>Reading</Link>
      </div>
      <h1>Exams</h1>
      {exams.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>No open exams right now.</p>}
      {exams.map(({ exam, canAttempt, attemptsUsed, lastScore, lastMax }) => (
        <div key={exam.id} className="book-card course-card">
          <div className="t">{exam.title}</div>
          <div className="s">
            {lastScore != null ? `Your score: ${lastScore}/${lastMax}. ` : ""}
            {attemptsUsed}/{exam.attemptLimit} attempt{exam.attemptLimit === 1 ? "" : "s"} used
          </div>
          <div className="button-row ui">
            {canAttempt ? (
              <form action={startExamAction}>
                <input type="hidden" name="bookId" value={book} /><input type="hidden" name="examId" value={exam.id} />
                <button type="submit" className="nav-button primary">
                  {attemptsUsed ? "Retake" : "Start"}
                </button>
              </form>
            ) : <span style={{ color: "var(--muted)" }}>No attempts left</span>}
          </div>
        </div>
      ))}
    </main>
  );
}
