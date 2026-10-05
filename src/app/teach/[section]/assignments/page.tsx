import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { classAssignments } from "@/lib/assignments";
import { formatLocal } from "@/lib/time";
import { createAssignmentAction } from "@/app/assignment-actions";
import AssignmentFields from "@/components/AssignmentFields";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";

export default async function Assignments({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ section }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/assignments`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const list = (await classAssignments(user!.id, section))!;
  return (
    <WorkspaceShell active="faculty" isAdmin={user.systemRole === "admin"} canTeach displayName={user.displayName}
      links={[{ href: `/teach/${section}`, label: "Class workspace" }, { href: "#assignments", label: "Assignments" }, { href: "#new-assignment", label: "Create assignment" }]}>
      <header className="workspace-heading"><div><Link className="ui" href={`/teach/${section}`}>← {sec.name}</Link><div className="page-kicker ui" style={{ marginTop: ".8rem" }}>Faculty · Coursework</div><h1>Assignments and case studies</h1><p className="ui">Create work, set its due date, and review student submissions.</p></div><Link className="nav-button primary" href="#new-assignment">Create assignment</Link></header>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      <section className="workspace-panel ui" id="assignments"><h2>Class assignments</h2>
      {list.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>None yet.</p>}
      {list.map((a) => (
        <Link key={a.id} href={`/teach/${section}/assignments/${a.id}`} className="book-card section-card">
          <div>
            <div className="t">{a.title} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {a.kind === "case_study" ? "Case study" : "Assignment"}</span></div>
            <div className="s">{formatLocal(a.dueAt)} · {a.points} points · {a.published ? "published" : "draft — students cannot see it"}</div>
          </div>
          <span className="ui" style={{ color: a.submitted > a.graded ? "var(--danger)" : "var(--muted)" }}>
            {a.submitted} submitted · {a.graded} graded
          </span>
        </Link>
      ))}
      </section>
      <section className="workspace-panel ui" id="new-assignment"><h2>New assignment or case study</h2>
      <form action={createAssignmentAction} className="ui" style={{ display: "grid", gap: ".55rem", maxWidth: "40rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <AssignmentFields />
        <button className="nav-button primary" type="submit">Create</button>
      </form>
      </section>
    </WorkspaceShell>
  );
}
