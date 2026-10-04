import "server-only";
import { and, asc, count, desc, eq, isNull, lt, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  assistantSettings, assistantThreads, assistantMessages, assistantUsage, assistantQuestions,
  assignments, enrolments, exams, examAttempts, sections, users, identities,
} from "@/db/schema";
import { canManageClass } from "@/lib/publish";
import { estimateCostMicros } from "@/lib/ai";
import type { Citation } from "./answer";

/**
 * What is stored, who may read it, and for how long (Spec 20 §3 and §4).
 *
 * The rule that shapes this file: a thread is readable by **its student and the class's faculty**,
 * and by nobody else. Every read goes through `threadFor`, so there is one place that decides, and
 * an admin who does not teach the class gets counts from `classUsage` and never content.
 */

export const DEFAULTS = { enabled: false, dailyPerStudent: 20, monthlyTokenCap: 2_000_000 };

export const today = (d = new Date()) => d.toISOString().slice(0, 10);
export const thisMonth = (d = new Date()) => d.toISOString().slice(0, 7);

export async function settingsFor(sectionId: string) {
  const row = (await db().select().from(assistantSettings)
    .where(eq(assistantSettings.sectionId, sectionId)).limit(1))[0];
  return row ?? { sectionId, ...DEFAULTS, updatedAt: new Date() };
}

/** Only the class's faculty and admins, by the same check that guards its book. */
export async function setSettings(
  userId: string, sectionId: string,
  v: { enabled?: boolean; dailyPerStudent?: number; monthlyTokenCap?: number },
) {
  if (!(await canManageClass(userId, sectionId))) {
    return { ok: false as const, error: "Only this class's faculty or an administrator can change the assistant." };
  }
  const now = await settingsFor(sectionId);
  const next = {
    sectionId,
    enabled: v.enabled ?? now.enabled,
    dailyPerStudent: Math.max(0, Math.trunc(v.dailyPerStudent ?? now.dailyPerStudent)),
    monthlyTokenCap: Math.max(0, Math.trunc(v.monthlyTokenCap ?? now.monthlyTokenCap)),
    updatedAt: new Date(),
  };
  await db().insert(assistantSettings).values(next)
    .onConflictDoUpdate({ target: assistantSettings.sectionId, set: next });
  return { ok: true as const };
}

/** Facts the gate needs, gathered in one place so the endpoint cannot forget one. */
export async function gateFacts(sectionId: string, enrolmentId: string, opts: { assignmentId?: string } = {}) {
  const [settings, sec] = await Promise.all([
    settingsFor(sectionId),
    db().select({ publishedAt: sections.bookPublishedAt }).from(sections).where(eq(sections.id, sectionId)).limit(1),
  ]);
  // An attempt with no submittedAt is open. Only this student's, and only in this class.
  const open = await db().select({ c: count() }).from(examAttempts)
    .innerJoin(exams, eq(exams.id, examAttempts.examId))
    .where(and(eq(examAttempts.enrolmentId, enrolmentId), isNull(examAttempts.submittedAt), eq(exams.sectionId, sectionId)));
  const requests = await db().select({ c: count() }).from(assistantUsage)
    .where(and(eq(assistantUsage.enrolmentId, enrolmentId), eq(assistantUsage.day, today())));
  const monthTokens = await db()
    .select({ t: sum(sql`${assistantUsage.tokensIn} + ${assistantUsage.tokensOut}`) })
    .from(assistantUsage)
    .where(and(eq(assistantUsage.sectionId, sectionId), sql`${assistantUsage.day} like ${thisMonth() + "%"}`));
  let assignmentOff = false;
  if (opts.assignmentId) {
    const a = (await db().select({ off: assignments.assistantOff, sectionId: assignments.sectionId })
      .from(assignments).where(eq(assignments.id, opts.assignmentId)).limit(1))[0];
    assignmentOff = !!a && a.sectionId === sectionId && a.off;
  }
  return {
    settings,
    facts: {
      classEnabled: settings.enabled,
      bookPublished: !!sec[0]?.publishedAt,
      attemptsInProgress: Number(open[0]?.c ?? 0),
      assignmentOff,
      requestsToday: Number(requests[0]?.c ?? 0),
      dailyPerStudent: settings.dailyPerStudent,
      tokensThisMonth: Number(monthTokens[0]?.t ?? 0),
      monthlyTokenCap: settings.monthlyTokenCap,
    },
  };
}

/**
 * A thread, if this person may read it. The student who owns it, or any of the class's faculty —
 * and an admin only when they teach it, because `canManageClass` is about managing a class and
 * reading a student's conversation is not managing.
 */
