import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBooks } from "@/lib/content";
import { teachingByTerm } from "@/lib/course";
import { createSectionAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";
const field = { padding: ".55rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Teach({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/teach");
  const [groups, books, sp] = await Promise.all([teachingByTerm(user!.id), listBooks(), searchParams]);
  return (
    <main className="catalog teach-home">
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref="/" />
        <Link className="nav-button ghost" href="/">Reading home</Link>
        <Link className="nav-button ghost" href="/library">Library</Link>
        {user!.systemRole === "admin" && <Link className="nav-button ghost" href="/admin">Administration</Link>}
      </div>
      <div className="page-kicker ui">Teaching & records</div>
      <h1>My courses</h1>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {groups.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>No classes yet.</p>}
      {groups.map((g) => (
        <section key={g.term} style={{ marginTop: "1.4rem" }}>
          <h2 className="ui" style={{ color: "var(--muted)", fontSize: ".9rem", borderBottom: "1px solid var(--rule)", paddingBottom: ".3rem" }}>{g.term}</h2>
          {g.sections.map((s) => (
            <Link key={s.id} className="book-card section-card" href={`/teach/${s.id}`}>
              <div>
                <div className="t">{s.name}</div>
                <div className="s">{s.bookId} · join code {s.joinCode}</div>
              </div>
              <span className="nav-button secondary">Open records</span>
            </Link>
          ))}
        </section>
      ))}
      {user!.systemRole !== "admin" && (
        <p className="ui" style={{ color: "var(--muted)", marginTop: "2rem" }}>
          Classes are set up by an administrator. If a class you teach is missing, ask an administrator to create it and add you as its faculty.
        </p>
      )}
      {user!.systemRole === "admin" && <>
      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Create a section you teach</h2>
      <form action={createSectionAction} className="ui create-section-form">
        <select name="bookId" required style={field}>
          <option value="">Choose a book...</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <input name="name" placeholder="Section name (e.g. Section A)" required style={field} />
        <input name="term" placeholder="Term (e.g. 2027 Spring)" style={field} />
        <button type="submit" className="nav-button primary">Create section</button>
      </form>
      </>}
    </main>
  );
}
