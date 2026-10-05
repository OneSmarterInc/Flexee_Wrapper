import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canUpload, listUploads, dismissableFor } from "@/lib/library";
import { libraryShelf, retireCost } from "@/lib/retire";
import { retireBookAction, restoreBookAction, dismissUploadAction, dismissAllAction } from "@/app/library/actions";
import UploadForm from "@/app/library/UploadForm";
import { STATUS } from "@/lib/library-status";
import BackButton from "@/components/BackButton";
import WorkspaceShell from "@/components/WorkspaceShell";
import type { Metadata } from "next";
import { displayBookId } from "@/lib/book-id";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Book library" };


export default async function Library({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; retire?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  if (!(await canUpload(user!.id))) redirect("/?error=" + encodeURIComponent("The library is for faculty and administrators."));
  const admin = user!.systemRole === "admin";
  const [shelf, uploads, dismissable, sp] = await Promise.all([
    libraryShelf(), listUploads(), dismissableFor(user!.id), searchParams,
  ]);
  const dismissableIds = new Set(dismissable);
  const live = shelf.filter((s) => !s.retired);
  const retired = shelf.filter((s) => s.retired);
  // The confirmation step. ?retire=<id> renders the count and a pair of buttons, so the count is
  // read before the action rather than after it, and with no script at all.
  const asked = sp.retire && admin ? live.find((s) => s.book.id === sp.retire) : null;
  const cost = asked ? await retireCost(asked.book.id) : null;
  const pickable = live.map((s) => s.book);
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
      {sp.ok && <p className="workspace-alert ui" role="status">{sp.ok}</p>}
      {sp.error && <p className="workspace-alert error ui" role="alert">{sp.error}</p>}

      <section className="workspace-panel ui" id="books"><h2>Books in the library</h2>
      {live.length === 0 && <p>No books have been added yet.</p>}

      {asked && cost && (
        <div className="workspace-alert ui" role="group" aria-labelledby="retire-heading" style={{ marginBottom: "1rem" }}>
          <h3 id="retire-heading" style={{ margin: "0 0 .3rem", fontSize: "1rem" }}>Retire {asked.book.title}?</h3>
          <p className="ui" style={{ margin: ".2rem 0" }}>{cost.sentence}</p>
          <p className="ui" style={{ margin: ".2rem 0", color: "var(--muted)", fontSize: ".88rem" }}>
            It disappears from the forms that choose a book for a class or an upload, and from the
            list an LMS offers. Nothing is deleted and you can restore it here.
          </p>
          <div className="fx-dialog-actions" style={{ justifyContent: "flex-start" }}>
            <form action={retireBookAction}>
              <input type="hidden" name="bookId" value={asked.book.id} />
              <button className="nav-button danger" type="submit">Retire {displayBookId(asked.book.id)}</button>
            </form>
            <Link className="nav-button ghost" href="/library#books">Cancel</Link>
          </div>
        </div>
      )}

      <ul className="ui" style={{ listStyle: "none", padding: 0 }}>
        {/* Spec 15: "Title: Subtitle" when there is one. The id stays in brackets — uploaders type
            ids for new books, so it still earns its place. */}
        {live.map((s) => (
          <li key={s.book.id} className="library-row" style={{ padding: ".4rem 0", borderBottom: "1px solid var(--rule)" }}>
            <span><strong>{s.book.title}{s.book.subtitle ? `: ${s.book.subtitle}` : ""}</strong>{" "}
              <span style={{ color: "var(--muted)" }}>({displayBookId(s.book.id)})</span>
              {s.classes > 0 && <span style={{ color: "var(--muted)", fontSize: ".85rem" }}> · {s.classes} class{s.classes === 1 ? "" : "es"}</span>}
            </span>
            {admin && (
              <Link className="nav-button ghost" href={`/library?retire=${encodeURIComponent(s.book.id)}#books`}>
                Retire<span className="visually-hidden"> {s.book.title}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
      </section>

      {/* Admin-only (decision 5): faculty neither retire a book nor see the retired ones. */}
      {admin && retired.length > 0 && (
        <section className="workspace-panel ui" id="retired"><h2>Retired</h2>
        <p className="ui" style={{ color: "var(--muted)" }}>
          Out of the forms that choose a book, and out of the list an LMS offers. Still readable by
          every class already using it.
        </p>
        <ul className="ui" style={{ listStyle: "none", padding: 0 }}>
          {retired.map((s) => (
            <li key={s.book.id} className="library-row" style={{ padding: ".4rem 0", borderBottom: "1px solid var(--rule)" }}>
              <span><strong>{s.book.title}</strong> <span style={{ color: "var(--muted)" }}>({displayBookId(s.book.id)})</span>
                <span style={{ color: "var(--muted)", fontSize: ".85rem" }}>
                  {" "}· retired {s.retired!.retiredAt.toISOString().slice(0, 10)}
                  {s.classes > 0 ? ` · ${s.classes} class${s.classes === 1 ? "" : "es"} still using it` : ""}
                </span>
              </span>
              <form action={restoreBookAction}>
                <input type="hidden" name="bookId" value={s.book.id} />
                <button className="nav-button secondary" type="submit">
                  Restore<span className="visually-hidden"> {s.book.title}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        </section>
      )}

      <section className="workspace-panel ui" id="upload"><h2>Upload a book or a new version</h2><p>The intake checks the package before it can be used in classes.</p>
      <UploadForm books={pickable.map((b) => ({ id: b.id, title: b.title }))} />
      </section>

      <section className="workspace-panel ui" id="uploads"><h2>Upload records</h2>
      {uploads.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>None yet.</p>}

      {/* The count comes from the same rule that will do the hiding, so the sentence and the act
          cannot disagree (Spec 22 §2). */}
      {dismissable.length > 0 && (
        <form action={dismissAllAction} className="ui" style={{ margin: "0 0 .9rem" }}>
          <input type="hidden" name="count" value={dismissable.length} />
          <button className="nav-button secondary" type="submit">
            Dismiss all not added ({dismissable.length})
          </button>
          <span style={{ color: "var(--muted)", marginLeft: ".7rem", fontSize: ".88rem" }}>
            Hides the records. No uploaded file is touched.
          </span>
        </form>
      )}

      {uploads.map((u) => {
        const [label, color] = STATUS[u.status] ?? [u.status, "var(--muted)"];
        return (
          <div key={u.id} className="library-row" style={{ gap: ".6rem" }}>
            <Link className="book-card section-card" href={`/library/${u.id}`} style={{ flex: 1 }}>
              <div>
                <div className="t">{displayBookId(u.bookId)} · {u.fileName}</div>
                <div className="s">{u.uploaderName} · {u.createdAt.toISOString().slice(0, 16).replace("T", " ")}{u.registerVersion ? ` · register ${u.registerVersion}` : ""}</div>
              </div>
              <span className="ui" style={{ color }}>{label}</span>
            </Link>
            {dismissableIds.has(u.id) && (
              <form action={dismissUploadAction}>
                <input type="hidden" name="id" value={u.id} />
                <button className="nav-button ghost" type="submit">
                  Dismiss<span className="visually-hidden"> the {displayBookId(u.bookId)} record of {u.fileName}</span>
                </button>
              </form>
            )}
          </div>
        );
      })}
      </section>
    </WorkspaceShell>
  );
}
