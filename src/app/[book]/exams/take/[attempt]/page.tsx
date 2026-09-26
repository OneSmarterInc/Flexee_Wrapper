import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { attemptForTaking } from "@/lib/assessment";
import { submitExamAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

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
    <main className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <h1>Exam</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>{data.items.length} questions · answer all, then submit.</p>
      <form action={submitExamAction}>
        <input type="hidden" name="bookId" value={book} /><input type="hidden" name="attemptId" value={attempt} />
        {data.items.map((it, i) => (
          <fieldset key={it.questionId} style={{ border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem 1.2rem", margin: "0 0 1.1rem" }}>
            <legend className="ui" style={{ color: "var(--muted)", fontSize: ".82rem" }}>Question {i + 1}</legend>
            <p style={{ marginTop: 0 }}>{it.stem}</p>
            <div className="ui" style={{ display: "grid", gap: ".4rem" }}>
              {it.options.map((o) => (
                <label key={o.id} style={{ display: "flex", gap: ".55rem", alignItems: "baseline", cursor: "pointer" }}>
                  <input type="radio" name={`q_${it.questionId}`} value={o.id} />
                  <span>{o.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="submit" className="ui" style={{ padding: ".6rem 1.2rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" }}>Submit exam</button>
      </form>
    </main>
  );
}
