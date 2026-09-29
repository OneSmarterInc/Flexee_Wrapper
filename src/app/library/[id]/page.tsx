import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canUpload, canApprove, getUpload } from "@/lib/library";
import { approveUploadAction } from "@/app/library/actions";
import { STATUS } from "@/lib/library-status";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function UploadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await currentUser();
  if (!user) redirect(`/login?next=/library/${id}`);
  if (!(await canUpload(user!.id))) redirect("/?error=" + encodeURIComponent("The library is for faculty and administrators."));
  const u = await getUpload(id);
  if (!u) redirect("/library");
  const [label, color] = STATUS[u!.status] ?? [u!.status, "var(--muted)"];
  const working = u!.status === "checking" || u!.status === "publishing";
  const mayApprove = u!.status === "ready" && (await canApprove(user!.id, u!));
  return (
    <main className="catalog teach-home" style={{ maxWidth: "52rem" }}>
      {working && <meta httpEquiv="refresh" content="10" />}
      <LogoutButton />
      <div className="back-strip ui">
        <BackButton fallbackHref="/library" />
        <Link className="nav-button ghost" href="/library">Library</Link>
      </div>
      <div className="page-kicker ui">Library upload</div>
      <h1>{u!.bookId}</h1>
      <p className="ui">{u!.fileName} · {(u!.sizeBytes / 1e6).toFixed(1)} MB{u!.registerVersion ? ` · register ${u!.registerVersion}` : ""}</p>
      <p className="ui" style={{ color, fontWeight: 600 }}>{label}{working ? " — this page refreshes itself" : ""}</p>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {u!.message && <p className="ui">{u!.message}</p>}
      {u!.runUrl && <p className="ui"><a href={u!.runUrl} target="_blank" rel="noreferrer">Intake run log →</a></p>}
      {mayApprove && (
        <form action={approveUploadAction} className="ui" style={{ margin: "1rem 0" }}>
          <input type="hidden" name="id" value={u!.id} />
          <button className="nav-button primary" type="submit">Add to library</button>
          <span style={{ color: "var(--muted)", marginLeft: ".8rem" }}>No student sees it until a class's faculty publish it.</span>
        </form>
      )}
      {u!.status === "ready" && !mayApprove && <p className="ui" style={{ color: "var(--muted)" }}>Ready. The person who uploaded it, or an administrator, can add it to the library.</p>}
      {u!.report && (
        <>
          <h2 style={{ color: "var(--navy)" }}>Intake report</h2>
          <pre className="ui" style={{ whiteSpace: "pre-wrap", border: "1px solid var(--rule)", borderRadius: "8px", padding: "1rem", fontSize: ".85rem", maxHeight: "70vh", overflow: "auto" }}>{u!.report}</pre>
        </>
      )}
    </main>
  );
}
