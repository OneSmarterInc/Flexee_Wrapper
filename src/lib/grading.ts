// Spec 11: the grading arithmetic, as pure functions with no database and no rounding.
// Kept separate from lib/gradebook so the worked examples in the spec are directly testable.
//
// Nothing here rounds. Callers round at the edge — the page, or the CSV export — to one decimal.

export type CountedAttempt = "highest" | "latest" | "average" | "first";
export type LetterBand = { letter: string; min: number };

/** A submitted attempt, as much of one as the arithmetic needs. */
export type Attempt = { score: number | null; maxPoints: number; submittedAt: Date | null };

/** A column's contribution: its percentage and the weight it carries. */
export type Scored = { pct: number; weight: number };

export const DEFAULT_LETTER_BANDS: LetterBand[] = [
  { letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "C", min: 70 }, { letter: "D", min: 60 }, { letter: "F", min: 0 },
];

/** The +/- preset faculty can expand to, when they want the finer bands. */
export const PLUS_MINUS_LETTER_BANDS: LetterBand[] = [
  { letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 }, { letter: "B-", min: 80 },
  { letter: "C+", min: 77 }, { letter: "C", min: 73 }, { letter: "C-", min: 70 }, { letter: "D+", min: 67 }, { letter: "D", min: 63 },
  { letter: "D-", min: 60 }, { letter: "F", min: 0 },
];

export const STARTER_CATEGORIES = [
  { name: "Quizzes", weight: 15 }, { name: "Exams", weight: 35 },
  { name: "Assignments", weight: 30 }, { name: "Simulations", weight: 20 },
];

/** Which gradebook column kind lands in which starter category, by name. */
export function starterCategoryFor(kind: string, examKind?: string): string | null {
  if (kind === "exam") return examKind === "quiz" ? "Quizzes" : "Exams";
  if (kind === "assignment") return "Assignments";
  if (kind === "sim") return "Simulations";
  return null; // manual columns stay uncategorised until faculty choose
}

/**
 * The score that reaches the gradebook, from every attempt on record.
 * Only submitted, scored attempts count. Returns null when there are none.
 * No attempt is ever discarded — this only chooses which one to read.
 */
const pct = (score: number, max: number) => (max > 0 ? (score / max) * 100 : 0);

export function countedScore(attempts: Attempt[], rule: CountedAttempt): { score: number; maxPoints: number } | null {
  const done = attempts.filter((a): a is Attempt & { score: number; submittedAt: Date } => a.submittedAt != null && a.score != null);
  if (!done.length) return null;
  const byTime = [...done].sort((a, b) => +a.submittedAt - +b.submittedAt);
  if (rule === "first") return { score: byTime[0].score, maxPoints: byTime[0].maxPoints };
  if (rule === "highest") {
    // by percentage, so a re-blueprinted retake out of a different total compares fairly
    const best = done.reduce((b, a) => (pct(a.score, a.maxPoints) > pct(b.score, b.maxPoints) ? a : b));
    return { score: best.score, maxPoints: best.maxPoints };
  }
  if (rule === "average") {
    return {
      score: done.reduce((s, a) => s + a.score, 0) / done.length,
      maxPoints: done.reduce((s, a) => s + a.maxPoints, 0) / done.length,
    };
  }
  // latest — and the fallback for an unrecognised stored value, which is today's behaviour
  const last = byTime[byTime.length - 1];
  return { score: last.score, maxPoints: last.maxPoints };
}

/**
 * A category's percentage: a weighted mean of its columns' percentages, using each column's
 * weight (Spec 11 decision 5) — today's method, applied within the category.
 * `dropLowest` removes that many weakest columns by percentage first, together with their
 * weight, and never empties the category. Returns null when nothing in it is graded.
 */
export function categoryPercent(scored: Scored[], dropLowest = 0): number | null {
  if (!scored.length) return null;
  let kept = scored;
  if (dropLowest > 0 && scored.length > 1) {
    // never drop a category to nothing: keep at least one column
    const drop = Math.min(dropLowest, scored.length - 1);
    kept = [...scored].sort((a, b) => a.pct - b.pct).slice(drop);
  }
  const wsum = kept.reduce((s, c) => s + c.weight, 0);
  if (wsum <= 0) return null;
  return kept.reduce((s, c) => s + c.pct * c.weight, 0) / wsum;
}

/**
 * The course percentage: a weighted average of the category percentages, rescaled over only the
 * categories that have graded work — so early-term grades are not dragged down by categories
 * that have not started. Returns null when nothing at all is graded.
 */
export function coursePercent(categories: { pct: number | null; weight: number }[]): number | null {
  const live = categories.filter((c): c is { pct: number; weight: number } => c.pct != null && c.weight > 0);
  const wsum = live.reduce((s, c) => s + c.weight, 0);
  if (!live.length || wsum <= 0) return null;
  return live.reduce((s, c) => s + c.pct * c.weight, 0) / wsum;
}

/** The letter for a percentage, by the first band whose minimum it reaches. */
export function letterFor(pct: number | null, bands: LetterBand[] = DEFAULT_LETTER_BANDS): string | null {
  if (pct == null) return null;
  const ordered = [...bands].sort((a, b) => b.min - a.min);
  for (const b of ordered) if (pct >= b.min) return b.letter;
  return ordered[ordered.length - 1]?.letter ?? null;
}

/** Weights must total 100 to save. Tolerates float noise from 33.33-style splits. */
export function weightsTotal(weights: number[]): number {
  return weights.reduce((s, w) => s + w, 0);
}
export function weightsValid(weights: number[]): boolean {
  return Math.abs(weightsTotal(weights) - 100) < 0.01;
}

/** Round for display only — never stored, never fed back into a calculation. */
export function show(pct: number | null): string {
  return pct == null ? "" : String(Math.round(pct * 10) / 10);
}

export function parseBands(bandsJson: string | null | undefined): LetterBand[] {
  if (!bandsJson) return DEFAULT_LETTER_BANDS;
  try {
    const parsed = JSON.parse(bandsJson);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_LETTER_BANDS;
    const bands = parsed
      .filter((b: any) => typeof b?.letter === "string" && Number.isFinite(Number(b?.min)))
      .map((b: any) => ({ letter: String(b.letter), min: Number(b.min) }));
    return bands.length ? bands : DEFAULT_LETTER_BANDS;
  } catch {
    return DEFAULT_LETTER_BANDS;
  }
}
