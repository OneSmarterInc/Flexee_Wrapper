import "server-only";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { questions, exams, examAttempts, examResponses, enrolments, users, identities, sections } from "@/db/schema";

type Opt = { id: string; text: string; correct: boolean; rationale: string };
// What a student was served. `snap` freezes the question exactly as it was at that moment, so
// scoring, review and assurance-of-learning evidence never change if the bank is edited later.
type Snap = { stem: string; options: Opt[]; points: number; objectiveId: string | null; chapter: number };
type Served = { questionId: string; optionOrder: string[]; snap?: Snap };
type Blueprint =
  | { mode: "draw"; rules: { chapter: number; difficulty: string; count: number }[] }
  | { mode: "fixed"; ids: string[] };

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
const opts = (q: { optionsJson: string }) => JSON.parse(q.optionsJson) as Opt[];
const correctId = (q: { optionsJson: string }) => opts(q).find((o) => o.correct)?.id ?? "";

// The questions of an attempt as served: from the frozen snapshot, or (attempts made before
// snapshots existed) from the current bank.
async function servedQuestions(servedJson: string): Promise<{ served: Served[]; byId: Map<string, Snap> }> {
  const served = JSON.parse(servedJson) as Served[];
  const byId = new Map<string, Snap>();
  const missing = served.filter((s) => !s.snap).map((s) => s.questionId);
  const bank = missing.length ? new Map((await db().select().from(questions).where(inArray(questions.id, missing))).map((r) => [r.id, r])) : new Map();
  for (const s of served) {
    if (s.snap) { byId.set(s.questionId, s.snap); continue; }
    const q = bank.get(s.questionId);
    if (q) byId.set(s.questionId, { stem: q.stem, options: opts(q), points: q.points, objectiveId: q.objectiveId ?? null, chapter: q.chapter });
  }
  return { served, byId };
}

// ---- bank ----
// A question may reach students only if its metadata allows it: a question under review
// (review.status present and not "approved") is never served, and a "practice" question
// never appears on an exam. Questions without metadata (older banks) are unaffected.
function eligibleForExam(q: { metaJson?: string | null }): { ok: boolean; why?: string } {
  if (!q.metaJson) return { ok: true };
  let m: any; try { m = JSON.parse(q.metaJson); } catch { return { ok: true }; }
  if (m.review?.status && m.review.status !== "approved") return { ok: false, why: `not yet approved (review: ${m.review.status})` };
  if (m.use === "practice") return { ok: false, why: "marked for practice only" };
  return { ok: true };
}
export async function questionCounts(bookId: string) {
  const rows = await db().select().from(questions).where(eq(questions.bookId, bookId));
  const by = new Map<string, number>();
  for (const q of rows) {
    for (const key of [`c${q.chapter}:any`, `c${q.chapter}:${q.difficulty}`]) by.set(key, (by.get(key) ?? 0) + 1);
  }
  const chapters = [...new Set(rows.map((r) => r.chapter))].sort((a, b) => a - b);
  return { total: rows.length, chapters, count: (ch: number, diff: string) => by.get(`c${ch}:${diff}`) ?? 0 };
}

// ---- exams (instructor) ----
export async function createExam(sectionId: string, v: { title: string; blueprint: Blueprint; feedback: string; timeLimitMin: number | null; attemptLimit: number }) {
  const [row] = await db().insert(exams).values({
    sectionId, title: v.title, blueprintJson: JSON.stringify(v.blueprint),
    feedback: v.feedback, timeLimitMin: v.timeLimitMin, attemptLimit: v.attemptLimit,
  }).returning();
  return row;
}
export async function setExamStatus(examId: string, status: "draft" | "open" | "closed") {
  await db().update(exams).set({ status }).where(eq(exams.id, examId));
}
export async function examsForSection(sectionId: string) {
  return db().select().from(exams).where(eq(exams.sectionId, sectionId)).orderBy(desc(exams.createdAt));
}
export async function examById(examId: string) {
  return (await db().select().from(exams).where(eq(exams.id, examId)).limit(1))[0] ?? null;
}

