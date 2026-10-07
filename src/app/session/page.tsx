import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { sessionState } from "@/lib/session-entry";
import { enrollByCodeAction, logoutTo } from "@/app/actions";
import WaitingForRelease from "@/components/WaitingForRelease";

/**
 * C2-2 §4 — `/session.html`, where a student lands from the invite an instructor copied out of a
 * sim's facilitator console. Served at `/session`; the `.html` path is a rewrite.
 *
 * Every decision is in `sessionState`. This file renders one of eight outcomes and offers the way
 * forward for each, so that a student who cannot get in is never left reading a dead end.
 */

export const dynamic = "force-dynamic";

// Addendum B §2: an invite link is not for a search engine, and the old platform's session.html
// carried the same meta.
export const metadata: Metadata = {
  title: "Join your session — Flexee",
  robots: { index: false, follow: false },
};

type Params = { sim?: string; session?: string; course?: string };

export default async function SessionEntry({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const viewer = user ? { id: user.id, isAdmin: await isAdmin(user.id) } : null;
  const state = await sessionState(sp, viewer);

  // Step 6 happens as a redirect rather than a link, so a student who is entitled to play never
  // has to press anything. The pass is in the fragment, which browsers do not send to a server.
  if (state.kind === "go") redirect(state.url);

  const code = (sp.session ?? "").trim().toUpperCase();
  const here = `/session?sim=${encodeURIComponent(sp.sim ?? "")}&session=${encodeURIComponent(code)}` +
    (sp.course ? `&course=${encodeURIComponent(sp.course)}` : "");

  const heading = (
    <>
      <p className="ui" style={{ color: "var(--muted)", marginBottom: ".2rem" }}>Flexee · class session</p>
      <h1>Join your session</h1>
      {state.kind !== "invalid" && (
        <p className="ui" style={{ color: "var(--muted)" }}>
          {"className" in state && state.className ? `${state.className} · ` : ""}Session {code}
        </p>
      )}
    </>
  );

  return (
    <main id="main" className="catalog" style={{ maxWidth: "34rem" }}>
      {heading}
      <div aria-live="polite">
        {state.kind === "invalid" && (
          <>
            <h2>Invalid session link</h2>
            <p>Ask your instructor to copy it again.</p>
          </>
        )}

        {state.kind === "no-class" && (
          <>
            <h2>This link does not match a class</h2>
            <p>{state.why}</p>
            <p>Ask your instructor for the current link.</p>
          </>
        )}

        {state.kind === "signed-out" && (
          <>
            <p>Sign in to join this session. Your instructor sees you on their screen once you are in.</p>
            <p className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <Link className="nav-button primary" href={`/login?next=${encodeURIComponent(here)}`}>Sign in and join</Link>
              <Link className="nav-button secondary" href={`/signup?next=${encodeURIComponent(here)}`}>Create an account</Link>
            </p>
            <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
              You will come straight back here. No simulation access code is needed.
            </p>
          </>
        )}

        {state.kind === "instructor" && (
          <>
            <h2>This link is for students</h2>
            <p>
              You are signed in as staff. Students use this link to join the session; you run it from
              the class&rsquo;s Simulations page.
            </p>
            <form action={logoutTo}>
              <input type="hidden" name="next" value={here} />
              <button className="nav-button secondary" type="submit">Sign out and use a student account</button>
            </form>
          </>
        )}

        {state.kind === "not-in-class" && (
          <>
            <h2>You are not in this class yet</h2>
            {state.canJoinWithCode && state.joinCode ? (
              <>
                <p>Join it to continue. Your instructor still decides when you can start the simulation.</p>
                <form action={enrollByCodeAction}>
                  <input type="hidden" name="code" value={state.joinCode} />
                  <input type="hidden" name="next" value={here} />
                  <button className="nav-button primary" type="submit">Join this class</button>
                </form>
              </>
            ) : (
              // Spec 27 B1 decision 2: self-joining is off unless the faculty member turned it on,
              // and the same sentence is used here as on the student dashboard.
              <p>This class isn&rsquo;t accepting students who join with a code. Ask your instructor to add you.</p>
            )}
          </>
        )}

        {state.kind === "waiting" && (
          <>
            <h2>Waiting on your instructor</h2>
            <p>Your instructor must release your access before you can join.</p>
            <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
              Your name is on their screen. No simulation access code is needed.
            </p>
            <WaitingForRelease />
          </>
        )}

        {state.kind === "refused" && (
          <>
            <h2>You cannot join this session</h2>
            <p>{state.message}</p>
          </>
        )}
      </div>
      <p className="ui" style={{ marginTop: "1.5rem" }}><Link href="/student">Back to my classes</Link></p>
    </main>
  );
}
