import Link from "next/link";
import { redirect } from "next/navigation";
import { listBooks } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { userEnrolments } from "@/lib/enrolment";
import { enroll, enrollByCodeAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const field = { padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; need?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [books, enrol, sp] = await Promise.all([listBooks(), userEnrolments(user!.id), searchParams]);
  const enrolled = new Set(enrol.map((e) => e.bookId));

  return (
    <main className="catalog">
      <LogoutButton />
      <div className="page-kicker ui">Learning portal</div>
      <h1>Flexee Reader</h1>
      <div className="catalog-meta ui">
        <span>Signed in as {user!.displayName}</span>
        <Link href="/teach" className="nav-button ghost">Teaching & records</Link>
      </div>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {sp.need && <p className="ui" style={{ color: "#b4451f" }}>Enroll to open that book.</p>}

      <form action={enrollByCodeAction} className="ui join-form">
        <input name="code" placeholder="Join a section with a code" style={field} />
        <button type="submit" className="nav-button secondary">Join</button>
      </form>

      {books.map((b) => (
        <div key={b.id} className="book-card course-card">
          <div className="t">{b.title}</div>
          <div className="s">{b.subtitle ?? ""}</div>
          <div className="button-row ui">
            {enrolled.has(b.id) ? (
              <>
                <Link className="nav-button primary" href={`/${b.id}`}>Open</Link>
                <Link className="nav-button secondary" href={`/${b.id}/exams`}>Exams</Link>
              </>
            ) : (
              <form action={enroll}>
                <input type="hidden" name="bookId" value={b.id} />
                <button type="submit" className="nav-button secondary">Enroll</button>
              </form>
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
