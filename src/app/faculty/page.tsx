import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { teachingByTerm } from "@/lib/course";
import { listBooks } from "@/lib/content";
import WorkspaceShell from "@/components/WorkspaceShell";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My teaching" };


export default async function FacultyHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/faculty");
  const [groups, books, sp] = await Promise.all([teachingByTerm(user.id), listBooks(), searchParams]);
  const isAdmin = user.systemRole === "admin";
  if (!isAdmin && groups.length === 0) {
    redirect(`/student?error=${encodeURIComponent("You are not assigned to teach a class. Ask an administrator to add you as faculty.")}`);
  }
  const classes = groups.flatMap((g) => g.sections.map((section) => ({ ...section, term: g.term })));
  const titles = new Map(books.map((b) => [b.id, b.title]));

  return (
    <WorkspaceShell active="faculty" isAdmin={isAdmin} canTeach displayName={user.displayName}
      links={[{ href: "#my-classes", label: "My classes" }, { href: "/library", label: "Book library" }]}>
      <header className="workspace-heading">
        <div>
          <div className="page-kicker ui">Faculty dashboard</div>
          <h1>Teach your classes</h1>
          <p className="ui">Open a class to publish its book, prepare content, create assignments and exams, and review student work.</p>
        </div>
        <Link className="nav-button secondary" href="/library">Book library</Link>
      </header>
      {sp.error && <p className="workspace-alert error ui" role="alert">{sp.error}</p>}

      {classes.length === 0 ? (
        <section className="workspace-panel ui" id="my-classes">
          <h2>No teaching classes yet</h2>
          <p>Your administrator must assign you as faculty to a class. As an administrator, you can create a class and select “I will teach this class,” or open a class and add yourself to its Faculty list.</p>
          <Link className="nav-button primary" href="/admin#classes">Open Administration</Link>
        </section>
      ) : (
        <>
          <div className="workspace-stats ui" aria-label="Teaching summary">
            <div className="workspace-stat"><strong>{classes.length}</strong><span>Classes you teach</span></div>
            <div className="workspace-stat"><strong>{new Set(classes.map((c) => c.bookId)).size}</strong><span>Books in your classes</span></div>
            <div className="workspace-stat"><strong>{groups.length}</strong><span>Terms</span></div>
          </div>
          <section className="workspace-panel ui" aria-labelledby="faculty-flow-heading">
            <h2 id="faculty-flow-heading">Your class workflow</h2>
            <ol className="workspace-steps">
              <li><b>1. Prepare</b><span>Open the class, review its book, and publish it when ready.</span></li>
              <li><b>2. Teach</b><span>Post announcements and create assignments or exams.</span></li>
              <li><b>3. Review</b><span>Grade submissions and use the gradebook and mastery reports.</span></li>
            </ol>
          </section>
          <section id="my-classes" aria-labelledby="my-classes-heading">
            <div className="workspace-section-heading"><h2 id="my-classes-heading">My classes</h2><span className="ui" style={{ color: "var(--muted)" }}>{classes.length} assigned</span></div>
            <div className="workspace-actions">
              {classes.map((c) => (
                <Link key={c.id} href={`/teach/${c.id}`} className="workspace-action ui">
                  <strong>{c.name}</strong>
                  <span>{c.term} · {titles.get(c.bookId) ?? c.bookId}</span>
                  <span style={{ display: "block", marginTop: ".6rem", color: "var(--link)", fontWeight: 700 }}>Open class workspace →</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}
