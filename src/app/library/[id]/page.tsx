import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canUpload, canApprove, getUpload, mayDismiss, canDismiss } from "@/lib/library";
import { getBook } from "@/lib/content";
import { approveUploadAction, dismissUploadAction, retryIntakeAction } from "@/app/library/actions";
import { STATUS } from "@/lib/library-status";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import type { Metadata } from "next";
import { displayBookId } from "@/lib/book-id";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "A book upload" };


export default async function UploadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=/library/${id}`);
  if (!(await canUpload(user!.id))) redirect("/?error=" + encodeURIComponent("The library is for faculty and administrators."));
  const u = await getUpload(id);
  if (!u) redirect("/library");
  const [label, color] = STATUS[u!.status] ?? [u!.status, "var(--muted)"];
  const working = u!.status === "checking" || u!.status === "publishing";
  const done = u!.status === "published";
  // Spec 22 §5: the book's real title, once there is a book to read it from. Before that the id is
  // all there is, because the manifest arrives with the book.
  const book = await getBook(u!.bookId).catch(() => null);
  const mayApprove = u!.status === "ready" && (await canApprove(user!.id, u!));
  return (
    <main id="main" className="catalog teach-home" style={{ maxWidth: "52rem" }}>
      {working && <meta httpEquiv="refresh" content="10" />}
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref="/library" />
        <Link className="nav-button ghost" href="/library">Library</Link>
      </div>
      <div className="page-kicker ui">Library upload</div>
      <h1>{book?.title ?? displayBookId(u!.bookId)}</h1>
      <p className="ui">{displayBookId(u!.bookId)} · {u!.fileName} · {(u!.sizeBytes / 1e6).toFixed(1)} MB{u!.registerVersion ? ` · register ${u!.registerVersion}` : ""}</p>
      {/* Spec 22 §5: a finished state that reads as finished. The old page kept saying "Adding the
          book to the library" from the redirect's message while the status had already moved on,
          and never offered a way back. */}
      {done ? (
        <div className="workspace-alert ui" role="status">
          <strong>Done: in the library</strong>
          {u!.publishedAt ? ` · ${u!.publishedAt.toISOString().slice(0, 10)}` : ""}
          <div style={{ color: "var(--muted)", fontSize: ".88rem", marginTop: ".2rem" }}>
            No student sees it until a class's faculty publish it to their class.
          </div>
          <div style={{ marginTop: ".6rem" }}>
            <Link className="nav-button primary" href="/library">Back to library</Link>
          </div>
        </div>
      ) : (
        <p className="ui" style={{ color, fontWeight: 600 }}>{label}{working ? " — this page refreshes itself" : ""}</p>
      )}
      {sp.ok && !done && <p className="ui" role="status" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      {u!.message && <p className="ui" role={u!.status === "failed" ? "alert" : undefined}>{u!.message}</p>}
      {/* Spec 22 §6: the start failed, which is a different thing from the book being wrong. The
          button is here rather than only in the message, because "try again" with nothing to click
          is advice, not a remedy. */}
      {u!.status === "failed" && (await canDismiss(user!.id, u!)) && (
        <form action={retryIntakeAction} className="ui" style={{ margin: ".4rem 0 1rem" }}>
          <input type="hidden" name="id" value={u!.id} />
          <button className="nav-button primary" type="submit">Retry</button>
          <span style={{ color: "var(--muted)", marginLeft: ".7rem", fontSize: ".88rem" }}>
            Starts the check again on the file you already uploaded.
          </span>
        </form>
      )}
      {u!.runUrl && <p className="ui"><a href={u!.runUrl} target="_blank" rel="noreferrer">Intake run log →</a></p>}
      {mayApprove && (
        <form action={approveUploadAction} className="ui" style={{ margin: "1rem 0" }}>
          <input type="hidden" name="id" value={u!.id} />
          <button className="nav-button primary" type="submit">Add to library</button>
          <span style={{ color: "var(--muted)", marginLeft: ".8rem" }}>No student sees it until a class's faculty publish it.</span>
        </form>
      )}
      {u!.status === "ready" && !mayApprove && <p className="ui" style={{ color: "var(--muted)" }}>Ready. The person who uploaded it, or an administrator, can add it to the library.</p>}
      {/* Spec 22 §2: the same action as on the list, where a person who has just read the report is
          most likely to want it. */}
      {mayDismiss(u!.status) && !u!.dismissedAt && (await canDismiss(user!.id, u!)) && (
        <form action={dismissUploadAction} className="ui" style={{ margin: ".4rem 0 1rem" }}>
          <input type="hidden" name="id" value={u!.id} />
          <button className="nav-button ghost" type="submit">Dismiss this record</button>
          <span style={{ color: "var(--muted)", marginLeft: ".7rem", fontSize: ".88rem" }}>
            Hides it from the library list. The uploaded file is untouched.
          </span>
        </form>
      )}
      {u!.report && (
        <>
          <h2 style={{ color: "var(--navy)" }}>Intake report</h2>
          <pre className="ui" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem", fontSize: ".85rem", maxHeight: "70vh", overflow: "auto" }}>{u!.report}</pre>
        </>
      )}
    </main>
  );
}
