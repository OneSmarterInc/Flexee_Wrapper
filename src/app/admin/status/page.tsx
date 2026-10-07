import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import WorkspaceShell from "@/components/WorkspaceShell";
import BackButton from "@/components/BackButton";
import { statusCache, STATE_WORDS, overall, agoWords, type Result } from "@/lib/status/framework";
import { allChecks } from "@/lib/status/checks";
import { classPageTitle } from "@/lib/page-title";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Status" };

/**
 * Spec 24 §1: one line per dependency, in plain words.
 *
 * Admins only (rule 1). Every state is stated as a word, never carried by colour alone (rule 8) —
 * the colour is a tint behind a word that already says the same thing, so the page reads correctly
 * in monochrome and to a screen reader.
 *
 * The caveats are not footnotes. Each line says what its check cannot prove, because the whole
 * reason this page exists is that somebody read a green tick and assumed more than it meant.
 */
const TINT: Record<string, string> = {
  ok: "var(--ok)",
  attention: "var(--danger)",
  down: "var(--danger)",
  "not-configured": "var(--muted)",
  unknown: "var(--muted)",
};

function StateWord({ state }: { state: Result["state"] }) {
  return (
    <strong style={{ color: TINT[state] ?? "var(--ink)", whiteSpace: "nowrap" }}>
      {STATE_WORDS[state]}
    </strong>
  );
}

export default async function StatusPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin/status");
  // Rule 1: faculty and students are refused, not merely unlinked.
  if (user!.systemRole !== "admin") {
    redirect("/?error=" + encodeURIComponent("That page is for administrators."));
  }
  const sp = await searchParams;
  const snapshot = await statusCache.get(allChecks(), { force: sp.fresh === "1" });
  const checks = allChecks();
  const worst = overall(snapshot.results);
  const age = statusCache.ageMs();

  return (
    <WorkspaceShell active="admin" isAdmin canTeach displayName={user!.displayName}
      links={[{ href: "/admin", label: "Administration" }, { href: "/library", label: "Book library" }]}>
      <div className="back-strip ui"><BackButton fallbackHref="/admin" /></div>
      <header className="workspace-heading">
        <div>
          <div className="page-kicker ui">Administration</div>
          <h1>Status</h1>
          <p className="ui">
            What the Wrapper depends on, and whether it is working. Every line says what its check
            proves and what it does not — a line reading OK is not a promise that everything
            downstream of it works.
          </p>
        </div>
      </header>

      <p className="ui" role="status">
        Overall: <StateWord state={worst} />. Last checked {agoWords(age)}
        {snapshot.cached ? ", from the cache" : ""}. Checks run again on their own every ten minutes.
      </p>

      <form action="/admin/status" method="get" className="ui" style={{ margin: "0 0 1rem" }}>
        <input type="hidden" name="fresh" value="1" />
        <button className="nav-button secondary" type="submit">Check now</button>
        <span style={{ color: "var(--muted)", marginLeft: ".7rem", fontSize: ".88rem" }}>
          Runs every check again, ignoring the cache.
        </span>
      </form>

      <div style={{ overflowX: "auto" }}>
        <table className="ui status-table" style={{ borderCollapse: "collapse", width: "100%" }}>
          <caption>Each dependency, its state, and what the check can and cannot tell you</caption>
          <thead>
            <tr>
              <th scope="col">Dependency</th>
              <th scope="col">State</th>
              <th scope="col">What the check found</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => {
              const r = snapshot.results[c.id];
              if (!r) return null;
              return (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td><StateWord state={r.state} /></td>
                  <td>
                    <div>{r.detail}</div>
                    {r.facts && r.facts.length > 0 && (
                      <dl className="status-facts">
                        {/* A <dl> may group a pair in a <div> and in nothing else — a <span> here
                            is invalid and axe calls it out as definition-list and dlitem. */}
                        {r.facts.map((f) => (
                          <div key={f.label}>
                            <dt>{f.label}</dt><dd>{f.text}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {r.caveat && (
                      <p className="status-caveat">
                        <span className="visually-hidden">What this cannot prove: </span>
                        {r.caveat}
                      </p>
                    )}
                    {typeof r.ms === "number" && (
                      <p className="status-caveat">Checked in {r.ms} ms.</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>What no check here can tell you</h2>
      <ul className="ui">
        <li>
          <strong>Whether a book upload will start.</strong> The intake runner line proves the token
          is alive, the repository resolves and the workflow exists under its name. Starting a
          workflow needs GitHub&apos;s <em>Actions: write</em> permission and reading one does not, so
          a token with read access alone passes every check on this page and still fails an upload.
          Only a real upload tests that.
        </li>
        <li>
          <strong>Whether an email will arrive.</strong> Resend answering is not a message sent.
          Only a real send proves the domain is verified and the address accepted. Email needs
          <em> both</em> a sending key and a from-address; with either missing nothing is sent.
        </li>
        <li>
          <strong>Whether the assistant&apos;s provider key still works.</strong> Nothing here is
          sent to the provider, so a revoked key reads as set.
        </li>
        <li>
          <strong>Whether the scheduled job has ever run.</strong> That line reads one setting.
        </li>
        <li>
          <strong>How anything behaves under load.</strong> Every check is one request on an idle
          system.
        </li>
      </ul>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".9rem" }}>
        Each check runs on its own with a five-second limit, so one failure never hides the others.
        Results are held for ten minutes per server instance, which is why two loads a moment apart
        can show different times. <Link href="/library">The book library</Link> is where an upload
        is started.
      </p>
    </WorkspaceShell>
  );
}
