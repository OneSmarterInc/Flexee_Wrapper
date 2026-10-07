import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { classSims, enrolments, sections, sims } from "@/db/schema";
import { SESSION_CODE, prepareLaunch } from "@/lib/sims";

/**
 * Addendum B §3 and Addendum A §5 — `/open.html`, the direct-link entry.
 *
 * Every sim sends a visitor with no pass here. Unlike `/session.html` this is not covered by C2-2,
 * and unlike the old platform's `open.html` it does **not** fall back to a simulation access code:
 * the guest-code route is decided not to be built, so the way through is to sign in, pick a class
 * and come back.
 *
 * The one thing this does that the Wrapper's own launch cannot: find the class. `/sims/launch`
 * requires a section id, because every link to it is built from a page that already knows one. A
 * direct link from inside a sim knows only the sim, so the eligible classes are worked out here —
 * and when there is more than one, the student is asked. The old platform guessed with
 * `ORDER BY e.paid DESC LIMIT 1`, which silently picks for someone who may have the sim in two
 * classes, and Addendum B §3 says never to guess.
 */

export type OpenClass = { sectionId: string; name: string; released: boolean };
export type OpenState =
  | { kind: "invalid" }
  /** Signed out. The caller turns this into sign-in-and-return. */
  | { kind: "signed-out" }
  /** Staff. Students only, per Addendum B §3; `sectionId` is a class of theirs that has the sim. */
  | { kind: "staff"; sectionId: string | null }
  /** Enrolled in nothing at all — a different sentence from the next one, deliberately. */
  | { kind: "not-enrolled" }
  /** In a class, but no class of theirs uses this sim. */
  | { kind: "not-added"; className: string }
  /** More than one eligible class: ask, never guess. */
  | { kind: "choose"; sim: string; classes: OpenClass[] }
  /** One eligible class, nobody has released them. */
  | { kind: "waiting"; className: string }
  | { kind: "go"; url: string }
  | { kind: "refused"; message: string };

export type Viewer = { id: string; isAdmin: boolean } | null;

export async function openState(
  raw: { sim?: string | null; session?: string | null; section?: string | null },
  viewer: Viewer,
): Promise<OpenState> {
  const simId = (raw.sim ?? "").trim();
  if (!simId) return { kind: "invalid" };
  const sim = (await db().select({ id: sims.id, published: sims.published }).from(sims)
    .where(eq(sims.id, simId)).limit(1))[0];
  if (!sim) return { kind: "invalid" };

  // A session code may ride along, and is passed through to the launch. An ill-formed one is
  // dropped rather than refused: a student arriving from a sim with a stale code should still be
  // able to play, and prepareLaunch would otherwise turn the whole visit into a 400.
  const code = (raw.session ?? "").trim().toUpperCase();
  const session = SESSION_CODE.test(code) ? code : undefined;

  if (!viewer) return { kind: "signed-out" };

  // Every class this person is in, with whether it uses this sim. One query, because the two
  // sentences below differ only in whether any row matched the sim.
  const rows = await db()
    .select({ sectionId: sections.id, name: sections.name, role: enrolments.role,
              releasedAt: enrolments.releasedAt, isDemo: enrolments.isDemo, simId: classSims.simId })
    .from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .leftJoin(classSims, and(eq(classSims.sectionId, sections.id), eq(classSims.simId, simId)))
    .where(and(eq(enrolments.userId, viewer.id), isNull(enrolments.withdrawnAt)))
    .orderBy(asc(sections.name), asc(sections.id));

  // Staff are sent to the class's Simulations page instead, which is where they run a session from.
  const teaching = rows.find((r) => r.role === "instructor" && r.simId != null)
    ?? rows.find((r) => r.role === "instructor");
  if (teaching || viewer.isAdmin) return { kind: "staff", sectionId: teaching?.sectionId ?? null };

  const studentRows = rows.filter((r) => r.role === "student");
  if (studentRows.length === 0) return { kind: "not-enrolled" };

  const eligible = studentRows.filter((r) => r.simId != null);
  if (eligible.length === 0) {
    // The old platform's distinction, kept because it was added for a reason: "Not enrolled" was
    // being reported for both, which sent people to look at the student's enrolment when the real
    // problem was usually that nobody had added the simulation to the course.
    return { kind: "not-added", className: studentRows[0].name };
  }

  if (eligible.length > 1) {
    return {
      kind: "choose", sim: simId,
      classes: eligible.map((r) => ({ sectionId: r.sectionId, name: r.name,
                                      released: r.isDemo === true || r.releasedAt != null })),
    };
  }

  const only = eligible[0];
  // Told apart from the launch's other refusals so it can be waited on, exactly as on /session.
  if (!only.isDemo && !only.releasedAt) return { kind: "waiting", className: only.name };

  const r = await prepareLaunch(viewer.id, simId, only.sectionId, { session });
  if (!r.ok) return { kind: "refused", message: r.error };
  return { kind: "go", url: r.url };
}
