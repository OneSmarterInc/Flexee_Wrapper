import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { openState } from "@/lib/open-entry";
import WaitingForRelease from "@/components/WaitingForRelease";

/**
 * `/open.html` — where every sim sends a visitor who arrives without a pass. Served at `/open`.
 *
 * Addendum A §5: a visitor signs in, chooses a class, receives a pass and returns to the sim. There
 * is no access-code fallback; the guest route is decided not to be built.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Opening your simulation — Flexee",
  robots: { index: false, follow: false },
};

type Params = { sim?: string; session?: string; section?: string };

export default async function OpenSim({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const viewer = user ? { id: user.id, isAdmin: await isAdmin(user.id) } : null;
  const state = await openState(sp, viewer);

  if (state.kind === "go") redirect(state.url);

  const here = `/open?sim=${encodeURIComponent(sp.sim ?? "")}` +
    (sp.session ? `&session=${encodeURIComponent(sp.session)}` : "") +
    (sp.section ? `&section=${encodeURIComponent(sp.section)}` : "");

  return (
    <main id="main" className="catalog" style={{ maxWidth: "34rem" }}>
      <p className="ui" style={{ color: "var(--muted)", marginBottom: ".2rem" }}>Flexee · simulations</p>
      <h1>Opening your simulation</h1>
      <div aria-live="polite">
        {state.kind === "invalid" && (
          <>
            <h2>This simulation link is not recognised</h2>
            <p>Ask your instructor for the current link.</p>
          </>
        )}

        {state.kind === "signed-out" && (
          <>
            <p>Sign in to open this simulation. You will come straight back here.</p>
            <p className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <Link className="nav-button primary" href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
              <Link className="nav-button secondary" href={`/signup?next=${encodeURIComponent(here)}`}>Create an account</Link>
            </p>
            <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
              No simulation access code is needed.
            </p>
          </>
        )}

        {state.kind === "staff" && (
          <>
            <h2>This link is for students</h2>
            <p>You run a simulation, and release access to it, from the class&rsquo;s Simulations page.</p>
            <p className="ui">
              <Link className="nav-button primary"
                    href={state.sectionId ? `/teach/${state.sectionId}/sims` : "/teach"}>
                {state.sectionId ? "Open that class’s simulations" : "Open my classes"}
              </Link>
            </p>
          </>
        )}

        {state.kind === "not-enrolled" && (
          <>
            <h2>You are not in a class that uses this simulation</h2>
            <p>Your instructor adds students to a class. Ask them to add you, then follow this link again.</p>
          </>
        )}

        {state.kind === "not-added" && (
          <>
            <h2>This simulation is not in your class yet</h2>
            {/* The old platform's distinction, kept: saying "not enrolled" here sends a student to
                check their own enrolment when the class is fine and the sim simply is not in it. */}
            <p>
              You are in <strong>{state.className}</strong>, but this simulation has not been added to
              it. Your instructor adds it from their own class page.
            </p>
          </>
        )}

        {state.kind === "choose" && (
          <>
            <h2>Which class is this for?</h2>
            <p>This simulation is in more than one of your classes, so you choose.</p>
            <ul className="ui" style={{ listStyle: "none", padding: 0, display: "grid", gap: ".5rem" }}>
              {state.classes.map((c) => (
                <li key={c.sectionId}>
                  <a className="nav-button secondary"
                     href={`/sims/launch?sim=${encodeURIComponent(state.sim)}&section=${encodeURIComponent(c.sectionId)}` +
                           (sp.session ? `&session=${encodeURIComponent(sp.session)}` : "")}>
                    {c.name}
                  </a>
                  {!c.released && (
                    <span style={{ color: "var(--muted)", fontSize: ".85rem", marginLeft: ".5rem" }}>
                      waiting on your instructor
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {state.kind === "waiting" && (
          <>
            <h2>Waiting on your instructor</h2>
            <p>
              Your enrolment on <strong>{state.className}</strong> is confirmed, but access to this
              simulation hasn&rsquo;t been released yet.
            </p>
            <WaitingForRelease />
          </>
        )}

        {state.kind === "refused" && (
          <>
            <h2>You cannot open this simulation</h2>
            <p>{state.message}</p>
          </>
        )}
      </div>
      <p className="ui" style={{ marginTop: "1.5rem" }}><Link href="/student">Back to my classes</Link></p>
    </main>
  );
}
