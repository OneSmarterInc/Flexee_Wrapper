import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lineItems } from "@/db/schema";
import { gradebook, handEntryRefusal, type Cell } from "@/lib/gradebook";
import { parseScoreFile, readValue, type ParsedFile } from "@/lib/score-import";

/**
 * Spec 23 §3: what a file would do, before anything is written.
 *
 * This module only reads. Every counted thing the preview shows is computed from the same roster
 * and the same readings that `applyScoreImport` will use, so the sentence and the act cannot
 * disagree — the apply takes this plan and writes exactly its `changes`.
 */

export type Change = {
  enrolmentId: string;
  /** The student's name, for the "old to new" lines. Never written to the log. */
  name: string;
  line: number;
  from: number | null;
  to: number | null;        // null = cleared
  rounded: boolean;
};

export type Excluded = { line: number; identifier: string; reason: string };

export type Preview = {
  column: { id: string; title: string; maxPoints: number; kind: string };
  /** Why this column cannot be imported into, when it cannot. Nothing else is filled in then. */
  refusal: string | null;
  file: { rowCount: number; scoreHeader: string | null; identifierHeader: string | null; ignored: string[] };
  /** Every valid change, in the order the file had them. */
  changes: Change[];
  counts: {
    matched: number;
    newScores: number;
    replaced: number;
    cleared: number;
    rounded: number;
    unmatched: number;
    duplicates: number;
    notNumeric: number;
    belowZero: number;
    overMaximum: number;
    withdrawnSkipped: number;
    demoSkipped: number;
    blank: number;
    noRow: number;
  };
  /** Rows that will not be applied, named by the identifier as typed. */
  excluded: Excluded[];
  /** Students in the class the file says nothing about. Named, not counted only. */
  noRowFor: string[];
  /** The first few replacements, as old to new. */
  samples: { name: string; from: number; to: number | null }[];
  /** Replacing or clearing an existing score needs the tick (decisions 2 and 6). */
  needsReplaceTick: boolean;
  fatal: string | null;
};

export type Options = {
  scoreIndex?: number;
  percentages?: boolean;
  /** Decision 6: blanks clear the score instead of meaning "no change". */
  clearBlanks?: boolean;
  /** Decision 2: keep rows above the column's maximum. */
  allowOverMaximum?: boolean;
};

const SAMPLES = 5;

function emptyCounts(): Preview["counts"] {
  return { matched: 0, newScores: 0, replaced: 0, cleared: 0, rounded: 0, unmatched: 0,
           duplicates: 0, notNumeric: 0, belowZero: 0, overMaximum: 0, withdrawnSkipped: 0,
           demoSkipped: 0, blank: 0, noRow: 0 };
}

/**
 * Build the plan. Nothing here writes, which `test:score-import` proves with a census over every
 * table either side rather than by reading this function.
 */
