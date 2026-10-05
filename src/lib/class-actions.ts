import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  classActions, enrolments, examAttempts, submissions, lineItemScores, bookmarks,
  assistantThreads, simCompletions, simLaunches, simTranscripts, identities, users, sections,
} from "@/db/schema";
import { canManageClass } from "@/lib/publish";

/**
 * Acting on a student in a class, and saying first what it will cost (Spec 19 §1 and §2).
 *
 * Removing an enrolment deletes that student's work in the class. Until this, that happened on one
 * click with no warning: a reproduction against a student holding an exam attempt, a graded
 * submission and a score took all three, plus the reading position and the assistant thread, and
 * left the gradebook with no row for them. The Wrapper is the grade record, so this file exists to
 * make the cost visible before anyone pays it.
 */

// ---------------------------------------------------------------- the log

export type ActionName =
  | "resend" | "withdraw" | "restore" | "remove"
  | "delete_account" | "delete_class" | "copy_grading" | "download_links";

/** Counts only. The table has nowhere to put a name, and this has nothing else to give it. */
export async function logAction(
  sectionId: string, actorId: string, action: ActionName, count: number,
  detail: Record<string, number> = {},
) {
  await db().insert(classActions).values({
    sectionId, actorId, action, count,
    detailJson: Object.keys(detail).length ? JSON.stringify(detail) : null,
  });
}

export async function actionsFor(sectionId: string, limit = 20) {
  const rows = await db().select().from(classActions)
    .where(eq(classActions.sectionId, sectionId))
    .orderBy(desc(classActions.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id, action: r.action as ActionName, count: r.count, at: r.createdAt,
    detail: (r.detailJson ? JSON.parse(r.detailJson) : {}) as Record<string, number>,
  }));
}

/** How the log reads on the page. No student is named, because none is recorded. */
export function describeAction(a: { action: ActionName; count: number; detail: Record<string, number> }) {
  const d = a.detail;
  const records = (d.attempts ?? 0) + (d.submissions ?? 0) + (d.scores ?? 0);
  const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
  switch (a.action) {
    case "resend": return `Resent ${n(a.count, "invitation")}${d.skipped ? `, skipped ${d.skipped}` : ""}`;
    case "withdraw": return `Withdrew ${n(a.count, "student")}`;
    case "restore": return `Restored ${n(a.count, "student")}`;
    case "remove": return `Removed ${n(a.count, "student")} (${records} record${records === 1 ? "" : "s"})`;
    case "delete_account": return `Deleted ${n(a.count, "account")}`;
    case "delete_class": return "Deleted the class";
    case "copy_grading":
      return `Copied a grading setup: ${n(d.categories ?? 0, "category", "categories")}` +
        `${d.unmatched ? `, ${d.unmatched} column${d.unmatched === 1 ? "" : "s"} unmatched` : ""}`;
    case "download_links": return `Downloaded ${n(a.count, "invitation link")}`;
    default: return `${a.action} (${a.count})`;
  }
}

// ---------------------------------------------------------------- what a removal would cost

export type RemovalCost = {
  enrolmentId: string;
  role: string;
  /** Records that make a removal consequential, and so require typing (decision 6). */
  attempts: number;
  submissions: number;
  scores: number;
  /** Listed in the counts, but not on their own a reason to demand typing. */
  bookmarks: number;
  threads: number;
  simCompletions: number;
  simLaunches: number;
  simTranscripts: number;
};

export const hasRecords = (c: RemovalCost) => c.attempts + c.submissions + c.scores > 0;

export const totalRecords = (c: RemovalCost) =>
  c.attempts + c.submissions + c.scores + c.bookmarks + c.threads +
  c.simCompletions + c.simLaunches + c.simTranscripts;

/**
 * Exactly what removing these enrolments would delete, counted from the same tables the delete
 * will reach. Nothing is estimated: the dialog's numbers and the deletion's effect come from one
 * place, so they cannot drift apart.
 */
