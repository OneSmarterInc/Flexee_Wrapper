import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { studentAssignments } from "@/lib/assignments";
import { formatLocal } from "@/lib/time";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import { bookPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ book: string }> }) =>
  bookPageTitle("Assignments", params);


export default async function MyAssignments({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/assignments`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);
  if (enr!.role === "instructor") redirect(`/teach/${enr!.sectionId}/assignments`);
  const list = (await studentAssignments(user!.id, enr!.sectionId)) ?? [];
  const now = new Date();
  return (
    <main id="main" className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <div className="back-strip ui"><BackButton fallbackHref={`/${book}`} /><Link className="nav-button ghost" href={`/${book}`}>Course home</Link></div>
      <h1>Assignments</h1>
      {list.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>Nothing assigned yet.</p>}
      {list.map((a) => {
        const s = a.submission;
        const state = s?.status === "graded" ? `Graded ${s.score} / ${a.points}` : s ? `Submitted${s.late ? " (late)" : ""}`
          : a.dueAt && now > a.dueAt ? (a.allowLate ? "Past due — you can still submit" : "Closed") : "Not submitted";
        return (
          <Link key={a.id} href={`/${book}/assignments/${a.id}`} className="book-card section-card">
            <div>
              <div className="t">{a.title}</div>
              <div className="s">{a.kind === "case_study" ? "Case study" : "Assignment"} · due {formatLocal(a.dueAt)} · {a.points} points</div>
            </div>
            <span className="ui" style={{ color: s?.status === "graded" ? "var(--navy)" : s ? "var(--muted)" : "var(--danger)" }}>{state}</span>
          </Link>
        );
      })}
    </main>
  );
}
