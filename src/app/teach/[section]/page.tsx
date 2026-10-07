import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection, sectionRoster, pendingInvites } from "@/lib/roster";
import { sectionContentStatus } from "@/lib/versions";
import { sectionHasNrps } from "@/lib/lti";
import { syncRosterAction, sendAllInvitesAction } from "@/app/actions";
import ClassRoster, { type RosterRow } from "@/components/ClassRoster";
import RemoveStudent from "@/components/RemoveStudent";
import { REMOVE_PHRASE, actionsFor, describeAction } from "@/lib/class-actions";
import { inviteStatesFor, type InviteState } from "@/lib/recovery";
import { getBook } from "@/lib/content";
import { regenerateCodeAction, setJoinCodeEnabledAction } from "@/app/actions";
import ClassBookPanel from "@/components/ClassBookPanel";
import { classBookState } from "@/lib/publish";
import { listBooksForPicker } from "@/lib/retire";
import WorkspaceShell from "@/components/WorkspaceShell";
import { classPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ section: string }> }) =>
  classPageTitle("Class record", params);

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

export default async function SectionDashboard({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ synced?: string; seen?: string; sync_error?: string; invite_link?: string; ok?: string; error?: string; show_withdrawn?: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/faculty");
  const [book, roster, invites, content, hasNrps, sp] = await Promise.all([getBook(sec.bookId), sectionRoster(section), pendingInvites(section), sectionContentStatus(section, sec.bookId), sectionHasNrps(section), searchParams]);
  const [bookState, library, inviteStates] = await Promise.all([classBookState(section), listBooksForPicker({ keep: sec.bookId }), inviteStatesFor(section)]);
  const updates = content.filter((c) => c.hasUpdate).length;
  const showWithdrawn = sp.show_withdrawn === "1";
  const allStudents = roster.filter((r) => r.role === "student");
  const withdrawnCount = allStudents.filter((r) => r.withdrawnAt != null).length;
  // Spec 19: withdrawn students are out of the list, and out of every count on this page, until
  // the toggle asks for them.
  const students = showWithdrawn ? allStudents : allStudents.filter((r) => r.withdrawnAt == null);
  const instructors = roster.filter((r) => r.role === "instructor");
  // Spec 18: a demo is not one of the class's students for counting purposes, and is never part
  // of a bulk resend. It is still listed, labelled "Demo".
  const isDemo = (userId: string) => inviteStates.get(userId)?.state === "demo";
  const demoCount = students.filter((r) => isDemo(r.userId) && r.withdrawnAt == null).length;
  const realStudents = students.filter((r) => r.withdrawnAt == null).length - demoCount;
  const notSetUp = students.filter((r) => r.withdrawnAt == null && !isDemo(r.userId) && inviteStates.get(r.userId)?.state !== "set up").length;
  const log = await actionsFor(section, 10);
  // The rows the selectable list works from. The page keeps the states and the counts; the
  // component keeps the selection.
  const rosterRows: RosterRow[] = allStudents.map((r) => {
    const st = inviteStates.get(r.userId);
    return {
      enrolmentId: r.enrolmentId, userId: r.userId, name: r.name, email: r.email ?? null,
      state: inviteLabel(st), stateKey: (st?.state ?? "none") as RosterRow["stateKey"],
      demo: isDemo(r.userId), withdrawn: r.withdrawnAt != null,
      withdrawnOn: r.withdrawnAt ? r.withdrawnAt.toISOString().slice(0, 10) : null,
    };
  });

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
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
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
      <p>
        {sec.joinCodeEnabled
          ? "Share this join code with students so they can join from their dashboard."
          : "Students are added from the class list. Turn the code on below if you also want them to be able to join themselves."}
      </p>
      <div className="workspace-action" style={{ marginBottom: "1rem" }}>
        <strong>Join code: <code>{sec.joinCode}</code></strong>
        {/* Spec 27 B1 decision 2: off for every class. The code itself is left alone either way, so
            turning this off and on again does not strand a code already printed on a slide. */}
        <p className="ui" style={{ margin: ".5rem 0 0" }}>
          {sec.joinCodeEnabled
            ? "Anyone with this code can add themselves to this class."
            : "This code is switched off. A student who types it is told to ask you to add them."}
        </p>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginTop: ".7rem" }}>
          <form action={setJoinCodeEnabledAction}>
            <input type="hidden" name="sectionId" value={section} />
            <input type="hidden" name="enabled" value={sec.joinCodeEnabled ? "no" : "yes"} />
            <button type="submit" className="nav-button secondary">
              {sec.joinCodeEnabled ? "Stop accepting the code" : "Let students join with the code"}
            </button>
          </form>
          <form action={regenerateCodeAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" className="nav-button ghost">Generate a new code</button>
          </form>
        </div>
      </div>
      {sp.synced && <p className="ui" style={{ color: "var(--ok)" }}>Synced roster from the LMS — added {sp.synced} of {sp.seen} member(s).</p>}
      {sp.sync_error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.sync_error}</p>}
      {notSetUp > 0 && (
        <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>
          The invitation-links file contains sign-in links. Treat it like a list of passwords: send it
          through D2L or hand it over, do not forward it, and delete it when you are done. Downloading
          it issues fresh links and retires those students&apos; earlier unused ones.
        </p>
      )}
      {sp.invite_link && (
        <div className="ui" style={{ color: "var(--navy)", background: "var(--mark)", padding: ".6rem .8rem", borderRadius: "8px" }}>
          <p style={{ margin: 0 }}>A fresh set-your-password link, shown once. Give it to that student directly; it works once, expires in 14 days, and has replaced any earlier link of theirs.</p>
          <p style={{ margin: ".4rem 0 0", wordBreak: "break-all" }}><code>{sp.invite_link}</code></p>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
        {notSetUp > 0 && (
          <>
            <form action={sendAllInvitesAction}>
              <input type="hidden" name="sectionId" value={section} />
              <button type="submit" className="ui" style={rosterBtn}>Resend to everyone not set up ({notSetUp})</button>
            </form>
            <a className="ui" style={rosterBtn} href={`/api/class/links?section=${encodeURIComponent(section)}`}>
              Download invitation links ({notSetUp})
            </a>
          </>
        )}
        {hasNrps && (
          <form action={syncRosterAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" className="ui" style={rosterBtn}>Sync roster from LMS</button>
          </form>
        )}
      </div>
      <p className="ui" style={{ color: "var(--muted)" }}>{realStudents} student{realStudents === 1 ? "" : "s"}{demoCount ? ` · ${demoCount} demo` : ""} · {instructors.length} instructor{instructors.length === 1 ? "" : "s"}{invites.length ? ` · ${invites.length} invited` : ""}
        {withdrawnCount > 0 && (
          <> · <Link href={`/teach/${section}${showWithdrawn ? "" : "?show_withdrawn=1"}#roster`}>
            {showWithdrawn ? "hide" : "show"} {withdrawnCount} withdrawn
          </Link></>
        )}
      </p>
      <ClassRoster sectionId={section} rows={rosterRows} showWithdrawn={showWithdrawn} phrase={REMOVE_PHRASE} />

      <h3 className="ui" style={{ marginTop: "1.4rem", font: "inherit", fontWeight: 600 }}>Faculty, and students waiting to join</h3>
      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Name</th><th style={cell}>Email</th><th style={cell}>Role</th><th style={cell}>Account</th><th style={cell}><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>
          {instructors.map((r) => (
            <tr key={r.enrolmentId}>
              <td style={cell}>{r.name}</td><td style={cell}>{r.email}</td><td style={cell}>instructor</td><td style={cell}></td>
              <td style={cell}>
                <RemoveStudent sectionId={section} enrolmentId={r.enrolmentId}
                  name={r.name} role="instructor" phrase={REMOVE_PHRASE} back={`/teach/${section}#roster`} />
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
      {log.length > 0 && (
        <details style={{ marginTop: "1.2rem" }}>
          <summary className="ui" style={{ cursor: "pointer", color: "var(--navy)" }}>Recent changes to this class list ({log.length})</summary>
          <ul className="ui" style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: ".5rem" }}>
            {log.map((a) => <li key={a.id}>{describeAction(a)} · {a.at.toISOString().slice(0, 16).replace("T", " ")} UTC</li>)}
          </ul>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".78rem" }}>The log records counts, never names.</p>
        </details>
      )}
      </section>
    </WorkspaceShell>
  );
}
