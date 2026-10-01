import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBooks } from "@/lib/content";
import { allClasses } from "@/lib/admin";
import { createClassAction } from "@/app/admin/actions";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.systemRole !== "admin") redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  const [classes, books, sp] = await Promise.all([allClasses(), listBooks(), searchParams]);
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const published = classes.filter((c) => c.bookPublished).length;
  const students = classes.reduce((total, c) => total + c.students, 0);

  return (
    <WorkspaceShell active="admin" isAdmin canTeach displayName={user.displayName}
      links={[{ href: "#classes", label: "All classes" }, { href: "#new-class", label: "Create a class" }, { href: "/library", label: "Book library" }, { href: "/admin/sims", label: "Simulations" }]}>
      <header className="workspace-heading">
        <div>
          <div className="page-kicker ui">Administrator dashboard</div>
          <h1>Run your classes</h1>
          <p className="ui">Set up a class, add its faculty and students, then publish its book. Open any class below to complete those steps.</p>
        </div>
        <Link className="nav-button primary" href="#new-class">Create a class</Link>
      </header>
      {sp.error && <p className="workspace-alert error ui" role="alert">{sp.error}</p>}
      {sp.ok && <p className="workspace-alert ui" role="status">{sp.ok}</p>}

      <div className="workspace-stats ui" aria-label="Class summary">
        <div className="workspace-stat"><strong>{classes.length}</strong><span>Classes</span></div>
        <div className="workspace-stat"><strong>{published}</strong><span>Books published to classes</span></div>
        <div className="workspace-stat"><strong>{students}</strong><span>Student enrolments</span></div>
      </div>

      <section className="workspace-panel ui" aria-labelledby="setup-heading">
        <h2 id="setup-heading">How class setup works</h2>
        <ol className="workspace-steps">
          <li><b>1. Create a class</b><span>Choose its book, name, and term.</span></li>
          <li><b>2. Add people</b><span>Open the class and add faculty and students by email or CSV.</span></li>
          <li><b>3. Publish the book</b><span>Students can read it only after you publish it to their class.</span></li>
        </ol>
      </section>

      <section className="workspace-panel ui" id="classes" aria-labelledby="classes-heading">
        <div className="workspace-section-heading" style={{ marginTop: 0 }}>
          <h2 id="classes-heading">All classes</h2>
          <span style={{ color: "var(--muted)", fontSize: ".82rem" }}>{classes.length} total</span>
        </div>
        {classes.length === 0 ? (
          <p>No classes yet. Use the form below to create the first one.</p>
        ) : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead><tr><th>Class</th><th>Book</th><th>Faculty</th><th>Students</th><th>Book access</th><th></th></tr></thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/admin/${c.id}`}>{c.name}</Link><div style={{ color: "var(--muted)", fontSize: ".76rem", fontWeight: 400 }}>{c.term}</div></td>
                    <td>{titles.get(c.bookId) ?? c.bookId}</td>
                    <td>{c.instructors.length ? c.instructors.join(", ") : <span className="workspace-status waiting">Add faculty</span>}</td>
                    <td>{c.students}{c.pendingInvites ? <div style={{ color: "var(--muted)", fontSize: ".76rem" }}>{c.pendingInvites} invited</div> : null}</td>
                    <td><span className={`workspace-status${c.bookPublished ? "" : " waiting"}`}>{c.bookPublished ? "Published" : "Not published"}</span></td>
                    <td><Link className="nav-button secondary" href={`/admin/${c.id}`}>Set up class</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="workspace-panel ui" id="new-class" aria-labelledby="new-class-heading">
        <h2 id="new-class-heading">Create a class</h2>
        <p>After creation you will be taken to the class page to add people and publish its book.</p>
        {books.length === 0 ? <p>No books are in the library yet. <Link href="/library">Add a book first</Link>.</p> : (
          <form action={createClassAction} className="ui workspace-form-grid">
            <label>Book
              <select name="bookId" required defaultValue="">
                <option value="">Select a book</option>
                {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
            </label>
            <label>Class name
              <input name="name" placeholder="e.g. MIS 3250, Section 01" required />
            </label>
            <label>Term
              <input name="term" placeholder="e.g. Spring 2027" />
            </label>
            <label className="checkbox-label"><input type="checkbox" name="teach" /> I will teach this class</label>
            <button type="submit" className="nav-button primary wide">Create class and continue</button>
          </form>
        )}
      </section>
    </WorkspaceShell>
  );
}
