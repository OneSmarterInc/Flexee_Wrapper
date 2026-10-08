import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { simPreviews, sims } from "@/db/schema";
import { isAdmin } from "@/lib/admin";

/**
 * Spec 27 B2 decision 3 — faculty previews: seven days, one per person per sim **ever**, and only
 * an administrator can reset one.
 *
 * Two kinds of row live in `sim_previews`, told apart by `expires_at` alone:
 *
 * - **null** — an administrator's grant, permanent, for reviewing an *unpublished* simulation. A
 *   trial cannot replace it, because an unpublished sim is not in `visibleSims` at all.
 * - **a timestamp** — the self-serve trial. The row stays after it expires, which is the mechanism
 *   behind "once ever": the unique index on (sim_id, user_id) then has something to collide with.
 *
 * What this replaces is not a feature but an absence of one. Until now any faculty member could
 * open any published simulation as `faculty_preview`, indefinitely, with no record beyond a launch
 * row — which is not a preview, it is access. The collapse is in `prepareLaunch`.
 */

export const PREVIEW_DAYS = 7;
const MS = PREVIEW_DAYS * 86_400_000;

export type PreviewState =
  /** No row: a trial may be started. */
  | { kind: "none" }
  /** An administrator's permanent grant. */
  | { kind: "granted"; grantedBy: string | null }
  /** A live trial. */
  | { kind: "live"; expiresAt: Date; daysLeft: number }
  /** A spent trial. The row is why a second one cannot be started. */
  | { kind: "ended"; expiresAt: Date };

/** Whole days remaining, rounded up, so the last few hours still read as "1 day left". */
export const daysLeft = (expiresAt: Date, now = new Date()) =>
  Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));

export function stateOf(
  row: { expiresAt: Date | null; grantedBy: string | null } | undefined | null,
  now = new Date(),
): PreviewState {
  if (!row) return { kind: "none" };
  if (row.expiresAt == null) return { kind: "granted", grantedBy: row.grantedBy };
  if (row.expiresAt.getTime() > now.getTime()) {
    return { kind: "live", expiresAt: row.expiresAt, daysLeft: daysLeft(row.expiresAt, now) };
  }
  return { kind: "ended", expiresAt: row.expiresAt };
}

/** One person's standing with one sim. */
export async function previewState(userId: string, simId: string, now = new Date()) {
  const row = (await db().select({ expiresAt: simPreviews.expiresAt, grantedBy: simPreviews.grantedBy })
    .from(simPreviews).where(and(eq(simPreviews.simId, simId), eq(simPreviews.userId, userId))).limit(1))[0];
  return stateOf(row, now);
}

/** Every preview this person holds, keyed by sim id, for a page that shows the clock. */
export async function previewStates(userId: string, now = new Date()) {
  const rows = await db().select({ simId: simPreviews.simId, expiresAt: simPreviews.expiresAt, grantedBy: simPreviews.grantedBy })
    .from(simPreviews).where(eq(simPreviews.userId, userId));
  return new Map(rows.map((r) => [r.simId, stateOf(r, now)]));
}

/**
 * Start a faculty member's one preview of a simulation.
 *
 * **It refuses rather than succeeding quietly.** The old platform used `ON CONFLICT DO NOTHING`
 * here, which makes a second attempt indistinguishable from a first: the caller is told "ok", the
 * clock is not extended, and nobody learns that the preview was already spent. Every outcome below
 * is therefore an explicit answer, and `insert` is left unguarded so a race loses to the unique
 * index rather than to a check-then-act.
 */
export async function startPreview(userId: string, simId: string): Promise<
  | { ok: true; expiresAt: Date }
  | { ok: false; error: string; because: "no-sim" | "unpublished" | "already-live" | "already-used" | "granted" }
> {
  const sim = (await db().select({ published: sims.published }).from(sims).where(eq(sims.id, simId)).limit(1))[0];
  if (!sim) return { ok: false, error: "No such simulation.", because: "no-sim" };
  // An unpublished sim is not previewable by this route: it needs an administrator's grant, which
  // is the other kind of row and is not time-limited.
  if (!sim.published) {
    return { ok: false, error: "That simulation is not published yet. An administrator can grant you a look at it.", because: "unpublished" };
  }

  const existing = await previewState(userId, simId);
  if (existing.kind === "granted") {
    return { ok: false, error: "You already have an administrator's grant for this simulation, which does not expire.", because: "granted" };
  }
  if (existing.kind === "live") {
    return { ok: false, error: `Your preview of this simulation is already running, with ${existing.daysLeft} day${existing.daysLeft === 1 ? "" : "s"} left.`, because: "already-live" };
  }
  if (existing.kind === "ended") {
    return { ok: false, error: "You have already used your preview of this simulation. Add it to a class to keep using it, or ask an administrator to reset the preview.", because: "already-used" };
  }

  const expiresAt = new Date(Date.now() + MS);
  try {
    await db().insert(simPreviews).values({ simId, userId, expiresAt });
  } catch {
    // Lost a race to the unique index. The row that exists is somebody's — this person's — so the
    // honest answer is the same as "already", not a success.
    return { ok: false, error: "You have already used your preview of this simulation.", because: "already-used" };
  }
  return { ok: true, expiresAt };
}

/**
 * An administrator gives someone a fresh seven days, and it is recorded.
 *
 * Recorded rather than done by deleting the row and letting a new `startPreview` look like a first
 * start: without `reset_at` an administrator could hand out unlimited trials and leave no trace,
 * and "once ever" would be true of the table and false of the world.
 */
export async function resetPreview(adminId: string, simId: string, userId: string): Promise<
  { ok: true; expiresAt: Date } | { ok: false; error: string }
> {
  if (!(await isAdmin(adminId))) return { ok: false, error: "Only administrators reset previews." };
  const row = (await db().select({ expiresAt: simPreviews.expiresAt })
    .from(simPreviews).where(and(eq(simPreviews.simId, simId), eq(simPreviews.userId, userId))).limit(1))[0];
  if (!row) return { ok: false, error: "That person has no preview of this simulation to reset." };
  if (row.expiresAt == null) {
    return { ok: false, error: "That is an administrator's grant, not a preview. It does not expire, so there is nothing to reset." };
  }
  const expiresAt = new Date(Date.now() + MS);
  await db().update(simPreviews)
    .set({ expiresAt, resetAt: new Date(), resetBy: adminId })
    .where(and(eq(simPreviews.simId, simId), eq(simPreviews.userId, userId)));
  return { ok: true, expiresAt };
}

/**
 * Who holds a preview of one simulation, for the administrator's reset. Names and sign-in emails,
 * because an administrator resetting a preview has to be sure which person they mean — and the
 * grant form beside it already takes an email, so this is the same identifier read back.
 */
export async function previewHolders(simId: string, now = new Date()) {
  const { users, identities } = await import("@/db/schema");
  const { eq: e, and: a } = await import("drizzle-orm");
  const rows = await db()
    .select({ userId: simPreviews.userId, name: users.displayName, email: identities.subject,
              expiresAt: simPreviews.expiresAt, grantedBy: simPreviews.grantedBy,
              resetAt: simPreviews.resetAt, resetBy: simPreviews.resetBy })
    .from(simPreviews)
    .innerJoin(users, e(users.id, simPreviews.userId))
    .leftJoin(identities, a(e(identities.userId, users.id), e(identities.provider, "password")))
    .where(e(simPreviews.simId, simId));
  return rows
    .map((r) => ({ ...r, state: stateOf(r, now) }))
    .sort((x, y) => (x.name ?? "").localeCompare(y.name ?? ""));
}