// Resolve a blueprint into a concrete, per-student served set (random for draws).
async function assemble(exam: { blueprintJson: string; sectionId: string }): Promise<{ served: Served[]; maxPoints: number; bank: Map<string, any> }> {
  const sec = (await db().select().from(sections).where(eq(sections.id, exam.sectionId)).limit(1))[0];
  const bp = JSON.parse(exam.blueprintJson) as Blueprint;
  let picked: string[] = [];
  if (bp.mode === "fixed") {
    picked = bp.ids;
    const rows0 = picked.length ? await db().select().from(questions).where(inArray(questions.id, picked)) : [];
    const blocked = rows0.map((q) => ({ id: q.id, e: eligibleForExam(q) })).filter((x) => !x.e.ok);
    if (blocked.length) throw new Error(`These questions cannot be used on an exam: ${blocked.map((b) => `${b.id} (${b.e.why})`).join("; ")}`);
  } else {
    for (const rule of bp.rules) {
      const conds = [eq(questions.bookId, sec.bookId), eq(questions.chapter, rule.chapter)];
      if (rule.difficulty !== "any") conds.push(eq(questions.difficulty, rule.difficulty));
      const cand = (await db().select({ id: questions.id, metaJson: questions.metaJson }).from(questions).where(and(...conds))).filter((c) => eligibleForExam(c).ok);
      if (cand.length < rule.count) {
        throw new Error(`Not enough questions to draw: rule wants ${rule.count} from chapter ${rule.chapter} (${rule.difficulty}), but only ${cand.length} exist.`);
      }
      picked.push(...shuffle(cand.map((c) => c.id)).slice(0, rule.count));
    }
  }
  const rows = picked.length ? await db().select().from(questions).where(inArray(questions.id, picked)) : [];
  const bank = new Map(rows.map((r) => [r.id, r]));
  const served: Served[] = [];
  let maxPoints = 0;
  for (const id of picked) {
    const q = bank.get(id);
    if (!q) continue;
    const order = q.shuffleOptions ? shuffle(opts(q).map((o) => o.id)) : opts(q).map((o: Opt) => o.id);
    served.push({ questionId: id, optionOrder: order,
      snap: { stem: q.stem, options: opts(q), points: q.points, objectiveId: q.objectiveId ?? null, chapter: q.chapter } });
    maxPoints += q.points;
  }
  return { served, maxPoints, bank };
}

// ---- attempts (student) ----
export async function openExamsForSection(sectionId: string, enrolmentId: string) {
  const open = await db().select().from(exams).where(and(eq(exams.sectionId, sectionId), eq(exams.status, "open")));
  const mine = await db().select().from(examAttempts).where(eq(examAttempts.enrolmentId, enrolmentId));
  const attemptsByExam = new Map<string, typeof mine>();
  for (const a of mine) { const l = attemptsByExam.get(a.examId) ?? []; l.push(a); attemptsByExam.set(a.examId, l); }
  return open.map((e) => {
    const as = attemptsByExam.get(e.id) ?? [];
    const submitted = as.filter((a) => a.submittedAt);
    return { exam: e, attemptsUsed: submitted.length, canAttempt: submitted.length < e.attemptLimit, lastScore: submitted.at(-1)?.score ?? null, lastMax: submitted.at(-1)?.maxPoints ?? null };
  });
}

export async function startAttempt(examId: string, enrolmentId: string) {
  const exam = await examById(examId);
  if (!exam || exam.status !== "open") throw new Error("Exam not open");
  const prior = await db().select().from(examAttempts).where(and(eq(examAttempts.examId, examId), eq(examAttempts.enrolmentId, enrolmentId)));
  if (prior.filter((a) => a.submittedAt).length >= exam.attemptLimit) throw new Error("No attempts left");
  const { served, maxPoints } = await assemble(exam);
  const [attempt] = await db().insert(examAttempts).values({ examId, enrolmentId, servedJson: JSON.stringify(served), maxPoints }).returning();
  return attempt;
}