export async function threadFor(userId: string, threadId: string) {
  const row = (await db().select({
    id: assistantThreads.id, sectionId: assistantThreads.sectionId, enrolmentId: assistantThreads.enrolmentId,
    title: assistantThreads.title, createdAt: assistantThreads.createdAt, lastMessageAt: assistantThreads.lastMessageAt,
    ownerUserId: enrolments.userId,
  }).from(assistantThreads)
    .innerJoin(enrolments, eq(enrolments.id, assistantThreads.enrolmentId))
    .where(eq(assistantThreads.id, threadId)).limit(1))[0];
  if (!row) return null;
  if (row.ownerUserId === userId) return { ...row, as: "student" as const };
  const teaches = (await db().select({ c: count() }).from(enrolments)
    .where(and(eq(enrolments.sectionId, row.sectionId), eq(enrolments.userId, userId), eq(enrolments.role, "instructor"))))[0];
  if (Number(teaches?.c ?? 0) > 0) return { ...row, as: "faculty" as const };
  return null;
}

export async function messagesFor(threadId: string) {
  const rows = await db().select().from(assistantMessages)
    .where(eq(assistantMessages.threadId, threadId)).orderBy(asc(assistantMessages.createdAt));
  return rows.map((m) => ({
    id: m.id, role: m.role as "student" | "assistant" | "instructor", body: m.body,
    citations: (m.citationsJson ? JSON.parse(m.citationsJson) : []) as Citation[],
    createdAt: m.createdAt,
  }));
}

/** A student's own threads in one class, newest first. */
export async function threadsForStudent(enrolmentId: string) {
  return db().select({ id: assistantThreads.id, title: assistantThreads.title, lastMessageAt: assistantThreads.lastMessageAt })
    .from(assistantThreads).where(eq(assistantThreads.enrolmentId, enrolmentId))
    .orderBy(desc(assistantThreads.lastMessageAt));
}

/** Every thread in a class, for its faculty: who asked, and when last. */
export async function threadsForClass(sectionId: string) {
  return db().select({
    id: assistantThreads.id, title: assistantThreads.title, lastMessageAt: assistantThreads.lastMessageAt,
    student: users.displayName, email: identities.subject,
  }).from(assistantThreads)
    .innerJoin(enrolments, eq(enrolments.id, assistantThreads.enrolmentId))
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(eq(assistantThreads.sectionId, sectionId))
    .orderBy(desc(assistantThreads.lastMessageAt));
}

export async function newThread(sectionId: string, enrolmentId: string, title: string) {
  const [t] = await db().insert(assistantThreads)
    .values({ sectionId, enrolmentId, title: title.slice(0, 120) }).returning();
  return t;
}

export async function addMessage(
  threadId: string, role: "student" | "assistant" | "instructor", body: string, citations: Citation[] = [],
) {
  const [m] = await db().insert(assistantMessages)
    .values({ threadId, role, body, citationsJson: citations.length ? JSON.stringify(citations) : null }).returning();
  await db().update(assistantThreads).set({ lastMessageAt: new Date() }).where(eq(assistantThreads.id, threadId));
  return m;
}

/** One record per request that reached a provider. No content, ever. */
export async function recordUsage(v: {
  sectionId: string; enrolmentId: string; provider: string; model: string;
  tokensIn: number; tokensOut: number;
}) {
  await db().insert(assistantUsage).values({
    sectionId: v.sectionId, enrolmentId: v.enrolmentId, day: today(),
    provider: v.provider, model: v.model, tokensIn: v.tokensIn, tokensOut: v.tokensOut,
    costMicros: estimateCostMicros(v.tokensIn, v.tokensOut),
  });
}

/** The meter faculty and admins see: a month to date against the cap. Counts, never content. */
export async function classUsage(sectionId: string, month = thisMonth()) {
  const rows = await db().select({
    tokensIn: sum(assistantUsage.tokensIn), tokensOut: sum(assistantUsage.tokensOut),
    micros: sum(assistantUsage.costMicros), requests: count(),
  }).from(assistantUsage)
    .where(and(eq(assistantUsage.sectionId, sectionId), sql`${assistantUsage.day} like ${month + "%"}`));
  const r = rows[0];
  const settings = await settingsFor(sectionId);
  const tokens = Number(r?.tokensIn ?? 0) + Number(r?.tokensOut ?? 0);
  return {
    month, requests: Number(r?.requests ?? 0),
    tokensIn: Number(r?.tokensIn ?? 0), tokensOut: Number(r?.tokensOut ?? 0), tokens,
    costMicros: Number(r?.micros ?? 0),
    cap: settings.monthlyTokenCap,
    sharePct: settings.monthlyTokenCap > 0 ? Math.min(100, Math.round((tokens / settings.monthlyTokenCap) * 100)) : 0,
  };
}

