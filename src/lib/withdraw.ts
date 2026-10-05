import "server-only";
import { and, eq, inArray, isNull, isNotNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { enrolments } from "@/db/schema";
import { canManageClass } from "@/lib/publish";
import { logAction } from "@/lib/class-actions";

/**
 * Withdrawal (Spec 19 §1): soft, reversible, and the opposite of Remove.
 *
 * Remove deletes a student's work. Withdrawal keeps every record and takes away the two things a
 * former student should not have: access to the class, and a place in its numbers. The reports
 * before this build counted where that has to hold — nine entitlement gates, fifteen counting
 * sites, four exports and five bulk actions — and this file is the single predicate all of them
 * use, so there is one definition of "still in this class".
 *
 * It differs from Spec 18's demo flag in two ways: it blocks access, which a demo flag never did,
 * and it has to **survive** `enrollByCode`, `syncRoster` and a D2L re-import putting the row back
 * (decision 3). Restoring is a deliberate act by a member of staff.
 */

/** The condition every count, export and bulk action adds. */
export const activeEnrolment = (): SQL => isNull(enrolments.withdrawnAt) as SQL;
export const withdrawnEnrolment = (): SQL => isNotNull(enrolments.withdrawnAt) as SQL;

/** A student still taking part: a student enrolment that has not been withdrawn. */
export const activeStudent = (): SQL =>
  and(eq(enrolments.role, "student"), activeEnrolment()) as SQL;

/** What a withdrawn student is told, wherever they meet the class (decision 1). */
export const WITHDRAWN_NOTICE =
  "You are no longer enrolled in this class. Your work is kept; ask your instructor.";

export type WithdrawResult =
  | { ok: true; changed: number; skipped: number }
  | { ok: false; error: string };

async function setWithdrawn(
  actorId: string, sectionId: string, enrolmentIds: string[], withdraw: boolean,
): Promise<WithdrawResult> {
  if (!(await canManageClass(actorId, sectionId))) {
    return { ok: false, error: "Only this class's faculty or an administrator can do that." };
  }
  const ids = [...new Set(enrolmentIds.filter(Boolean))];
  if (!ids.length) return { ok: false, error: "Nobody was selected." };
  // Re-checked against this class, as everything in §1 is: nothing the page sent is trusted.
  const rows = await db().select({ id: enrolments.id, role: enrolments.role, withdrawnAt: enrolments.withdrawnAt })
    .from(enrolments).where(and(eq(enrolments.sectionId, sectionId), inArray(enrolments.id, ids)));
  if (rows.length !== ids.length) return { ok: false, error: "Some of those students are not in this class." };
  // Faculty are not withdrawn; removing a member of staff is what Remove is for.
  if (rows.some((r) => r.role !== "student")) {
    return { ok: false, error: "Only students can be withdrawn. Remove a member of staff instead." };
  }
  const todo = rows.filter((r) => (withdraw ? r.withdrawnAt == null : r.withdrawnAt != null));
  if (todo.length) {
    await db().update(enrolments)
      .set(withdraw ? { withdrawnAt: new Date(), withdrawnBy: actorId } : { withdrawnAt: null, withdrawnBy: null })
      .where(and(eq(enrolments.sectionId, sectionId), inArray(enrolments.id, todo.map((r) => r.id))));
  }
  await logAction(sectionId, actorId, withdraw ? "withdraw" : "restore", todo.length,
    rows.length - todo.length ? { skipped: rows.length - todo.length } : {});
  return { ok: true, changed: todo.length, skipped: rows.length - todo.length };
}

export const withdrawStudents = (actorId: string, sectionId: string, ids: string[]) =>
  setWithdrawn(actorId, sectionId, ids, true);
export const restoreStudents = (actorId: string, sectionId: string, ids: string[]) =>
  setWithdrawn(actorId, sectionId, ids, false);

/** Which of a class's enrolments are withdrawn, for the screens that label or hide them. */
export async function withdrawnIn(sectionId: string) {
  const rows = await db().select({ id: enrolments.id, userId: enrolments.userId, at: enrolments.withdrawnAt })
    .from(enrolments).where(and(eq(enrolments.sectionId, sectionId), withdrawnEnrolment()));
  return {
    enrolmentIds: new Set(rows.map((r) => r.id)),
    userIds: new Set(rows.map((r) => r.userId)),
    at: new Map(rows.map((r) => [r.id, r.at as Date])),
    count: rows.length,
  };
}