export async function removalCost(sectionId: string, enrolmentIds: string[]): Promise<RemovalCost[]> {
  if (!enrolmentIds.length) return [];
  const rows = await db().select({ id: enrolments.id, role: enrolments.role, userId: enrolments.userId })
    .from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), inArray(enrolments.id, enrolmentIds)));
  const out: RemovalCost[] = [];
  for (const r of rows) {
    const [att, subs, scores, bms, threads] = await Promise.all([
      db().select({ id: examAttempts.id }).from(examAttempts).where(eq(examAttempts.enrolmentId, r.id)),
      db().select({ id: submissions.id }).from(submissions).where(eq(submissions.enrolmentId, r.id)),
      db().select({ id: lineItemScores.lineItemId }).from(lineItemScores).where(eq(lineItemScores.enrolmentId, r.id)),
      db().select({ id: bookmarks.enrolmentId }).from(bookmarks).where(eq(bookmarks.enrolmentId, r.id)),
      db().select({ id: assistantThreads.id }).from(assistantThreads).where(eq(assistantThreads.enrolmentId, r.id)),
    ]);
    // Decision 7: simulation records hang off the user, so they are counted (and deleted) for this
    // class only. Before this they survived a removal, and a re-added student's completions came
    // back while their grades did not.
    const inClass = and(eq(simCompletions.userId, r.userId), eq(simCompletions.sectionId, sectionId));
    const [comps, launches, trans] = await Promise.all([
      db().select({ id: simCompletions.id }).from(simCompletions).where(inClass),
      db().select({ id: simLaunches.id }).from(simLaunches)
        .where(and(eq(simLaunches.userId, r.userId), eq(simLaunches.sectionId, sectionId))),
      db().select({ id: simTranscripts.id }).from(simTranscripts)
        .where(and(eq(simTranscripts.userId, r.userId), eq(simTranscripts.sectionId, sectionId))),
    ]);
    out.push({
      enrolmentId: r.id, role: r.role,
      attempts: att.length, submissions: subs.length, scores: scores.length,
      bookmarks: bms.length, threads: threads.length,
      simCompletions: comps.length, simLaunches: launches.length, simTranscripts: trans.length,
    });
  }
  return out;
}

/** The sentence the dialog shows. The spec's own wording: counts first, in plain words. */
export function describeCost(costs: RemovalCost[]) {
  const sum = (k: keyof RemovalCost) => costs.reduce((s, c) => s + (c[k] as number), 0);
  const parts: string[] = [];
  const add = (k: keyof RemovalCost, one: string, many: string) => {
    const v = sum(k);
    if (v) parts.push(`${v} ${v === 1 ? one : many}`);
  };
  add("attempts", "exam attempt", "attempts");
  add("submissions", "submission", "submissions");
  add("scores", "grade", "grades");
  add("bookmarks", "reading position", "reading positions");
  add("threads", "assistant conversation", "assistant conversations");
  add("simCompletions", "simulation completion", "simulation completions");
  add("simLaunches", "simulation launch", "simulation launches");
  add("simTranscripts", "simulation transcript", "simulation transcripts");
  if (!parts.length) return "This deletes no records.";
  const last = parts.pop()!;
  return `This will delete ${parts.length ? parts.join(", ") + " and " + last : last}.`;
}

export type RemoveResult =
  | { ok: true; removed: number; cost: RemovalCost[] }
  | { ok: false; error: string; needsTyping?: boolean; cost?: RemovalCost[]; expect?: string };

/**
 * The words that have to be typed when records exist. Short, unambiguous, and the same every time
 * so it can be shown in the dialog and checked on the server.
 */
export const REMOVE_PHRASE = "delete records";

/**
 * Remove enrolments and the records that hang off them.
 *
 * Every id is re-checked against this class before anything happens, so nothing the page sent is
 * trusted. When any attempt, submission or score exists, `confirm` must be the phrase above —
 * that is decision 6, and it is checked here rather than in the browser.
 */
