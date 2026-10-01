import Link from "next/link";
import { redirect } from "next/navigation";
import { listBooks } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { userClasses } from "@/lib/enrolment";
import { enrollByCodeAction } from "@/app/actions";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";

export default async function StudentHome({ searchParams }: { searchParams: Promise<{ error?: string; need?: string; joined?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/student");
  const [books, classes, sp] = await Promise.all([listBooks(), userClasses(user.id), searchParams]);
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const available = classes.filter((c) => c.canOpen).length;

  return (
    <WorkspaceShell active="student" isAdmin={user.systemRole === "admin"}
      canTeach={classes.some((c) => c.role === "instructor")} displayName={user.displayName}
      links={[{ href: "#courses", label: "My courses" }, { href: "#join-class", label: "Join a class" }]}>
      <header className="workspace-heading">
        <div>
          <div className="page-kicker ui">Student dashboard</div>
          <h1>My learning</h1>
          <p className="ui">Open your course to read its book, complete assignments, and take exams. Have a class code? Join below.</p>
        </div>
        <Link className="nav-button secondary" href="#join-class">Join a class</Link>
      </header>
      {sp.error && <p className="workspace-alert error ui" role="alert">{sp.error}</p>}
      {sp.need && <p className="workspace-alert error ui" role="alert">That book is not open to you yet. Join its class, or wait for it to be published.</p>}
      {sp.joined && <p className="workspace-alert ui" role="status">You joined the class. It is listed below; its book opens when published.</p>}

      <div className="workspace-stats ui" aria-label="Learning summary">
        <div className="workspace-stat"><strong>{classes.length}</strong><span>Classes joined</span></div>
        <div className="workspace-stat"><strong>{available}</strong><span>Books ready to open</span></div>
        <div className="workspace-stat"><strong>{classes.length - available}</strong><span>Waiting for publication</span></div>
      </div>

      <section className="workspace-panel ui" id="courses" aria-labelledby="courses-heading">
        <h2 id="courses-heading">My courses</h2>
        {classes.length === 0 ? (
          <p>You have not joined a class yet. Ask your instructor for its join code, then use the form below.</p>
        ) : (
          <div className="workspace-actions">
            {classes.map((c) => (
              <div key={c.sectionId} className="workspace-action course-workspace-card">
                <span className={`workspace-status${c.canOpen ? "" : " waiting"}`}>{c.canOpen ? "Book available" : "Book not published"}</span>
                <strong style={{ marginTop: ".7rem" }}>{c.name}</strong>
                <span>{titles.get(c.bookId) ?? c.bookId}{c.term ? ` · ${c.term}` : ""} · {c.role === "instructor" ? "Faculty" : "Student"}</span>
                <div className="button-row ui">
                  {c.canOpen ? (
                    <>
                      <Link className="nav-button primary" href={`/${c.bookId}`}>Open course</Link>
                      {c.role === "student" && <Link className="nav-button secondary" href={`/${c.bookId}/assignments`}>Assignments</Link>}
                      {c.role === "student" && <Link className="nav-button secondary" href={`/${c.bookId}/sims`}>Simulations</Link>}
                      <Link className="nav-button secondary" href={`/${c.bookId}/exams`}>Exams</Link>
                    </>
                  ) : <p className="ui" style={{ color: "var(--muted)", margin: 0 }}>Your class&apos;s book will appear after it is published.</p>}
                  {c.role === "instructor" && <Link className="nav-button ghost" href={`/teach/${c.sectionId}`}>Manage teaching</Link>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="workspace-panel ui" id="join-class" aria-labelledby="join-heading">
        <h2 id="join-heading">Join a class</h2>
        <p>Enter the code your instructor gave you. You can also be added by an administrator using your sign-in email.</p>
        <form action={enrollByCodeAction} className="ui join-form" style={{ maxWidth: "36rem", marginBottom: 0 }}>
          <input name="code" placeholder="Class code" aria-label="Class join code" required />
          <button type="submit" className="nav-button primary">Join class</button>
        </form>
      </section>
    </WorkspaceShell>
  );
}
