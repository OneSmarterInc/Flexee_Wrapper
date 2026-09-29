import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection, sectionRoster, pendingInvites } from "@/lib/roster";
import { sectionContentStatus } from "@/lib/versions";
import { sectionHasNrps } from "@/lib/lti";
import { syncRosterAction, resetStudentPasswordAction } from "@/app/actions";
import { getBook } from "@/lib/content";
import { regenerateCodeAction, removeStudentAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import ClassBookPanel from "@/components/ClassBookPanel";
import { classBookState } from "@/lib/publish";
import { listBooks } from "@/lib/content";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;

export default async function SectionDashboard({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ synced?: string; seen?: string; sync_error?: string; pwreset?: string; temp?: string; pwreset_error?: string; ok?: string; error?: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [book, roster, invites, content, hasNrps, sp] = await Promise.all([getBook(sec.bookId), sectionRoster(section), pendingInvites(section), sectionContentStatus(section, sec.bookId), sectionHasNrps(section), searchParams]);
  const [bookState, library] = await Promise.all([classBookState(section), listBooks()]);
  const updates = content.filter((c) => c.hasUpdate).length;
  const students = roster.filter((r) => r.role === "student");
  const instructors = roster.filter((r) => r.role === "instructor");

  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href="/teach">← Teaching</Link></p>
      <h1>{sec.name}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>{book.title}</p>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {bookState && <ClassBookPanel sectionId={section} back={`/teach/${section}`} bookId={bookState.bookId}
        published={bookState.published} publishedAt={bookState.publishedAt}
        library={library.map((b) => ({ id: b.id, title: b.title }))} />}

      <div className="book-card ui">
        <div className="s">Join code — share with students, or import a roster</div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: ".4rem" }}>
          <span style={{ fontSize: "1.5rem", letterSpacing: ".08em", color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>{sec.joinCode}</span>
          <form action={regenerateCodeAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" style={{ padding: ".3rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "transparent", color: "var(--muted)", cursor: "pointer", font: "inherit" }}>Regenerate</button>
          </form>
          <Link href={`/teach/${section}/import`}>Import roster (CSV) →</Link>
        </div>
      </div>

      <div className="book-card ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div className="t" style={{ fontSize: "1rem" }}>Course home</div><div className="s">Announcements · syllabus · what's due when</div></div>
        <div style={{ display: "flex", gap: "1rem" }}><Link href={`/teach/${section}/assignments`}>Assignments →</Link><Link href={`/teach/${section}/announcements`}>Announcements →</Link><Link href={`/teach/${section}/syllabus`}>Syllabus →</Link><Link href={`/teach/${section}/schedule`}>Schedule →</Link><Link href={`/teach/${section}/aol`}>Assurance of learning →</Link></div>
      </div>

      <div className="book-card ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div className="t" style={{ fontSize: "1rem" }}>Content</div><div className="s">{updates ? `${updates} update${updates === 1 ? "" : "s"} available to review` : "Up to date"}</div></div>
        <Link href={`/teach/${section}/content`}>Manage →</Link>
      </div>

      <div className="book-card ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div className="t" style={{ fontSize: "1rem" }}>Exams</div><div className="s">Assemble, open, and review exams</div></div>
        <Link href={`/teach/${section}/exams`}>Manage →</Link>
      </div>

      <div className="book-card ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div className="t" style={{ fontSize: "1rem" }}>Assessment of learning</div><div className="s">Mastery by objective · syllabus alignment</div></div>
        <div style={{ display: "flex", gap: "1rem" }}><Link href={`/teach/${section}/mastery`}>Mastery →</Link><Link href={`/teach/${section}/syllabus`}>Syllabus →</Link></div>
      </div>

      <div className="book-card ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div className="t" style={{ fontSize: "1rem" }}>Gradebook</div><div className="s">Weighted totals across exams and manual columns · CSV export</div></div>
        <Link href={`/teach/${section}/gradebook`}>Open →</Link>
      </div>

      {sp.synced && <p className="ui" style={{ color: "#2a7d3f" }}>Synced roster from the LMS — added {sp.synced} of {sp.seen} member(s).</p>}
      {sp.sync_error && <p className="ui" style={{ color: "#b4451f" }}>{sp.sync_error}</p>}
      {sp.pwreset && sp.temp && <p className="ui" style={{ color: "var(--navy)", background: "var(--mark)", padding: ".6rem .8rem", borderRadius: "8px" }}>Temporary password for <strong>{sp.pwreset}</strong>: <code>{sp.temp}</code> — give it to them in person; they should change it after signing in. (Shown once.)</p>}
      {sp.pwreset_error && <p className="ui" style={{ color: "#b4451f" }}>{sp.pwreset_error}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.6rem" }}>
        <h2 style={{ color: "var(--navy)", margin: 0 }}>Roster</h2>
        {hasNrps && (
          <form action={syncRosterAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" className="ui" style={{ padding: ".35rem .8rem", border: "1px solid var(--link)", borderRadius: "6px", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit" }}>Sync roster from LMS</button>
          </form>
        )}
      </div>
      <p className="ui" style={{ color: "var(--muted)" }}>{students.length} student{students.length === 1 ? "" : "s"} · {instructors.length} instructor{instructors.length === 1 ? "" : "s"}{invites.length ? ` · ${invites.length} invited` : ""}</p>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Name</th><th style={cell}>Email</th><th style={cell}>Role</th><th style={cell}></th></tr></thead>
        <tbody>
          {instructors.map((r) => (
            <tr key={r.enrolmentId}><td style={cell}>{r.name}</td><td style={cell}>{r.email}</td><td style={cell}>instructor</td><td style={cell}></td></tr>
          ))}
          {students.map((r) => (
            <tr key={r.enrolmentId}>
              <td style={cell}>{r.name}</td><td style={cell}>{r.email}</td><td style={cell}>student</td>
              <td style={cell}>
                <div style={{ display: "flex", gap: ".8rem" }}>
                  <form action={resetStudentPasswordAction}>
                    <input type="hidden" name="sectionId" value={section} />
                    <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
                    <input type="hidden" name="name" value={r.name ?? r.email ?? "student"} />
                    <button type="submit" style={{ border: "none", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit" }}>Reset password</button>
                  </form>
                  <form action={removeStudentAction}>
                    <input type="hidden" name="sectionId" value={section} />
                    <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
                    <button type="submit" style={{ border: "none", background: "transparent", color: "#b4451f", cursor: "pointer", font: "inherit" }}>Remove</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {invites.map((i) => (
            <tr key={i.id} style={{ color: "var(--muted)" }}>
              <td style={cell}>{i.name ?? ""}</td><td style={cell}>{i.email}</td><td style={cell}>invited</td><td style={cell}>enrols on sign-in</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