export async function removeStudents(
  actorId: string, sectionId: string, enrolmentIds: string[], opts: { confirm?: string } = {},
): Promise<RemoveResult> {
  if (!(await canManageClass(actorId, sectionId))) {
    return { ok: false, error: "Only this class's faculty or an administrator can remove students." };
  }
  const ids = [...new Set(enrolmentIds.filter(Boolean))];
  if (!ids.length) return { ok: false, error: "Nobody was selected." };
  const cost = await removalCost(sectionId, ids);
  if (cost.length !== ids.length) {
    // The ones that did not come back are not in this class. Refusing the whole call is right:
    // a page that sent a foreign id is a page whose other ids are not to be trusted either.
    return { ok: false, error: "Some of those students are not in this class." };
  }
  const consequential = cost.filter(hasRecords);
  if (consequential.length && opts.confirm?.trim().toLowerCase() !== REMOVE_PHRASE) {
    return {
      ok: false, needsTyping: true, cost, expect: REMOVE_PHRASE,
      error: `${describeCost(cost)} Type "${REMOVE_PHRASE}" to confirm.`,
    };
  }

  // One transaction: a half-removed student is a worse record than either outcome.
  const sums = { attempts: 0, submissions: 0, scores: 0, bookmarks: 0, threads: 0, sims: 0 };
  await db().transaction(async (tx) => {
    for (const c of cost) {
      const row = (await tx.select({ userId: enrolments.userId }).from(enrolments)
        .where(and(eq(enrolments.id, c.enrolmentId), eq(enrolments.sectionId, sectionId))).limit(1))[0];
      if (!row) continue;
      // Simulation records first: they hang off the user, so the enrolment's cascade never reaches
      // them. Scoped to this class, so another class's play is untouched.
      for (const t of [simCompletions, simLaunches, simTranscripts]) {
        await tx.delete(t as typeof simCompletions)
          .where(and(eq((t as typeof simCompletions).userId, row.userId),
                     eq((t as typeof simCompletions).sectionId, sectionId)));
      }
      // Everything else goes with the enrolment, by cascade: bookmarks, submissions and their
      // files, attempts and their responses, scores, assistant threads and their messages.
      await tx.delete(enrolments).where(and(eq(enrolments.id, c.enrolmentId), eq(enrolments.sectionId, sectionId)));
      sums.attempts += c.attempts; sums.submissions += c.submissions; sums.scores += c.scores;
      sums.bookmarks += c.bookmarks; sums.threads += c.threads;
      sums.sims += c.simCompletions + c.simLaunches + c.simTranscripts;
    }
  });
  await logAction(sectionId, actorId, "remove", cost.length, sums);
  return { ok: true, removed: cost.length, cost };
}

// ---------------------------------------------------------------- bulk resend (§1)

export type ResendResult =
  | { ok: true; sent: number; skipped: number; reasons: Record<string, number> }
  | { ok: false; error: string };

/**
 * Resend invitations to the selected students (Spec 19 §1, rule 2).
 *
 * It skips a demo account (D2L's demo address is nobody's inbox), a student who has already set a
 * password, a withdrawn student, and anyone who has had their three for the hour. The reasons are
 * counted and reported, because "sent 24, skipped 6" with no explanation is a worse answer than
 * either number alone.
 */
export async function resendTo(
  actorId: string, sectionId: string, enrolmentIds: string[], baseUrl: string,
): Promise<ResendResult> {
  if (!(await canManageClass(actorId, sectionId))) {
    return { ok: false, error: "Only this class's faculty or an administrator can do that." };
  }
  const ids = [...new Set(enrolmentIds.filter(Boolean))];
  if (!ids.length) return { ok: false, error: "Nobody was selected." };
  const rows = await db().select({
    id: enrolments.id, userId: enrolments.userId, role: enrolments.role,
    isDemo: enrolments.isDemo, withdrawnAt: enrolments.withdrawnAt,
    email: identities.subject, hash: identities.passwordHash,
  }).from(enrolments)
    .leftJoin(identities, and(eq(identities.userId, enrolments.userId), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), inArray(enrolments.id, ids)));
  if (rows.length !== ids.length) return { ok: false, error: "Some of those students are not in this class." };

  const { rateLimit, sendSetPasswordInvite, RESEND_MAX_PER_HOUR } = await import("@/lib/recovery");
  const reasons: Record<string, number> = {};
  const skip = (why: string) => { reasons[why] = (reasons[why] ?? 0) + 1; };
  let sent = 0;
  for (const r of rows) {
    if (r.role !== "student") { skip("not a student"); continue; }
    if (r.isDemo) { skip("demo account"); continue; }
    if (r.withdrawnAt) { skip("withdrawn"); continue; }
    if (!r.email) { skip("no email address"); continue; }
    if (r.hash != null) { skip("already set up"); continue; }
    if (!(await rateLimit(`invite:${r.userId}`, RESEND_MAX_PER_HOUR, 3600))) { skip("three already this hour"); continue; }
    const res = await sendSetPasswordInvite(r.userId, sectionId, r.email, baseUrl);
    if (res.ok) sent++;
    else skip(res.error ?? "send failed");
  }
  const skipped = rows.length - sent;
  await logAction(sectionId, actorId, "resend", sent, skipped ? { skipped } : {});
  return { ok: true, sent, skipped, reasons };
}

// ---------------------------------------------------------------- the two admin deletions (§1)

export type AccountCheck = {
  canDelete: boolean;
  reasons: string[];
  counts: { classes: number; attempts: number; submissions: number; scores: number };
};

/**
 * May this account be deleted? (Spec 19 rule 5.)
 *
 * Four conditions, all of them about not destroying something that matters: the account never set
 * a password (so nobody is using it), it holds no work, it belongs to no other class, and it is
 * neither faculty anywhere nor an administrator. Every failing condition is reported, so an admin
 * who cannot delete an account learns all the reasons at once rather than one per attempt.
 */
