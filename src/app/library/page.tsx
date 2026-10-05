import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBooks } from "@/lib/content";
import { canUpload, listUploads } from "@/lib/library";
import UploadForm from "@/app/library/UploadForm";
import { STATUS } from "@/lib/library-status";
import BackButton from "@/components/BackButton";
import WorkspaceShell from "@/components/WorkspaceShell";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Book library" };


export default async function Library() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  if (!(await canUpload(user!.id))) redirect("/?error=" + encodeURIComponent("The library is for faculty and administrators."));
  const [books, uploads] = await Promise.all([listBooks(), listUploads()]);
  const busy = uploads.some((u) => u.status === "checking" || u.status === "publishing");
  return (
    <WorkspaceShell active={user.systemRole === "admin" ? "admin" : "faculty"}
      isAdmin={user.systemRole === "admin"} canTeach displayName={user.displayName}
      links={[{ href: "#books", label: "Books" }, { href: "#upload", label: "Upload a book" }, { href: "#uploads", label: "Upload records" }]}>
      {busy && <meta httpEquiv="refresh" content="10" />}
      <div className="back-strip ui">
        <BackButton fallbackHref={user.systemRole === "admin" ? "/admin" : "/faculty"} />
      </div>
      <header className="workspace-heading"><div><div className="page-kicker ui">Book library</div><h1>Books and uploads</h1><p className="ui">
        Books in the library. Adding a book here does not show it to any student: each class's faculty publish a book to their own class.
      </p></div><Link className="nav-button primary" href="#upload">Upload a book</Link></header>
      <section className="workspace-panel ui" id="books"><h2>Books in the library</h2>
      {books.length === 0 && <p>No books have been added yet.</p>}
      <ul className="ui" style={{ listStyle: "none", padding: 0 }}>
        {/* Spec 15: "Title: Subtitle" when there is one. The id stays in brackets — uploaders type
            ids for new books, so it still earns its place. */}
        {books.map((b) => <li key={b.id} style={{ padding: ".3rem 0", borderBottom: "1px solid var(--rule)" }}><strong>{b.title}{b.subtitle ? `: ${b.subtitle}` : ""}</strong> <span style={{ color: "var(--muted)" }}>({b.id})</span></li>)}
      </ul>
      </section>

      <section className="workspace-panel ui" id="upload"><h2>Upload a book or a new version</h2><p>The intake checks the package before it can be used in classes.</p>
      <UploadForm books={books.map((b) => ({ id: b.id, title: b.title }))} />
      </section>

      <section className="workspace-panel ui" id="uploads"><h2>Upload records</h2>
      {uploads.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>None yet.</p>}
      {uploads.map((u) => {
        const [label, color] = STATUS[u.status] ?? [u.status, "var(--muted)"];
        return (
          <Link key={u.id} className="book-card section-card" href={`/library/${u.id}`}>
            <div>
              <div className="t">{u.bookId} · {u.fileName}</div>
              <div className="s">{u.uploaderName} · {u.createdAt.toISOString().slice(0, 16).replace("T", " ")}{u.registerVersion ? ` · register ${u.registerVersion}` : ""}</div>
            </div>
            <span className="ui" style={{ color }}>{label}</span>
          </Link>
        );
      })}
      </section>
    </WorkspaceShell>
  );
}
