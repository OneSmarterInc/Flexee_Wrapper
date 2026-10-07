import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { classSims, enrolments, sections } from "@/db/schema";
import { isSessionSim } from "@/lib/session-sims";
import { SESSION_CODE, prepareLaunch } from "@/lib/sims";

/**
 * C2-2 §4 — what `/session.html` should do, decided on the server.
 *
 * Split from the page so the eight steps can be tested as values rather than scraped out of
 * markup, and so the page has no decisions of its own. The last line of §4 is the rule this obeys:
 * "The page decides nothing the launch doesn't: access is still enforced by the launch, never by
 * the page." Every refusal below either comes from prepareLaunch or stops before it for a reason
 * the launch could not express — a code that is not a code, a class the link names wrongly.
 *
 * One clause of §4 step 2 cannot be honoured: "and it is not archived". The Wrapper has no
 * archived-class concept — `sections` has no such column — so there is nothing to test. Noted
 * rather than silently skipped, because C2-2 §2 check 4 says the same thing about the roster.
 */

export type SessionState =
  /** Step 1. The link itself is wrong, so there is nothing to look up. */
  | { kind: "invalid" }
  /** Step 2. A class was named and it does not fit: no such class, or the sim is not in it. */
  | { kind: "no-class"; why: string }
  /** Step 3. */
  | { kind: "signed-out"; className: string | null; canJoinWithCode: boolean }
  /** Step 4. */
  | { kind: "instructor"; className: string | null }
  /** Step 5. */
  | { kind: "not-in-class"; className: string | null; canJoinWithCode: boolean; joinCode: string | null }
  /** Step 7. Enrolled, but nobody has released them yet. */
  | { kind: "waiting"; className: string | null }
  /** Step 6. */
  | { kind: "go"; url: string }
  /** Step 8. Any other refusal, in the launch's own words. */
  | { kind: "refused"; message: string };

export type Viewer = { id: string; isAdmin: boolean } | null;

export async function sessionState(
  raw: { sim?: string | null; session?: string | null; course?: string | null },
  viewer: Viewer,
): Promise<SessionState> {
  const sim = (raw.sim ?? "").trim();
  const code = (raw.session ?? "").trim().toUpperCase();

  // Step 1. Checked before anything is read from the database, so a mistyped link costs nothing
  // and reveals nothing about which classes or sims exist.
  if (!isSessionSim(sim) || !SESSION_CODE.test(code)) return { kind: "invalid" };

  // Step 2. `course` is on current links and absent on older ones.
  const courseId = (raw.course ?? "").trim() || null;
  let section: { id: string; name: string; joinCode: string | null; joinCodeEnabled: boolean } | null = null;
  if (courseId) {
    section = (await db().select({ id: sections.id, name: sections.name, joinCode: sections.joinCode,
                                   joinCodeEnabled: sections.joinCodeEnabled })
      .from(sections).where(eq(sections.id, courseId)).limit(1))[0] ?? null;
    if (!section) return { kind: "no-class", why: "That class could not be found." };
    const attached = (await db().select({ simId: classSims.simId }).from(classSims)
      .where(and(eq(classSims.sectionId, courseId), eq(classSims.simId, sim))).limit(1))[0];
    if (!attached) {
      return { kind: "no-class", why: "That simulation is not part of this class." };
    }
  }

  const className = section?.name ?? null;
  const canJoinWithCode = section?.joinCodeEnabled === true;

  // Step 3.
  if (!viewer) return { kind: "signed-out", className, canJoinWithCode };

  // Step 4. An administrator lands here too: this is a student link either way, and signing out is
  // the way through it.
  const mine = courseId
    ? (await db().select({ role: enrolments.role, withdrawnAt: enrolments.withdrawnAt, releasedAt: enrolments.releasedAt,
                           isDemo: enrolments.isDemo })
        .from(enrolments).where(and(eq(enrolments.sectionId, courseId), eq(enrolments.userId, viewer.id))).limit(1))[0] ?? null
    : null;
  if (mine?.role === "instructor" || (viewer.isAdmin && !mine)) return { kind: "instructor", className };

  // Step 5. No class in the link, or a class this student is not in. Both need the same offer, and
  // without a class id there is nothing to join except by code.
  if (!courseId || !mine) {
    return { kind: "not-in-class", className, canJoinWithCode, joinCode: section?.joinCode ?? null };
  }

  // Step 7, before the launch, because the launch's refusal is the same 403 as several others and
  // this one has to be told apart to be waited on.
  if (!mine.withdrawnAt && !mine.isDemo && !mine.releasedAt) return { kind: "waiting", className };

  // Step 6, and step 8 for anything else. mode stays "play": a student joining a session is
  // playing, and the code is what puts them in the room.
  const r = await prepareLaunch(viewer.id, sim, courseId, { session: code });
  if (!r.ok) return { kind: "refused", message: r.error };
  return { kind: "go", url: r.url };
}