export async function accountCheck(userId: string): Promise<AccountCheck> {
  const reasons: string[] = [];
  const u = (await db().select({ role: users.systemRole }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!u) return { canDelete: false, reasons: ["There is no such account."], counts: { classes: 0, attempts: 0, submissions: 0, scores: 0 } };
  if (u.role === "admin") reasons.push("it is an administrator's account");

  const idents = await db().select({ hash: identities.passwordHash, provider: identities.provider })
    .from(identities).where(eq(identities.userId, userId));
  if (idents.some((i) => i.provider === "password" && i.hash != null)) reasons.push("someone has set a password on it");
  if (idents.some((i) => i.provider !== "password")) reasons.push("it signs in through the LMS");

  const enrs = await db().select({ id: enrolments.id, role: enrolments.role }).from(enrolments)
    .where(eq(enrolments.userId, userId));
  if (enrs.some((e) => e.role === "instructor")) reasons.push("it teaches a class");
  const classes = enrs.length;
  const ids = enrs.map((e) => e.id);
  const workCount = async (table: typeof examAttempts | typeof submissions | typeof lineItemScores) =>
    ids.length
      ? Number((await db().select({ c: count() }).from(table as typeof submissions)
          .where(inArray((table as typeof submissions).enrolmentId, ids)))[0]?.c ?? 0)
      : 0;
  const counts = {
    classes,
    attempts: await workCount(examAttempts),
    submissions: await workCount(submissions),
    scores: await workCount(lineItemScores),
  };
  if (counts.attempts + counts.submissions + counts.scores > 0) reasons.push("it holds work");
  if (classes > 1) reasons.push("it belongs to more than one class");
  return { canDelete: reasons.length === 0, reasons, counts };
}

export type DeleteAccountResult = { ok: true } | { ok: false; error: string; reasons?: string[] };

/**
 * Delete an account and its dependents. **Admins only**, and only when `accountCheck` allows it.
 * `sectionId` is the class the admin is working in, so the act can be logged against it.
 */
export async function deleteAccount(
  actorId: string, sectionId: string, userId: string, opts: { confirm?: string } = {},
): Promise<DeleteAccountResult> {
  const { isAdmin } = await import("@/lib/admin");
  if (!(await isAdmin(actorId))) return { ok: false, error: "Only an administrator can delete an account." };
  if (actorId === userId) return { ok: false, error: "You cannot delete your own account." };
  const check = await accountCheck(userId);
  if (!check.canDelete) {
    return { ok: false, error: `This account cannot be deleted: ${check.reasons.join("; ")}.`, reasons: check.reasons };
  }
  const name = (await db().select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1))[0]?.name ?? "";
  if (opts.confirm?.trim() !== name.trim() || !name) {
    return { ok: false, error: `Type the account's name exactly — "${name}" — to confirm.` };
  }
  // One statement: everything hanging off the account goes with it by cascade.
  await db().delete(users).where(eq(users.id, userId));
  await logAction(sectionId, actorId, "delete_account", 1, check.counts);
  return { ok: true };
}

export type DeleteClassResult = { ok: true } | { ok: false; error: string };

/**
 * Delete a class. **Admins only**, and refused while any student enrolment exists — a withdrawn one
 * included, because a withdrawal keeps the records and deleting the class would take them.
 */
export async function deleteClass(
  actorId: string, sectionId: string, opts: { confirm?: string } = {},
): Promise<DeleteClassResult> {
  const { isAdmin } = await import("@/lib/admin");
  if (!(await isAdmin(actorId))) return { ok: false, error: "Only an administrator can delete a class." };
  const sec = (await db().select({ name: sections.name }).from(sections).where(eq(sections.id, sectionId)).limit(1))[0];
  if (!sec) return { ok: false, error: "That class no longer exists." };
  const students = Number((await db().select({ c: count() }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student"))))[0]?.c ?? 0);
  if (students > 0) {
    return {
      ok: false,
      error: `This class still has ${students} student enrolment${students === 1 ? "" : "s"}, ` +
        "withdrawn ones included. Remove them first.",
    };
  }
  if (opts.confirm?.trim() !== sec.name.trim()) {
    return { ok: false, error: `Type the class's name exactly — "${sec.name}" — to confirm.` };
  }
  // The log goes first: the class's rows, this one among them, are about to cascade away.
  await logAction(sectionId, actorId, "delete_class", 1);
  await db().delete(sections).where(eq(sections.id, sectionId));
  return { ok: true };
}
