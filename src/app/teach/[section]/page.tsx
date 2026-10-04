import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection, sectionRoster, pendingInvites } from "@/lib/roster";
import { sectionContentStatus } from "@/lib/versions";
import { sectionHasNrps } from "@/lib/lti";
import { syncRosterAction, sendInviteAction, sendAllInvitesAction, copyInviteLinkAction } from "@/app/actions";
import { inviteStatesFor, type InviteState } from "@/lib/recovery";
import { getBook } from "@/lib/content";
import { regenerateCodeAction, removeStudentAction } from "@/app/actions";
import ClassBookPanel from "@/components/ClassBookPanel";
import { classBookState } from "@/lib/publish";
import { listBooks } from "@/lib/content";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";
const cell = { borderBottom: "1px solid var(--rule)", padding: ".65rem .7rem", textAlign: "left" } as const;
const linkBtn = { border: "none", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit", padding: 0 } as const;
const rosterBtn = { padding: ".35rem .8rem", border: "1px solid var(--link)", borderRadius: "6px", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit" } as const;

const day = (d: Date) => d.toISOString().slice(0, 10);
// Spec 17: what the class list says about each student's way in.
function inviteLabel(s: InviteState | undefined) {
  if (!s) return "—";
  switch (s.state) {
    case "demo": return "Demo";
    case "set up": return "Set up";
    case "invited": return `Invited ${day(s.at)}`;
    case "link copied": return `Link copied ${day(s.at)}`;
    case "link expired": return `Link expired (sent ${day(s.at)})`;
    case "not sent": return `Not sent: ${s.reason}`;
    default: return "Not invited yet";
  }
}

export default async function SectionDashboard({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ synced?: string; seen?: string; sync_error?: string; invite_link?: string; ok?: string; error?: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/faculty");
  const [book, roster, invites, content, hasNrps, sp] = await Promise.all([getBook(sec.bookId), sectionRoster(section), pendingInvites(section), sectionContentStatus(section, sec.bookId), sectionHasNrps(section), searchParams]);
  const [bookState, library, inviteStates] = await Promise.all([classBookState(section), listBooks(), inviteStatesFor(section)]);
  const updates = content.filter((c) => c.hasUpdate).length;
  const students = roster.filter((r) => r.role === "student");
  const instructors = roster.filter((r) => r.role === "instructor");
  // Spec 18: a demo is not one of the class's students for counting purposes, and is never part
  // of a bulk resend. It is still listed, labelled "Demo".
  const isDemo = (userId: string) => inviteStates.get(userId)?.state === "demo";
  const demoCount = students.filter((r) => isDemo(r.userId)).length;
  const realStudents = students.length - demoCount;
  const notSetUp = students.filter((r) => !isDemo(r.userId) && inviteStates.get(r.userId)?.state !== "set up").length;

  return (
    <WorkspaceShell active="faculty" isAdmin={user.systemRole === "admin"} canTeach displayName={user.displayName}
      links={[{ href: "/faculty", label: "My classes" }, { href: "#coursework", label: "Coursework" }, { href: "#book", label: "Book access" }, { href: "#roster", label: "Roster" }]}>
      <header className="workspace-heading"><div>
        <Link className="ui" href="/faculty">← My classes</Link>
        <div className="page-kicker ui" style={{ marginTop: ".8rem" }}>Faculty class workspace</div>
        <h1>{sec.name}</h1>
        <p className="ui">{book.title}</p>
      </div><Link className="nav-button primary" href={`/teach/${section}/assignments`}>Manage assignments</Link></header>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      <div className="workspace-stats ui" aria-label="Class summary">
        <div className="workspace-stat"><strong>{realStudents}</strong><span>Students{demoCount ? ` (+${demoCount} demo)` : ""}</span></div>
        <div className="workspace-stat"><strong>{updates}</strong><span>Content updates to review</span></div>
        <div className="workspace-stat"><strong>{bookState?.published ? "Open" : "Closed"}</strong><span>Student book access</span></div>
      </div>
      <section className="workspace-panel ui" id="book" aria-labelledby="faculty-book-heading">
      <h2 id="faculty-book-heading">Book access</h2>
      <p>Review the book used in this class and control when students may open it.</p>
      {bookState && <ClassBookPanel sectionId={section} back={`/teach/${section}`} bookId={bookState.bookId}
        published={bookState.published} publishedAt={bookState.publishedAt}
        library={library.map((b) => ({ id: b.id, title: b.title }))} />}
      </section>

      <section className="workspace-panel ui" id="coursework" aria-labelledby="coursework-heading">
        <h2 id="coursework-heading">Teach and assess</h2>
        <p>Open the tool you need to prepare lessons, assess students, or review progress.</p>
        <div className="workspace-actions">
          <Link className="workspace-action" href={`/teach/${section}/assignments`}><strong>Assignments</strong><span>Create work, set due dates, and review submissions.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/sims`}><strong>Simulations</strong><span>Add simulations to this class and see who has played.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/exams`}><strong>Exams</strong><span>Build exams from the question bank and review attempts.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/questions`}><strong>Question bank</strong><span>Browse chapter questions and answer keys imported with this book.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/gradebook`}><strong>Gradebook</strong><span>See totals, record scores, and export grades.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/content`}><strong>Book content</strong><span>{updates ? `${updates} update${updates === 1 ? "" : "s"} available to review.` : "Review chapters and manage updates."}</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/assistant`}><strong>Course assistant</strong><span>Switch it on, see the usage, and answer students&apos; questions.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/announcements`}><strong>Announcements</strong><span>Post updates for students.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/schedule`}><strong>Schedule</strong><span>Plan what is due and when.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/syllabus`}><strong>Syllabus</strong><span>Set outcomes and course expectations.</span></Link>
          <Link className="workspace-action" href={`/teach/${section}/mastery`}><strong>Mastery and reports</strong><span>Follow progress against learning objectives.</span></Link>
        </div>
        <p style={{ marginTop: "1rem" }}><Link href={`/teach/${section}/aol`}>Assurance of learning report →</Link></p>
      </section>

      <section className="workspace-panel ui" id="roster" aria-labelledby="roster-heading">
      <div className="workspace-section-heading" style={{ marginTop: 0 }}>
        <h2 id="roster-heading">Class roster</h2>
        <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
          <Link className="nav-button secondary" href={`/teach/${section}/import/d2l`}>Import from D2L</Link>
          <Link className="nav-button ghost" href={`/teach/${section}/import`}>Import students (CSV)</Link>
        </div>
      </div>
      <p>Share this join code with students so they can join from their dashboard.</p>
      <div className="workspace-action" style={{ marginBottom: "1rem" }}>
        <strong>Join code: <code>{sec.joinCode}</code></strong>
        <form action={regenerateCodeAction} style={{ marginTop: ".7rem" }}>
          <input type="hidden" name="sectionId" value={section} />
          <button type="submit" className="nav-button ghost">Generate a new code</button>
        </form>
      </div>
      {sp.synced && <p className="ui" style={{ color: "#2a7d3f" }}>Synced roster from the LMS — added {sp.synced} of {sp.seen} member(s).</p>}
      {sp.sync_error && <p className="ui" style={{ color: "#b4451f" }}>{sp.sync_error}</p>}
      {sp.invite_link && (
        <div className="ui" style={{ color: "var(--navy)", background: "var(--mark)", padding: ".6rem .8rem", borderRadius: "8px" }}>
          <p style={{ margin: 0 }}>A fresh set-your-password link, shown once. Give it to that student directly; it works once, expires in 14 days, and has replaced any earlier link of theirs.</p>
          <p style={{ margin: ".4rem 0 0", wordBreak: "break-all" }}><code>{sp.invite_link}</code></p>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
        {notSetUp > 0 && (
          <form action={sendAllInvitesAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" className="ui" style={rosterBtn}>Resend to everyone not set up ({notSetUp})</button>
          </form>
        )}
        {hasNrps && (
          <form action={syncRosterAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" className="ui" style={rosterBtn}>Sync roster from LMS</button>
          </form>
        )}
      </div>
      <p className="ui" style={{ color: "var(--muted)" }}>{realStudents} student{realStudents === 1 ? "" : "s"}{demoCount ? ` · ${demoCount} demo` : ""} · {instructors.length} instructor{instructors.length === 1 ? "" : "s"}{invites.length ? ` · ${invites.length} invited` : ""}</p>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Name</th><th style={cell}>Email</th><th style={cell}>Role</th><th style={cell}>Account</th><th style={cell}></th></tr></thead>
        <tbody>
          {instructors.map((r) => (
            <tr key={r.enrolmentId}><td style={cell}>{r.name}</td><td style={cell}>{r.email}</td><td style={cell}>instructor</td><td style={cell}></td><td style={cell}></td></tr>
          ))}
          {students.map((r) => (
            <tr key={r.enrolmentId}>
              <td style={cell}>{r.name}</td><td style={cell}>{r.email}</td><td style={cell}>student</td>
              <td style={cell}>{inviteLabel(inviteStates.get(r.userId))}</td>
              <td style={cell}>
                <div style={{ display: "flex", gap: ".8rem", flexWrap: "wrap" }}>
                  {!isDemo(r.userId) && (
                    <form action={sendInviteAction}>
                      <input type="hidden" name="sectionId" value={section} />
                      <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
                      <button type="submit" style={linkBtn}>{inviteStates.get(r.userId)?.state === "set up" ? "Send a reset link" : "Resend invitation"}</button>
                    </form>
                  )}
                  <form action={copyInviteLinkAction}>
                    <input type="hidden" name="sectionId" value={section} />
                    <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
                    <button type="submit" style={linkBtn}>Copy link</button>
                  </form>
                  <form action={removeStudentAction}>
                    <input type="hidden" name="sectionId" value={section} />
                    <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
                    <button type="submit" style={{ ...linkBtn, color: "#b4451f" }}>Remove</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {invites.map((i) => (
            <tr key={i.id} style={{ color: "var(--muted)" }}>
              <td style={cell}>{i.name ?? ""}</td><td style={cell}>{i.email}</td><td style={cell}>invited</td><td style={cell}>no account yet</td><td style={cell}>enrols on sign-in</td>
            </tr>
          ))}
        </tbody>
      </table>
      </section>
    </WorkspaceShell>
  );
}