// ---------------------------------------------------------------- Ask your instructor (§5)

export async function askInstructor(threadId: string, sectionId: string, enrolmentId: string) {
  const open = (await db().select().from(assistantQuestions)
    .where(and(eq(assistantQuestions.threadId, threadId), eq(assistantQuestions.status, "open"))).limit(1))[0];
  if (open) return open;   // one open item per thread; asking twice does not make two
  const [q] = await db().insert(assistantQuestions).values({ threadId, sectionId, enrolmentId }).returning();
  return q;
}

export async function inboxFor(sectionId: string, status: "open" | "answered" | "all" = "open") {
  const where = status === "all"
    ? eq(assistantQuestions.sectionId, sectionId)
    : and(eq(assistantQuestions.sectionId, sectionId), eq(assistantQuestions.status, status));
  return db().select({
    id: assistantQuestions.id, threadId: assistantQuestions.threadId, status: assistantQuestions.status,
    askedAt: assistantQuestions.askedAt, answeredAt: assistantQuestions.answeredAt,
    title: assistantThreads.title, student: users.displayName,
  }).from(assistantQuestions)
    .innerJoin(assistantThreads, eq(assistantThreads.id, assistantQuestions.threadId))
    .innerJoin(enrolments, eq(enrolments.id, assistantQuestions.enrolmentId))
    .innerJoin(users, eq(users.id, enrolments.userId))
    .where(where).orderBy(asc(assistantQuestions.askedAt));
}

/**
 * A faculty reply. It lands in the thread as a message, so the student reads it where they asked.
 * The email is a courtesy and is sent by the caller through the mail adapter: a failure there
 * leaves the reply exactly where it is (rule 11).
 */
export async function answerQuestion(userId: string, questionId: string, body: string) {
  const q = (await db().select().from(assistantQuestions).where(eq(assistantQuestions.id, questionId)).limit(1))[0];
  if (!q) return { ok: false as const, error: "That question is no longer there." };
  if (!(await canManageClass(userId, q.sectionId))) return { ok: false as const, error: "That is not your class." };
  const text = body.trim();
  if (!text) return { ok: false as const, error: "Write a reply first." };
  await addMessage(q.threadId, "instructor", text);
  await db().update(assistantQuestions)
    .set({ status: "answered", answeredAt: new Date(), answeredBy: userId })
    .where(eq(assistantQuestions.id, questionId));
  // The address to tell, looked up here so the caller never has to join for it.
  const who = (await db().select({ email: identities.subject, name: users.displayName })
    .from(enrolments)
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(eq(enrolments.id, q.enrolmentId)).limit(1))[0];
  return { ok: true as const, threadId: q.threadId, sectionId: q.sectionId, email: who?.email ?? null };
}

// ---------------------------------------------------------------- retention (§3)

export const RETENTION_DAYS = () => {
  const v = Number(process.env.ASSISTANT_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 120;
};

/**
 * Delete threads whose last message is older than the setting. Messages and any Ask-your-instructor
 * items go with them by cascade; usage records stay, because a class's monthly total must not
 * shrink when a conversation is forgotten.
 */
export async function sweepThreads(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS() * 86_400_000);
  const doomed = await db().select({ id: assistantThreads.id }).from(assistantThreads)
    .where(lt(assistantThreads.lastMessageAt, cutoff));
  if (doomed.length) {
    await db().delete(assistantThreads).where(lt(assistantThreads.lastMessageAt, cutoff));
  }
  return { deleted: doomed.length, cutoff, retentionDays: RETENTION_DAYS() };
}

/**
 * The student's own enrolment in the class that adopts this book, whether or not the book is
 * published to them.
 *
 * `enrolmentForBook` deliberately returns nothing for a student whose class has not published its
 * book — that is what stops them reading it. The assistant needs the enrolment anyway, so the gate
 * can say "it becomes available once your instructor opens the book" instead of the misleading
 * "not switched on for this class".
 */
export async function studentEnrolmentForBook(userId: string, bookId: string) {
  const r = (await db().select({
    id: enrolments.id, sectionId: sections.id, publishedAt: sections.bookPublishedAt,
  }).from(enrolments)
    .innerJoin(sections, eq(sections.id, enrolments.sectionId))
    .where(and(eq(enrolments.userId, userId), eq(sections.bookId, bookId), eq(enrolments.role, "student")))
    .limit(1))[0];
  return r ?? null;
}
