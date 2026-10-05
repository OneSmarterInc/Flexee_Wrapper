import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getBook, listBooks } from "@/lib/content";
import { classById } from "@/lib/admin";
import { demoUserIds } from "@/lib/d2l-import";
import { sectionRoster, pendingInvites } from "@/lib/roster";
import { addPeopleAction, removeInviteAction } from "@/app/admin/actions";
import RemoveStudent from "@/components/RemoveStudent";
import { REMOVE_PHRASE } from "@/lib/class-actions";
import ClassBookPanel from "@/components/ClassBookPanel";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";

function People({ role, sectionId, people, invites }: {
  role: "instructor" | "student"; sectionId: string;
  people: { enrolmentId: string; name: string; email: string | null }[];
  invites: { id: string; email: string; name: string | null }[];
}) {
  const faculty = role === "instructor";
  const title = faculty ? "Faculty" : "Students";
  return (
    <section className="workspace-panel ui" id={faculty ? "faculty" : "students"} aria-labelledby={`${role}-heading`}>
      <h2 id={`${role}-heading`}>{faculty ? "1. Assign faculty" : "2. Add students"}</h2>
      <p>{faculty
        ? "Faculty manage this class's content, assignments, exams, and grades. Add their sign-in email; existing accounts gain access immediately."
        : "Add students by email or upload a CSV class list. They can read the book after it is published to this class."}</p>
      <div className="workspace-table-wrap">
        <table className="workspace-table">
          <thead><tr><th>{title}</th><th>Email</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {people.length === 0 && invites.length === 0 && <tr><td colSpan={4}>No {title.toLowerCase()} added yet.</td></tr>}
            {people.map((person) => (
              <tr key={person.enrolmentId}>
                <td>{person.name}</td><td>{person.email ?? "—"}</td><td><span className="workspace-status">Active</span></td>
                <td><RemoveStudent sectionId={sectionId} enrolmentId={person.enrolmentId}
                  name={person.name} role={role} phrase={REMOVE_PHRASE} back={`/admin/${sectionId}`} /></td>
              </tr>
            ))}
            {invites.map((person) => (
              <tr key={person.id}>
                <td>{person.name ?? "—"}</td><td>{person.email}</td><td><span className="workspace-status waiting">Invited</span></td>
                <td><form action={removeInviteAction}>
                  <input type="hidden" name="sectionId" value={sectionId} />
                  <input type="hidden" name="inviteId" value={person.id} />
                  <button className="nav-button ghost" type="submit" aria-label={`Withdraw invitation for ${person.email}`}>Withdraw</button>
                </form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={addPeopleAction} className="ui workspace-people-form">
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="role" value={role} />
        <label htmlFor={`people-${role}`}>Add {title.toLowerCase()} — one per line, as <code>email</code> or <code>email, name</code></label>
        <textarea id={`people-${role}`} name="people" rows={faculty ? 2 : 4}
          placeholder={faculty ? "faculty@example.edu, Faculty Name" : "student1@example.edu, Student One\nstudent2@example.edu, Student Two"} />
        {!faculty && <label>Or upload a CSV class list (email, name) <input type="file" name="file" accept=".csv,.txt" /></label>}
        <button className="nav-button primary" type="submit">Add {title.toLowerCase()}</button>
      </form>
    </section>
  );
}

export default async function AdminClass({ params, searchParams }: {
  params: Promise<{ section: string }>; searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const [{ section: sectionId }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=/admin/${sectionId}`);
  if (user.systemRole !== "admin") redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  const cls = await classById(sectionId);
  if (!cls) redirect("/admin?error=" + encodeURIComponent("That class no longer exists."));
  const [roster, invites, book, library] = await Promise.all([
    sectionRoster(sectionId), pendingInvites(sectionId), getBook(cls.bookId).catch(() => null), listBooks(),
  ]);
  const by = (role: string) => roster.filter((r) => r.role === role).map((r) => ({ enrolmentId: r.enrolmentId, name: r.name, email: r.email, userId: r.userId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const invited = (role: string) => invites.filter((i) => (i.role ?? "student") === role);
  const faculty = by("instructor"), students = by("student");
  // Spec 18: D2L's demo account is not one of the class's students. Counted apart, never hidden.
  const demos = await demoUserIds(sectionId);
  const demoCount = students.filter((s) => demos.has(s.userId)).length;

  return (
    <WorkspaceShell active="admin" isAdmin canTeach displayName={user.displayName}
      links={[{ href: "/admin#classes", label: "All classes" }, { href: "#faculty", label: "Faculty" }, { href: "#students", label: "Students" }, { href: "#book", label: "Book access" }]}>
      <header className="workspace-heading">
        <div>
          <Link className="ui" href="/admin#classes">← All classes</Link>
          <div className="page-kicker ui" style={{ marginTop: ".8rem" }}>Class setup · {cls.term ?? "Term not set"}</div>
          <h1>{cls.name}</h1>
          <p className="ui">{book?.title ?? cls.bookId}</p>
        </div>
      </header>
      {sp.error && <p className="workspace-alert error ui" role="alert">{sp.error}</p>}
      {sp.ok && <p className="workspace-alert ui" role="status">{sp.ok}</p>}
      <div className="workspace-stats ui" aria-label="Class summary">
        <div className="workspace-stat"><strong>{faculty.length}</strong><span>Faculty assigned</span></div>
        <div className="workspace-stat"><strong>{students.length - demoCount}</strong><span>Students enrolled{demoCount ? ` (+${demoCount} demo)` : ""}</span></div>
        <div className="workspace-stat"><strong>{cls.bookPublishedAt ? "Open" : "Closed"}</strong><span>Book access for students</span></div>
      </div>
      <section className="workspace-panel ui" aria-labelledby="join-code-heading">
        <h2 id="join-code-heading">Class join code: <code>{cls.joinCode}</code></h2>
        <p>Give this code to students who should join themselves. You can also add them by email in step 2 below.</p>
        <p style={{ marginBottom: 0 }}>
          <Link className="nav-button secondary" href={`/teach/${sectionId}/import/d2l`}>Import the class list from D2L</Link>
        </p>
      </section>
      <People role="instructor" sectionId={sectionId} people={faculty} invites={invited("instructor")} />
      <People role="student" sectionId={sectionId} people={students} invites={invited("student")} />
      <section className="workspace-panel ui" id="book" aria-labelledby="book-heading">
        <h2 id="book-heading">3. Check and publish the book</h2>
        <p>Faculty can prepare the book before publication. Students see it only after you publish it to this class.</p>
        <ClassBookPanel sectionId={sectionId} back={`/admin/${sectionId}`} bookId={cls.bookId}
          published={!!cls.bookPublishedAt} publishedAt={cls.bookPublishedAt ?? null}
          library={library.map((b) => ({ id: b.id, title: b.title }))} />
      </section>
    </WorkspaceShell>
  );
}
