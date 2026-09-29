import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listBooks } from "@/lib/content";
import { canUpload, listUploads } from "@/lib/library";
import UploadForm from "@/app/library/UploadForm";
import { STATUS } from "@/lib/library-status";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function Library() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  if (!(await canUpload(user!.id))) redirect("/?error=" + encodeURIComponent("The library is for faculty and administrators."));
  const [books, uploads] = await Promise.all([listBooks(), listUploads()]);
  const busy = uploads.some((u) => u.status === "checking" || u.status === "publishing");
  return (
    <main className="catalog teach-home">
      {busy && <meta httpEquiv="refresh" content="10" />}
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref="/teach" />
        <Link className="nav-button ghost" href="/teach">My teaching</Link>
      </div>
      <div className="page-kicker ui">Library</div>
      <h1>Books</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Books in the library. Adding a book here does not show it to any student: each class's faculty publish a book to their own class.
      </p>
      <ul className="ui" style={{ listStyle: "none", padding: 0 }}>
        {books.map((b) => <li key={b.id} style={{ padding: ".3rem 0", borderBottom: "1px solid var(--rule)" }}><strong>{b.title}</strong> <span style={{ color: "var(--muted)" }}>({b.id})</span></li>)}
      </ul>

      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Upload a book or a new version</h2>
      <UploadForm books={books.map((b) => ({ id: b.id, title: b.title }))} />

      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Uploads</h2>
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
    </main>
  );
}