export async function previewScoreImport(
  sectionId: string, lineItemId: string, text: string, opts: Options = {},
): Promise<Preview> {
  const item = (await db().select().from(lineItems).where(eq(lineItems.id, lineItemId)).limit(1))[0];
  if (!item || item.sectionId !== sectionId) {
    throw new Error("No such column in this class.");
  }
  const column = { id: item.id, title: item.title, maxPoints: item.maxPoints, kind: item.kind };
  const base: Preview = {
    column, refusal: null,
    file: { rowCount: 0, scoreHeader: null, identifierHeader: null, ignored: [] },
    changes: [], counts: emptyCounts(), excluded: [], noRowFor: [], samples: [],
    needsReplaceTick: false, fatal: null,
  };

  // Rule 8: a derived column is refused in the library, not by the page declining to offer a
  // button. Checked before the file is even read, so nothing is computed that cannot be applied.
  const refusal = handEntryRefusal(item);
  if (refusal) return { ...base, refusal };

  const parsed: ParsedFile = parseScoreFile(text, { scoreIndex: opts.scoreIndex });
  const chosen = opts.scoreIndex ?? parsed.headers.scoreColumns[0]?.index;
  base.file = {
    rowCount: parsed.rowCount,
    scoreHeader: chosen == null ? null : (parsed.headers.all[chosen] ?? null),
    identifierHeader: parsed.headers.identifier?.header ?? null,
    ignored: parsed.headers.ignored,
  };
  if (parsed.fatal) return { ...base, fatal: parsed.fatal };

  // Withdrawn students are included so they can be reported as skipped rather than as unmatched
  // (rule 6) — being told "not in this class" about somebody who is would be a lie.
  const gb = await gradebook(sectionId, { includeWithdrawn: true });
  type Student = (typeof gb.students)[number];

  const byD2l = new Map<string, Student>();
  const byEmail = new Map<string, Student>();
  for (const s of gb.students) {
    if (s.d2lUsername) byD2l.set(s.d2lUsername.trim().toLowerCase(), s);
    if (s.email) byEmail.set(s.email.trim().toLowerCase(), s);
  }
  /** Rule 2: the stored D2L username first, then the email — as the class import matches. */
  const match = (identifier: string): Student | null => {
    const k = identifier.trim().toLowerCase();
    if (!k) return null;
    return byD2l.get(k) ?? byEmail.get(k) ?? null;
  };

  const counts = emptyCounts();
  const excluded: Excluded[] = [];
  const changes: Change[] = [];
  const seen = new Map<string, number>();         // enrolmentId -> the line that first had it
  const touched = new Set<string>();

  for (const row of parsed.rows) {
    const who = match(row.identifier);
    if (!who) {
      counts.unmatched++;
      excluded.push({ line: row.line, identifier: row.identifier || "(blank)", reason: "no student in this class" });
      continue;
    }
    const first = seen.get(who.enrolmentId);
    if (first !== undefined) {
      counts.duplicates++;
      excluded.push({ line: row.line, identifier: row.identifier, reason: `the same student as row ${first}` });
      continue;
    }
    seen.set(who.enrolmentId, row.line);

    // Skipped before the value is read, so a withdrawn student with a bad value is reported as
    // withdrawn — which is the thing faculty need to know — rather than as a bad number.
    if (who.withdrawnAt) {
      counts.withdrawnSkipped++;
      excluded.push({ line: row.line, identifier: row.identifier, reason: "withdrawn from this class" });
      continue;
    }
    if (who.isDemo) {
      counts.demoSkipped++;
      excluded.push({ line: row.line, identifier: row.identifier, reason: "the demo account" });
      continue;
    }

    const cell: Cell | undefined = who.cells[item.id];
    const from = cell?.points ?? null;
    const reading = readValue(row.raw, { maxPoints: item.maxPoints, percentages: opts.percentages });

    if (reading.kind === "blank") {
      counts.blank++;
      if (!opts.clearBlanks) continue;            // a blank means no change
      if (from == null) continue;                 // nothing to clear
      counts.matched++; counts.cleared++;
      touched.add(who.enrolmentId);
      changes.push({ enrolmentId: who.enrolmentId, name: who.name, line: row.line, from, to: null, rounded: false });
      continue;
    }
    if (reading.kind === "bad") {
      if (reading.reason === "below zero") counts.belowZero++; else counts.notNumeric++;
      excluded.push({ line: row.line, identifier: row.identifier, reason: reading.reason });
      continue;
    }
    if (item.maxPoints > 0 && reading.points > item.maxPoints && !opts.allowOverMaximum) {
      counts.overMaximum++;
      excluded.push({ line: row.line, identifier: row.identifier,
        reason: `above the maximum of ${item.maxPoints}` });
      continue;
    }

    counts.matched++;
    if (reading.rounded) counts.rounded++;
    if (from == null) counts.newScores++;
    else if (from !== reading.points) counts.replaced++;
    else continue;                                // already exactly that: nothing to write
    touched.add(who.enrolmentId);
    changes.push({ enrolmentId: who.enrolmentId, name: who.name, line: row.line, from, to: reading.points, rounded: reading.rounded });
  }

  // Students the file says nothing about. A withdrawn student is not one of them — they were left
  // out on purpose, and listing them here would read as an oversight.
  const noRowFor = gb.students
    .filter((s) => !s.withdrawnAt && !s.isDemo && !seen.has(s.enrolmentId))
    .map((s) => s.name);
  counts.noRow = noRowFor.length;

  const samples = changes
    .filter((c) => c.from != null)
    .slice(0, SAMPLES)
    .map((c) => ({ name: c.name, from: c.from!, to: c.to }));

  return {
    ...base,
    changes, counts, excluded, noRowFor, samples,
    // Decision 6: clearing counts as replacing, because removing a mark is as consequential.
    needsReplaceTick: counts.replaced + counts.cleared > 0,
    fatal: null,
  };
}

