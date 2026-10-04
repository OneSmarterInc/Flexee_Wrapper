import "server-only";
import { and, eq, inArray, not } from "drizzle-orm";
import { db } from "@/db";
import { learningObjectives, questions, exams, examAttempts, examResponses, enrolments, users, identities, sectionOutcomes, outcomeObjectiveMap, sections } from "@/db/schema";

export async function bookObjectives(bookId: string) {
  return db().select().from(learningObjectives).where(eq(learningObjectives.bookId, bookId)).orderBy(learningObjectives.chapter);
}

// All graded responses in a section, joined to the objective each question tests.
/**
 * Every answer given in this class's exams.
 *
 * Spec 18: **by its students, and not by a demo**. This filtered by nothing, so an instructor's
 * own practice run through an exam already fed the percentages a faculty member reads, and the
 * demo account would have too. `includeDemo` is for the per-student matrix, which is a list rather
 * than a statistic and shows the demo's own answers, labelled.
 */
export async function sectionResponses(sectionId: string, opts: { includeDemo?: boolean } = {}) {
  const examRows = await db().select({ id: exams.id }).from(exams).where(eq(exams.sectionId, sectionId));
  if (!examRows.length) return [];
  const attempts = await db().select({ id: examAttempts.id, enrolmentId: examAttempts.enrolmentId, servedJson: examAttempts.servedJson })
    .from(examAttempts)
    .innerJoin(enrolments, eq(enrolments.id, examAttempts.enrolmentId))
    .where(and(inArray(examAttempts.examId, examRows.map((e) => e.id)),
               eq(enrolments.role, "student"),
               ...(opts.includeDemo ? [] : [not(enrolments.isDemo)])));
  const submitted = attempts.filter((a) => a); // all; unsubmitted have no responses
  if (!submitted.length) return [];
  const resp = await db().select({ attemptId: examResponses.attemptId, questionId: examResponses.questionId, correct: examResponses.correct })
    .from(examResponses).where(inArray(examResponses.attemptId, submitted.map((a) => a.id)));
  if (!resp.length) return [];
  const qrows = await db().select({ id: questions.id, objectiveId: questions.objectiveId }).from(questions).where(inArray(questions.id, [...new Set(resp.map((r) => r.questionId))]));
  const objOf = new Map(qrows.map((q) => [q.id, q.objectiveId]));
  const enrOf = new Map(submitted.map((a) => [a.id, a.enrolmentId]));
  // The objective a question tested when it was served (snapshot) wins over its current tag.
  const snapObj = new Map<string, string | null>();
  for (const a of submitted) for (const s of JSON.parse(a.servedJson) as { questionId: string; snap?: { objectiveId: string | null } }[])
    if (s.snap) snapObj.set(`${a.id}:${s.questionId}`, s.snap.objectiveId);
  return resp.map((r) => ({ enrolmentId: enrOf.get(r.attemptId)!, attemptId: r.attemptId, questionId: r.questionId,
    objectiveId: snapObj.has(`${r.attemptId}:${r.questionId}`) ? snapObj.get(`${r.attemptId}:${r.questionId}`)! : (objOf.get(r.questionId) ?? null), correct: r.correct }));
}

// Class mastery per objective.
export async function classMastery(sectionId: string, bookId: string) {
  const objs = await bookObjectives(bookId);
  const rows = await sectionResponses(sectionId);
  const agg = new Map<string, { served: number; correct: number }>();
  for (const r of rows) { if (!r.objectiveId) continue; const a = agg.get(r.objectiveId) ?? { served: 0, correct: 0 }; a.served++; if (r.correct) a.correct++; agg.set(r.objectiveId, a); }
  return objs.map((o) => { const a = agg.get(o.id) ?? { served: 0, correct: 0 }; return { ...o, served: a.served, correct: a.correct, pct: a.served ? Math.round((a.correct / a.served) * 100) : null }; });
}

// Per-student mastery matrix: rows = students, cols = objectives. A list, so the demo is in it.
export async function studentMastery(sectionId: string, bookId: string) {
  const objs = await bookObjectives(bookId);
  const rows = await sectionResponses(sectionId, { includeDemo: true });
  // The matrix is a list, not a statistic, so a demo stays in it — labelled, so faculty can see
  // their own test run rather than wonder where it went. Its answers are out of `rows` above.
  const roster = await db().select({ enrolmentId: enrolments.id, name: users.displayName, email: identities.subject, role: enrolments.role, isDemo: enrolments.isDemo })
    .from(enrolments).innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));
  const cell = new Map<string, { served: number; correct: number }>();
  for (const r of rows) { if (!r.objectiveId) continue; const k = `${r.enrolmentId}:${r.objectiveId}`; const a = cell.get(k) ?? { served: 0, correct: 0 }; a.served++; if (r.correct) a.correct++; cell.set(k, a); }
  const students = roster.filter((s) => rows.some((r) => r.enrolmentId === s.enrolmentId)).map((s) => ({
    name: s.name, email: s.email, isDemo: s.isDemo,
    cells: objs.map((o) => { const a = cell.get(`${s.enrolmentId}:${o.id}`); return a && a.served ? Math.round((a.correct / a.served) * 100) : null; }),
  }));
  return { objectives: objs, students };
}

// --- syllabus alignment ---
export async function sectionSyllabus(sectionId: string) {
  const outcomes = await db().select().from(sectionOutcomes).where(eq(sectionOutcomes.sectionId, sectionId));
  const maps = outcomes.length ? await db().select().from(outcomeObjectiveMap).where(inArray(outcomeObjectiveMap.outcomeId, outcomes.map((o) => o.id))) : [];
  return outcomes.map((o) => ({ ...o, objectiveIds: maps.filter((m) => m.outcomeId === o.id).map((m) => m.objectiveId) }));
}
export async function addOutcome(sectionId: string, code: string, description: string) {
  await db().insert(sectionOutcomes).values({ sectionId, code, description });
}
export async function mapOutcome(outcomeId: string, objectiveId: string) {
  await db().insert(outcomeObjectiveMap).values({ outcomeId, objectiveId }).onConflictDoNothing();
}
// Roll objective mastery up to each syllabus outcome.
export async function outcomeRollup(sectionId: string, bookId: string) {
  const [syl, mastery] = await Promise.all([sectionSyllabus(sectionId), classMastery(sectionId, bookId)]);
  const mById = new Map(mastery.map((m) => [m.id, m]));
  return syl.map((o) => {
    const parts = o.objectiveIds.map((id) => mById.get(id)).filter((m): m is NonNullable<typeof m> => !!m && m.pct != null);
    const pct = parts.length ? Math.round(parts.reduce((s, m) => s + (m.pct as number), 0) / parts.length) : null;
    return { code: o.code, description: o.description, objectiveCount: o.objectiveIds.length, pct };
  });
}
