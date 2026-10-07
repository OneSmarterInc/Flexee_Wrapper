import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { enrolments, sections, users } from "@/db/schema";
import { verifyPass } from "@/lib/launchpass";
import { isRosterSim, participantId } from "@/lib/session-sims";

/**
 * C2-2 §2 — the read-only class roster a sim's facilitator console asks for.
 *
 * Server to server. The instructor's own launch pass is the only credential: there is no cookie and
 * no key, which is why every fact in the pass is re-checked against the database below rather than
 * trusted. A valid signature proves the Wrapper issued the pass; it does not prove the pass still
 * describes someone who may see this class's students.
 *
 * Reading the roster never releases access, never enrols anyone and never starts a run. The sims
 * call it repeatedly while a console is open.
 */

export type RosterStudent = { participantId: string; name: string; accessReleased: boolean };
export type RosterAnswer =
  | { status: 200; body: { students: RosterStudent[] } }
  | { status: 401 | 403 | 503; body: { error: string } };

const refuse = (status: 401 | 403 | 503, error: string): RosterAnswer => ({ status, body: { error } });

export async function sessionRoster(token: unknown, courseId: unknown): Promise<RosterAnswer> {
  // Checks 1 and 2 (C2-2 §2). Both answer 401 with the same body on purpose: a console that is
  // told *which* of these failed learns about a class it has not proved it may see.
  let pass: Record<string, any> | null = null;
  try { pass = verifyPass(token); } catch { pass = null; }   // a missing LAUNCH_SECRET reads as unauthorised
  if (!pass) return refuse(401, "faculty_authorization_required");
  if (!isRosterSim(pass.sim) || pass.role !== "faculty" || !pass.sub || pass.mode !== "session") {
    // `faculty_preview` is excluded by the exact comparison, which matters: a preview pass is
    // issued for a sim the instructor has not adopted, and it must not open a roster.
    return refuse(401, "faculty_authorization_required");
  }

  // Check 3. Compared to the pass rather than merely present, so a console cannot ask about one
  // class holding a pass for another.
  const id = typeof courseId === "string" ? courseId : "";
  if (!id || id.length > 200 || pass.course !== id) return refuse(403, "session_course_mismatch");

  try {
    // Check 4, every part of it from the database. C2-2 v1.1 dropped the old platform's
    // "account not disabled" and its administrator clause: the Wrapper has no disabled-account
    // concept, and a Wrapper session pass is only ever issued to someone who teaches the class, so
    // the administrator branch could never fire. What replaces them is the instructor's own
    // enrolment having to be live — a withdrawn instructor keeps no access to anything else, and
    // should keep none here.
    const teacher = (await db().select({ id: users.id }).from(users).where(eq(users.id, String(pass.sub))).limit(1))[0];
    if (!teacher) return refuse(403, "course_roster_forbidden");

    const section = (await db().select({ id: sections.id }).from(sections).where(eq(sections.id, id)).limit(1))[0];
    if (!section) return refuse(403, "course_roster_forbidden");

    const teaches = (await db().select({ id: enrolments.id }).from(enrolments)
      .where(and(eq(enrolments.sectionId, id), eq(enrolments.userId, String(pass.sub)),
                 eq(enrolments.role, "instructor"), isNull(enrolments.withdrawnAt))).limit(1))[0];
    if (!teaches) return refuse(403, "course_roster_forbidden");

    // Check 5. Imported here rather than at the top because classSims lives with the sims.
    const { classSims } = await import("@/db/schema");
    const attached = (await db().select({ simId: classSims.simId }).from(classSims)
      .where(and(eq(classSims.sectionId, id), eq(classSims.simId, String(pass.sim)))).limit(1))[0];
    if (!attached) return refuse(403, "simulation_not_on_course");

    const rows = await db()
      .select({ userId: enrolments.userId, name: users.displayName,
                releasedAt: enrolments.releasedAt, isDemo: enrolments.isDemo })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(and(eq(enrolments.sectionId, id), eq(enrolments.role, "student"), isNull(enrolments.withdrawnAt)))
      .orderBy(asc(users.displayName), asc(enrolments.userId));

    // Three fields and nothing else: no email, no grades, and never the faculty member's release
    // note. Sorted by name case-insensitively then by id, which the database's own collation does
    // not guarantee, so it is done here where the rule is visible.
    const students = rows
      .map((r) => ({
        participantId: participantId(r.userId),
        name: r.name ?? "",
        // C2-2 v1.1: the Demo Student is listed as an ordinary row and is always released, so an
        // instructor testing a session can place it in a team. It matches the launch gate, which
        // never checks a demo's release either.
        accessReleased: r.isDemo === true || r.releasedAt != null,
      }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
                      a.participantId.localeCompare(b.participantId));

    return { status: 200, body: { students } };
  } catch (e: any) {
    // Never the message: it can carry a connection string. The console shows the roster as
    // unavailable and live play continues, which is what the sims are built to do.
    console.error("session roster lookup failed", e?.code || "lookup_error");
    return refuse(503, "course_roster_unavailable");
  }
}
