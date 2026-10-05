import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { attemptForTaking } from "@/lib/assessment";
import { submitExamAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import { bookPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ book: string }> }) =>
  bookPageTitle("Sitting an exam", params);


export default async function TakeExam({ params }: { params: Promise<{ book: string; attempt: string }> }) {
  const { book, attempt } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/exams`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);
  const data = await attemptForTaking(attempt);
  if (!data || data.attempt.enrolmentId !== enr.id) redirect(`/${book}/exams`);
  if (data.attempt.submittedAt) redirect(`/${book}/exams/result/${attempt}`);

  return (
    <main id="main" className="catalog exam-taking" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref={`/${book}/exams`} label="Back to exams" />
      </div>
      <h1>Exam</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>{data.items.length} questions · answer all, then submit.</p>
      <form action={submitExamAction}>
        <input type="hidden" name="bookId" value={book} /><input type="hidden" name="attemptId" value={attempt} />
        {data.items.map((it, i) => (
          <fieldset key={it.questionId} className="exam-question">
            <legend className="ui">Question {i + 1}</legend>
            <p style={{ marginTop: 0 }}>{it.stem}</p>
            <div className="ui exam-options">
              {it.options.map((o) => (
                <label key={o.id}>
                  <input type="radio" name={`q_${it.questionId}`} value={o.id} />
                  <span>{o.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="submit" className="nav-button primary">Submit exam</button>
      </form>
    </main>
  );
}
