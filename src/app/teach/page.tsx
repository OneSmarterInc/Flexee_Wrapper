import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBooks } from "@/lib/content";
import { teachingByTerm } from "@/lib/course";
import { createSectionAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const field = { padding: ".55rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const btn = { padding: ".55rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" } as const;

export default async function Teach({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/teach");
  const [groups, books, sp] = await Promise.all([teachingByTerm(user!.id), listBooks(), searchParams]);
  return (
    <main className="catalog">
      <LogoutButton />
      <h1>My courses</h1>
      <p className="ui"><Link href="/">← Reading</Link></p>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {groups.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>No sections yet. Create one below.</p>}
      {groups.map((g) => (
        <section key={g.term} style={{ marginTop: "1.4rem" }}>
          <h2 className="ui" style={{ color: "var(--muted)", fontSize: ".9rem", borderBottom: "1px solid var(--rule)", paddingBottom: ".3rem" }}>{g.term}</h2>
          {g.sections.map((s) => (
            <Link key={s.id} className="book-card" href={`/teach/${s.id}`}>
              <div className="t">{s.name}</div>
              <div className="s">{s.bookId} · join code {s.joinCode}</div>
            </Link>
          ))}
        </section>
      ))}
      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Create a section</h2>
      <form action={createSectionAction} className="ui" style={{ display: "grid", gap: ".7rem", maxWidth: "26rem" }}>
        <select name="bookId" required style={field}>
          <option value="">Choose a book…</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <input name="name" placeholder="Section name (e.g. Section A)" required style={field} />
        <input name="term" placeholder="Term (e.g. 2027 Spring)" style={field} />
        <button type="submit" style={btn}>Create section</button>
      </form>
    </main>
  );
}
