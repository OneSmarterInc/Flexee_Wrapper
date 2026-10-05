import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import { simsForClass } from "@/lib/sims";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import { bookPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ book: string }> }) =>
  bookPageTitle("Simulations", params);


export default async function MySims({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/sims`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);
  if (enr!.role === "instructor") redirect(`/teach/${enr!.sectionId}/sims`);
  const list = await simsForClass(enr!.sectionId, true);
  return (
    <main id="main" className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <div className="back-strip ui"><BackButton fallbackHref={`/${book}`} /><Link className="nav-button ghost" href={`/${book}`}>Course home</Link></div>
      <h1>Simulations</h1>
      {list.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>Your instructor has not added any simulations yet.</p>}
      {list.map((s) => (
        <div key={s.id} className="book-card section-card">
          <div><div className="t">{s.title}</div><div className="s">{s.tagline ?? ""}{s.minutes ? ` · about ${s.minutes} minutes` : ""}</div></div>
          <a className="nav-button primary" href={`/sims/launch?sim=${encodeURIComponent(s.id)}&section=${encodeURIComponent(enr!.sectionId)}`}>Start</a>
        </div>
      ))}
    </main>
  );
}
