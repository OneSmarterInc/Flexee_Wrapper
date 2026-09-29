import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { teachingByTerm } from "@/lib/course";
import LogoutButton from "@/components/LogoutButton";
import PortalNav from "@/components/PortalNav";

export const dynamic = "force-dynamic";

export default async function FacultyHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/faculty");
  const [groups, sp] = await Promise.all([teachingByTerm(user.id), searchParams]);
  const isAdmin = user.systemRole === "admin";
  if (!isAdmin && groups.length === 0) {
    redirect(`/student?error=${encodeURIComponent("You are not assigned to teach a class. Ask an administrator to add you as faculty.")}`);
  }

  return (
    <main className="catalog teach-home">
      <LogoutButton />
      <PortalNav active="faculty" isAdmin={isAdmin} canTeach />
      <div className="page-kicker ui">Faculty portal</div>
      <h1>My teaching</h1>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {groups.length === 0 && (
        <p className="ui" style={{ color: "var(--muted)" }}>
          You are not teaching a class yet. Create one in <Link href="/admin">Administration</Link> and select “I teach this class,” or add yourself to its faculty list.
        </p>
      )}
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
    </main>
  );
}
