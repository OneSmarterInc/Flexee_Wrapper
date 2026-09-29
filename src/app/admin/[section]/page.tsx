import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getBook } from "@/lib/content";
import { classById } from "@/lib/admin";
import { sectionRoster, pendingInvites } from "@/lib/roster";
import { addPeopleAction, removePersonAction, removeInviteAction } from "@/app/admin/actions";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import ClassBookPanel from "@/components/ClassBookPanel";
import PortalNav from "@/components/PortalNav";
import { listBooks } from "@/lib/content";

export const dynamic = "force-dynamic";
const field = { padding: ".55rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

function People({ title, role, sectionId, people, invites }: {
  title: string; role: "instructor" | "student"; sectionId: string;
  people: { enrolmentId: string; name: string; email: string | null }[];
  invites: { id: string; email: string; name: string | null }[];
}) {
  const noun = role === "instructor" ? "faculty member" : "student";
  return (
    <section style={{ marginTop: "1.8rem" }}>
      <h2 style={{ color: "var(--navy)" }}>{title}</h2>
      {people.length === 0 && invites.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>None yet.</p>}
      <ul className="ui" style={{ listStyle: "none", padding: 0 }}>
        {people.map((p) => (
          <li key={p.enrolmentId} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: ".35rem 0", borderBottom: "1px solid var(--rule)" }}>
            <span>{p.name} <span style={{ color: "var(--muted)" }}>{p.email ?? ""}</span></span>
            <form action={removePersonAction}>
              <input type="hidden" name="sectionId" value={sectionId} />
              <input type="hidden" name="enrolmentId" value={p.enrolmentId} />
              <button className="nav-button ghost" type="submit">Remove</button>
            </form>
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: ".35rem 0", borderBottom: "1px solid var(--rule)" }}>
            <span>{i.name ?? i.email} <span style={{ color: "var(--muted)" }}>{i.name ? i.email : ""} · invited, joins on sign-up</span></span>
            <form action={removeInviteAction}>
              <input type="hidden" name="sectionId" value={sectionId} />
              <input type="hidden" name="inviteId" value={i.id} />
              <button className="nav-button ghost" type="submit">Withdraw</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addPeopleAction} className="ui" style={{ display: "grid", gap: ".5rem", maxWidth: "36rem" }}>
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="role" value={role} />
        <label htmlFor={`people-${role}`}>Add {noun}s — one per line, as <code>email</code> or <code>email, name</code></label>
        <textarea id={`people-${role}`} name="people" rows={role === "instructor" ? 2 : 5} style={field}
          placeholder={role === "instructor" ? "chuck.nemer@example.edu, Chuck Nemer" : "student1@wright.edu, First Student\nstudent2@wright.edu"} />
        {role === "student" && (
          <label>Or upload a class list (CSV: email, name) <input type="file" name="file" accept=".csv,.txt" /></label>
        )}
        <button className="nav-button primary" type="submit">Add {noun}s</button>
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
  if (user!.systemRole !== "admin") redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  const cls = await classById(sectionId);
  if (!cls) redirect("/admin?error=" + encodeURIComponent("That class no longer exists."));
  const [roster, invites, book, library] = await Promise.all([
    sectionRoster(sectionId), pendingInvites(sectionId), getBook(cls!.bookId).catch(() => null), listBooks(),
  ]);
  const by = (role: string) => roster.filter((r) => r.role === role).map((r) => ({ enrolmentId: r.enrolmentId, name: r.name, email: r.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inv = (role: string) => invites.filter((i) => (i.role ?? "student") === role);
  return (
    <main className="catalog teach-home">
      <LogoutButton />
      <PortalNav active="admin" isAdmin canTeach />
      <div className="back-strip ui">
        <BackButton fallbackHref="/admin" />
        <Link className="nav-button ghost" href="/admin">All classes</Link>
      </div>
      <div className="page-kicker ui">Administration · {cls!.term ?? "No term"}</div>
      <h1>{cls!.name}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Book: {book?.title ?? cls!.bookId} · Join code <strong>{cls!.joinCode}</strong> (students can also join with this)
      </p>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      <ClassBookPanel sectionId={sectionId} back={`/admin/${sectionId}`} bookId={cls!.bookId}
        published={!!cls!.bookPublishedAt} publishedAt={cls!.bookPublishedAt ?? null}
        library={library.map((b) => ({ id: b.id, title: b.title }))} />
      <People title="Faculty" role="instructor" sectionId={sectionId} people={by("instructor")} invites={inv("instructor")} />
      <People title="Students" role="student" sectionId={sectionId} people={by("student")} invites={inv("student")} />
    </main>
  );
}