/** The sentence on the tick, so the wording and the enabling live with the rule. */
export function replaceLabel(p: Preview) {
  const n = p.counts.replaced + p.counts.cleared;
  if (n === 0) return null;
  const parts: string[] = [];
  if (p.counts.replaced) parts.push(`${p.counts.replaced} changed`);
  if (p.counts.cleared) parts.push(`${p.counts.cleared} cleared`);
  return `Replace the ${n} score${n === 1 ? "" : "s"} already entered (${parts.join(", ")}).`;
}

/** Whether applying would write anything at all, for enabling the button. */
export const nothingToApply = (p: Preview) => p.changes.length === 0;

// ---------------------------------------------------------------------------------- applying it

export type ApplyResult =
  | { ok: true; counts: Preview["counts"] }
  | { ok: false; error: string };

/**
 * Spec 23 §4: write the plan, all of it or none of it.
 *
 * The preview is rebuilt here from the same file rather than carried over from the browser, for two
 * reasons: a plan computed in a browser is not evidence, and the class may have changed while the
 * preview was on screen. What is written is exactly `preview.changes`, so the counts the log
 * records are the counts that happened.
 */
export async function applyScoreImport(
  userId: string, sectionId: string, lineItemId: string, text: string,
  opts: Options & { confirmReplace?: boolean } = {},
): Promise<ApplyResult> {
  const { canGradeSection } = await import("@/lib/roster");
  if (!(await canGradeSection(userId, sectionId))) {
    return { ok: false, error: "Only this class's faculty, or an administrator, can import scores." };
  }

  const p = await previewScoreImport(sectionId, lineItemId, text, opts);
  if (p.refusal) return { ok: false, error: p.refusal };
  if (p.fatal) return { ok: false, error: p.fatal };
  if (p.needsReplaceTick && !opts.confirmReplace) {
    return { ok: false, error: replaceLabel(p) ?? "Some scores are already entered." };
  }
  if (!p.changes.length) return { ok: true, counts: p.counts };

  const { cleanPoints, ScoreRefused } = await import("@/lib/gradebook");
  const { lineItemScores } = await import("@/db/schema");
  const { and, eq: eqOp } = await import("drizzle-orm");

  // Rule 7: one transaction. A value that the guard would refuse aborts the whole import rather
  // than leaving half of a file applied — the preview should never produce one, and if it does,
  // nothing is written and that is a bug to find rather than a half-graded class to unpick.
  try {
    await db().transaction(async (tx) => {
      for (const c of p.changes) {
        if (c.to == null) {
          await tx.delete(lineItemScores).where(and(
            eqOp(lineItemScores.lineItemId, lineItemId),
            eqOp(lineItemScores.enrolmentId, c.enrolmentId)));
          continue;
        }
        const pts = cleanPoints(c.to);
        if (pts == null) throw new ScoreRefused(`Row ${c.line} is not a score the gradebook accepts.`);
        await tx.insert(lineItemScores)
          .values({ lineItemId, enrolmentId: c.enrolmentId, points: pts, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [lineItemScores.lineItemId, lineItemScores.enrolmentId],
            set: { points: pts, updatedAt: new Date() },
          });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The import did not finish; nothing was written." };
  }

  // Counts only. `logAction` types its detail as Record<string, number>, so there is nowhere to
  // put a name, an address or a score even by accident (rule 10).
  const { logAction } = await import("@/lib/class-actions");
  await logAction(sectionId, userId, "import_scores", p.changes.length, {
    matched: p.counts.matched,
    replaced: p.counts.replaced,
    cleared: p.counts.cleared,
    added: p.counts.newScores,
    rounded: p.counts.rounded,
    unmatched: p.counts.unmatched,
    skipped: p.counts.withdrawnSkipped + p.counts.demoSkipped,
    excluded: p.excluded.length,
  });
  return { ok: true, counts: p.counts };
}
