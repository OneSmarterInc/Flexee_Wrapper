import Link from "next/link";
import { redirect } from "next/navigation";
import { listBooks } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { userClasses } from "@/lib/enrolment";
import { enrollByCodeAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const field = { padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; need?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [books, classes, sp] = await Promise.all([listBooks(), userClasses(user!.id), searchParams]);
  const titles = new Map(books.map((b) => [b.id, b]));

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
      {sp.need && <p className="ui" style={{ color: "#b4451f" }}>That book is not open to you yet. Join its class with the code your instructor gave you — or, if you have joined, your instructor has not published it yet.</p>}

      <form action={enrollByCodeAction} className="ui join-form">
        <input name="code" placeholder="Join a section with a code" style={field} />
        <button type="submit" className="nav-button secondary">Join</button>
      </form>

      {classes.length === 0 && (
        <p className="ui" style={{ color: "var(--muted)" }}>You are not in any classes yet. Join one with the code your instructor gave you.</p>
      )}
      {classes.map((c) => (
        <div key={c.sectionId} className="book-card course-card">
          <div className="t">{titles.get(c.bookId)?.title ?? c.bookId}</div>
          <div className="s">{c.name}{c.term ? ` · ${c.term}` : ""}{c.role === "instructor" ? " · you teach this class" : ""}</div>
          <div className="button-row ui">
            {c.canOpen ? (
              <>
                <Link className="nav-button primary" href={`/${c.bookId}`}>Open</Link>
                <Link className="nav-button secondary" href={`/${c.bookId}/exams`}>Exams</Link>
                {c.role === "instructor" && <Link className="nav-button ghost" href={`/teach/${c.sectionId}`}>Teach</Link>}
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>Your instructor hasn't opened this book yet.</span>
            )}
          </div>
          {c.role === "instructor" && !c.published && (
            <div className="s ui" style={{ color: "#b4451f", marginTop: ".4rem" }}>Not published — your students cannot see this book yet.</div>
          )}
        </div>
      ))}
    </main>
  );
}
