import Link from "next/link";
import { redirect } from "next/navigation";
import { listBooks } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { userClasses } from "@/lib/enrolment";
import { enrollByCodeAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import PortalNav from "@/components/PortalNav";

export const dynamic = "force-dynamic";
const field = { padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function StudentHome({ searchParams }: { searchParams: Promise<{ error?: string; need?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/student");
  const [books, classes, sp] = await Promise.all([listBooks(), userClasses(user.id), searchParams]);
  const titles = new Map(books.map((b) => [b.id, b]));

  return (
    <main className="catalog">
      <LogoutButton />
      <PortalNav active="student" isAdmin={user.systemRole === "admin"}
        canTeach={classes.some((c) => c.role === "instructor")} />
      <div className="page-kicker ui">Student portal</div>
      <h1>My learning</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Signed in as {user.displayName}</p>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {sp.need && <p className="ui" style={{ color: "#b4451f" }}>That book is not open to you yet. Join its class, or wait for it to be published.</p>}

      <form action={enrollByCodeAction} className="ui join-form">
        <input name="code" placeholder="Join a class with a code" aria-label="Class join code" style={field} />
        <button type="submit" className="nav-button secondary">Join class</button>
      </form>

      {classes.length === 0 && (
        <p className="ui" style={{ color: "var(--muted)" }}>You are not in any classes yet. Join one with the code your instructor gave you.</p>
      )}
      {classes.map((c) => (
        <div key={c.sectionId} className="book-card course-card">
          <div className="t">{titles.get(c.bookId)?.title ?? c.bookId}</div>
          <div className="s">{c.name}{c.term ? ` · ${c.term}` : ""} · {c.role === "instructor" ? "Faculty" : "Student"}</div>
          <div className="button-row ui">
            {c.canOpen ? (
              <>
                <Link className="nav-button primary" href={`/${c.bookId}`}>Open book</Link>
                <Link className="nav-button secondary" href={`/${c.bookId}/exams`}>Exams</Link>
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>This class&apos;s book has not been published yet.</span>
            )}
            {c.role === "instructor" && <Link className="nav-button ghost" href={`/teach/${c.sectionId}`}>Manage teaching</Link>}
          </div>
          {c.role === "instructor" && !c.published && (
            <div className="s ui" style={{ color: "#b4451f", marginTop: ".4rem" }}>Not published — your students cannot see this book yet.</div>
          )}
        </div>
      ))}
    </main>
  );
}
