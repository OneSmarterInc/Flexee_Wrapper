import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { visibleSims } from "@/lib/sims";
import { updateSimAction, addSimAction, grantPreviewAction } from "@/app/sim-actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const field = { padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function SimCatalogue({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin/sims");
  if (user!.systemRole !== "admin") redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  const list = await visibleSims(user!.id);
  return (
    <main className="catalog" style={{ maxWidth: "60rem" }}>
      <LogoutButton />
      <p className="ui"><Link href="/admin">← Administration</Link></p>
      <h1>Simulations catalogue</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>RapidSims register themselves here when they start. A new one is unpublished: only administrators, and anyone granted a preview, can see it.</p>
      {sp.ok && <p className="ui" style={{ color: "var(--navy)" }}>{sp.ok}</p>}
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {list.length === 0 && <p className="ui" style={{ color: "var(--muted)" }}>None yet. A sim appears here once its PLATFORM_URL points at this site and it starts.</p>}
      {list.map((s) => (
        <details key={s.id} className="ui" style={{ border: "1px solid var(--rule)", borderRadius: "8px", padding: ".8rem 1rem", margin: ".7rem 0" }}>
          <summary style={{ cursor: "pointer" }}>
            <strong>{s.number ? `${s.number}. ` : ""}{s.title}</strong> <span style={{ color: "var(--muted)" }}>({s.id})</span>{" "}
            <span style={{ color: s.published ? "var(--navy)" : "#b4451f" }}>{s.published ? "published" : "unpublished"}</span>
          </summary>
          <form action={updateSimAction} style={{ display: "grid", gap: ".45rem", marginTop: ".7rem" }}>
            <input type="hidden" name="simId" value={s.id} />
            <input name="title" defaultValue={s.title} style={field} />
            <input name="tagline" defaultValue={s.tagline ?? ""} placeholder="Tagline" style={field} />
            <textarea name="description" defaultValue={s.description ?? ""} rows={3} placeholder="Description" style={field} />
            <input name="launchUrl" defaultValue={s.launchUrl ?? ""} placeholder="https://… (the sim's address)" style={field} />
            <label><input type="checkbox" name="published" defaultChecked={s.published} /> Published — faculty can add it to classes</label>
            <button className="nav-button primary" type="submit">Save</button>
            <span style={{ color: "var(--muted)" }}>Wording you change here is kept when the sim re-registers, until it reports a new scenario.</span>
          </form>
          <form action={grantPreviewAction} style={{ display: "flex", gap: ".5rem", marginTop: ".6rem", flexWrap: "wrap" }}>
            <input type="hidden" name="simId" value={s.id} />
            <input name="email" type="email" placeholder="Let someone see it before publication: their email" style={{ ...field, minWidth: "22rem" }} />
            <button className="nav-button secondary" type="submit">Grant preview</button>
          </form>
        </details>
      ))}
      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>Add a sim by hand</h2>
      <form action={addSimAction} className="ui" style={{ display: "grid", gap: ".45rem", maxWidth: "36rem" }}>
        <input name="id" placeholder="Sim id, exactly as the sim uses it (e.g. rapid-01-disaster)" required style={field} />
        <input name="title" placeholder="Title" required style={field} />
        <input name="launchUrl" placeholder="https://… (the sim's address)" required style={field} />
        <button className="nav-button secondary" type="submit">Add, unpublished</button>
      </form>
    </main>
  );
}