// The taking view: questions in served order, options in served order, no answers.
export async function attemptForTaking(attemptId: string) {
  const attempt = (await db().select().from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1))[0];
  if (!attempt) return null;
  const { served, byId } = await servedQuestions(attempt.servedJson);
  const items = served.map((s) => {
    const q = byId.get(s.questionId)!;
    const oMap = new Map(q.options.map((o) => [o.id, o]));
    return { questionId: s.questionId, stem: q.stem, options: s.optionOrder.map((id) => ({ id, text: oMap.get(id)!.text })) };
  });
  return { attempt, items };
}

export async function submitAttempt(attemptId: string, answers: Record<string, string>) {
  const attempt = (await db().select().from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1))[0];
  if (!attempt || attempt.submittedAt) throw new Error("Attempt not open");
  const { served, byId } = await servedQuestions(attempt.servedJson);
  let score = 0;
  for (const s of served) {
    const q = byId.get(s.questionId)!;
    const sel = answers[s.questionId] ?? null;
    const ok = sel != null && sel === (q.options.find((o) => o.correct)?.id ?? "");
    const pts = ok ? q.points : 0;
    score += pts;
    await db().insert(examResponses).values({ attemptId, questionId: s.questionId, selectedOptionId: sel, correct: ok, points: pts });
  }
  await db().update(examAttempts).set({ submittedAt: new Date(), score }).where(eq(examAttempts.id, attemptId));
  return { score, maxPoints: attempt.maxPoints };
}

// Result view for a student, with rationales when feedback rules allow.
export async function attemptResult(attemptId: string) {
  const attempt = (await db().select().from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1))[0];
  if (!attempt?.submittedAt) return null;
  const exam = await examById(attempt.examId);
  const showFeedback = exam!.feedback === "immediate" || exam!.status === "closed";
  const responses = await db().select().from(examResponses).where(eq(examResponses.attemptId, attemptId));
  const { byId } = await servedQuestions(attempt.servedJson);
  const items = responses.map((r) => {
    const q = byId.get(r.questionId)!;
    const o = q.options;
    return {
      stem: q.stem, correct: r.correct,
      selected: o.find((x) => x.id === r.selectedOptionId)?.text ?? "(no answer)",
      answer: showFeedback ? o.find((x) => x.correct)!.text : null,
      rationale: showFeedback ? o.find((x) => x.id === r.selectedOptionId)?.rationale ?? null : null,
    };
  });
  return { score: attempt.score!, maxPoints: attempt.maxPoints, showFeedback, items };
}

// Instructor reporting: per-student scores + per-question item analysis.
export async function examResults(examId: string) {
  const attempts = await db()
    .select({ id: examAttempts.id, enrolmentId: examAttempts.enrolmentId, score: examAttempts.score, maxPoints: examAttempts.maxPoints, submittedAt: examAttempts.submittedAt,
              name: users.displayName, email: identities.subject })
    .from(examAttempts)
    .innerJoin(enrolments, eq(enrolments.id, examAttempts.enrolmentId))
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password")))
    .where(eq(examAttempts.examId, examId));
  const submitted = attempts.filter((a) => a.submittedAt);
  const attemptIds = submitted.map((a) => a.id);
  const responses = attemptIds.length ? await db().select().from(examResponses).where(inArray(examResponses.attemptId, attemptIds)) : [];
  const byQ = new Map<string, { served: number; correct: number }>();
  for (const r of responses) { const s = byQ.get(r.questionId) ?? { served: 0, correct: 0 }; s.served++; if (r.correct) s.correct++; byQ.set(r.questionId, s); }
  const bank = new Map((byQ.size ? await db().select().from(questions).where(inArray(questions.id, [...byQ.keys()])) : []).map((r) => [r.id, r]));
  const items = [...byQ.entries()].map(([qid, s]) => ({ questionId: qid, stem: bank.get(qid)?.stem ?? qid, served: s.served, correct: s.correct, pct: s.served ? Math.round((s.correct / s.served) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct);
  return { students: submitted.map((a) => ({ name: a.name, email: a.email, score: a.score, maxPoints: a.maxPoints })), items };
}

export async function attemptEnrolmentId(attemptId: string) {
  const a = (await db().select({ e: examAttempts.enrolmentId }).from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1))[0];
  return a?.e ?? null;
}
