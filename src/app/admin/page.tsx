import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBooks } from "@/lib/content";
import { allClasses } from "@/lib/admin";
import { createClassAction } from "@/app/admin/actions";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";
const field = { padding: ".55rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (user!.systemRole !== "admin") redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  const [classes, books, sp] = await Promise.all([allClasses(), listBooks(), searchParams]);
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const terms = [...new Set(classes.map((c) => c.term))];
  return (
    <main className="catalog teach-home">
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref="/" />
        <Link className="nav-button ghost" href="/teach">My teaching</Link>
        <Link className="nav-button ghost" href="/library">Library</Link>
      </div>
      <div className="page-kicker ui">Administration</div>
      <h1>Classes</h1>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {classes.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>No classes yet. Create the first one below.</p>}
      {terms.map((term) => (
        <section key={term} style={{ marginTop: "1.4rem" }}>
          <h2 className="ui" style={{ color: "var(--muted)", fontSize: ".9rem", borderBottom: "1px solid var(--rule)", paddingBottom: ".3rem" }}>{term}</h2>
          {classes.filter((c) => c.term === term).map((c) => (
            <Link key={c.id} className="book-card section-card" href={`/admin/${c.id}`}>
              <div>
                <div className="t">{c.name}</div>
                <div className="s">
                  {titles.get(c.bookId) ?? c.bookId} · {c.instructors.length ? `Faculty: ${c.instructors.join(", ")}` : "No faculty yet"}
                  {" · "}{c.students} student{c.students === 1 ? "" : "s"}
                  {c.pendingInvites ? ` · ${c.pendingInvites} invited` : ""}
                </div>
              </div>
              <span className="nav-button secondary">Manage</span>
            </Link>
          ))}
        </section>
      ))}
      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Create a class</h2>
      <form action={createClassAction} className="ui create-section-form">
        <select name="bookId" required style={field}>
          <option value="">Choose a book...</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <input name="name" placeholder="Class name (e.g. MIS 3250, Section 01)" required style={field} />
        <input name="term" placeholder="Term (e.g. 2027 Spring)" style={field} />
        <label className="ui" style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
          <input type="checkbox" name="teach" /> I teach this class
        </label>
        <button type="submit" className="nav-button primary">Create class</button>
      </form>
    </main>
  );
}
