import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  sections, enrolments, sectionOutcomes, outcomeObjectiveMap, programOutcomes, outcomeProgramMap,
  lineItems, lineItemScores, lineItemOutcomeMap, aolSettings,
} from "@/db/schema";
import { sectionResponses } from "@/lib/mastery";

export type Settings = { program: string | null; meetsPct: number; exceedsPct: number; targetPct: number; minN: number };
const DEFAULTS: Settings = { program: null, meetsPct: 70, exceedsPct: 85, targetPct: 70, minN: 5 };

// ---------------------------------------------------------------- configuration
export async function getSettings(sectionId: string): Promise<Settings> {
  const r = (await db().select().from(aolSettings).where(eq(aolSettings.sectionId, sectionId)).limit(1))[0];
  return r ? { program: r.program, meetsPct: r.meetsPct, exceedsPct: r.exceedsPct, targetPct: r.targetPct, minN: r.minN } : { ...DEFAULTS };
}
export async function setSettings(sectionId: string, s: Settings) {
  await db().insert(aolSettings).values({ sectionId, ...s }).onConflictDoUpdate({ target: aolSettings.sectionId, set: s });
}
export async function loadProgramOutcomes(rows: { program: string; framework: string; code: string; label: string; sourceUrl?: string; capturedAt?: string }[]) {
  for (const r of rows) {
    const id = `${r.program}:${r.code}`;
    const v = { program: r.program, framework: r.framework, code: r.code, label: r.label, sourceUrl: r.sourceUrl ?? null, capturedAt: r.capturedAt ?? null };
    await db().insert(programOutcomes).values({ id, ...v }).onConflictDoUpdate({ target: programOutcomes.id, set: v });
  }
}
export async function listPrograms() {
  const rows = await db().select({ program: programOutcomes.program }).from(programOutcomes);
  return [...new Set(rows.map((r) => r.program))].sort();
}
export async function programOutcomesFor(program: string) {
  return (await db().select().from(programOutcomes).where(eq(programOutcomes.program, program))).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}
export async function toggleProgramMap(outcomeId: string, programOutcomeId: string, on: boolean) {
  if (on) await db().insert(outcomeProgramMap).values({ outcomeId, programOutcomeId }).onConflictDoNothing();
  else await db().delete(outcomeProgramMap).where(and(eq(outcomeProgramMap.outcomeId, outcomeId), eq(outcomeProgramMap.programOutcomeId, programOutcomeId)));
}
export async function setEvidence(lineItemId: string, outcomeId: string, evidenceType: string | null) {
  await db().delete(lineItemOutcomeMap).where(and(eq(lineItemOutcomeMap.lineItemId, lineItemId), eq(lineItemOutcomeMap.outcomeId, outcomeId)));
  if (evidenceType) await db().insert(lineItemOutcomeMap).values({ lineItemId, outcomeId, evidenceType });
}

// Everything the report needs about how this section is mapped.
export async function aolConfig(sectionId: string) {
  const outcomes = await db().select().from(sectionOutcomes).where(eq(sectionOutcomes.sectionId, sectionId));
  const ids = outcomes.map((o) => o.id);
  const [objMaps, progMaps, evMaps, items] = await Promise.all([
    ids.length ? db().select().from(outcomeObjectiveMap).where(inArray(outcomeObjectiveMap.outcomeId, ids)) : Promise.resolve([]),
    ids.length ? db().select().from(outcomeProgramMap).where(inArray(outcomeProgramMap.outcomeId, ids)) : Promise.resolve([]),
    ids.length ? db().select().from(lineItemOutcomeMap).where(inArray(lineItemOutcomeMap.outcomeId, ids)) : Promise.resolve([]),
    db().select().from(lineItems).where(eq(lineItems.sectionId, sectionId)),
  ]);
  return {
    lineItems: items,
    outcomes: outcomes.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((o) => ({
      id: o.id, code: o.code, description: o.description,
      objectiveIds: objMaps.filter((m) => m.outcomeId === o.id).map((m) => m.objectiveId),
      programOutcomeIds: progMaps.filter((m) => m.outcomeId === o.id).map((m) => m.programOutcomeId),
      evidence: evMaps.filter((m) => m.outcomeId === o.id).map((m) => ({ lineItemId: m.lineItemId, evidenceType: m.evidenceType })),
    })),
  };
}

// ---------------------------------------------------------------- results
export type Measure = {
  label: string; evidenceType: string; n: number; exceeds: number; meets: number; below: number;
  shareMeeting: number | null; benchmarkMet: boolean | null; tooFew: boolean; itemCount?: number;
};

function summarise(label: string, evidenceType: string, scores: number[], s: Settings, itemCount?: number): Measure {
  const n = scores.length;
  const exceeds = scores.filter((x) => x >= s.exceedsPct).length;
  const meetsOrBetter = scores.filter((x) => x >= s.meetsPct).length;
  const share = n ? Math.round((meetsOrBetter / n) * 100) : null;
  return {
    label, evidenceType, n, exceeds, meets: meetsOrBetter - exceeds, below: n - meetsOrBetter,
    shareMeeting: share, benchmarkMet: share == null ? null : share >= s.targetPct, tooFew: n > 0 && n < s.minN, itemCount,
  };
}

export async function aolReport(sectionId: string) {
  const sec = (await db().select().from(sections).where(eq(sections.id, sectionId)).limit(1))[0];
  const settings = await getSettings(sectionId);
  const cfg = await aolConfig(sectionId);
  const students = (await db().select({ id: enrolments.id }).from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")))).map((r) => r.id);
  const studentSet = new Set(students);
  const responses = (await sectionResponses(sectionId)).filter((r) => studentSet.has(r.enrolmentId));
  const liIds = [...new Set(cfg.outcomes.flatMap((o) => o.evidence.map((e) => e.lineItemId)))];
  const scores = liIds.length ? await db().select().from(lineItemScores).where(inArray(lineItemScores.lineItemId, liIds)) : [];
  const liById = new Map(cfg.lineItems.map((l) => [l.id, l]));

  const courseOutcomes = cfg.outcomes.map((o) => {
    const measures: Measure[] = [];
    const perStudent = new Map<string, number[]>(); // for the combined result
    // questions tied to this outcome's objectives
    if (o.objectiveIds.length) {
      const set = new Set(o.objectiveIds);
      const acc = new Map<string, { served: number; correct: number }>(); const items = new Set<string>();
      for (const r of responses) {
        if (!r.objectiveId || !set.has(r.objectiveId)) continue;
        const a = acc.get(r.enrolmentId) ?? { served: 0, correct: 0 }; a.served++; if (r.correct) a.correct++; acc.set(r.enrolmentId, a);
        items.add(r.questionId);
      }
      const pcts: number[] = [];
      for (const [enr, a] of acc) { const p = (a.correct / a.served) * 100; pcts.push(p); (perStudent.get(enr) ?? perStudent.set(enr, []).get(enr)!).push(p); }
      measures.push(summarise("Question bank", "Multiple-choice questions (recognition and interpretation)", pcts, settings, items.size));
    }
    // simulation / graded work columns counted as evidence
    for (const e of o.evidence) {
      const li = liById.get(e.lineItemId); if (!li || !li.maxPoints) continue;
      const pcts: number[] = [];
      for (const sc of scores) {
        if (sc.lineItemId !== li.id || !studentSet.has(sc.enrolmentId)) continue;
        const p = (sc.points / li.maxPoints) * 100; pcts.push(p);
        (perStudent.get(sc.enrolmentId) ?? perStudent.set(sc.enrolmentId, []).get(sc.enrolmentId)!).push(p);
      }
      measures.push(summarise(li.title, e.evidenceType === "simulation" ? "Simulation (performance)" : "Graded work (performance)", pcts, settings));
    }
    const combinedScores = [...perStudent.values()].map((v) => v.reduce((s, x) => s + x, 0) / v.length);
    const combined = measures.length > 1 ? summarise("All evidence combined", "Average of each student's measures", combinedScores, settings) : (measures[0] ?? null);
    return { ...o, measures, combined };
  });

  const programs = settings.program ? await programOutcomesFor(settings.program) : [];
  const programResults = programs.map((p) => {
    const contributing = courseOutcomes.filter((o) => o.programOutcomeIds.includes(p.id));
    const withEvidence = contributing.filter((o) => o.combined && o.combined.n > 0);
    return { ...p, contributing: contributing.map((o) => ({ code: o.code, shareMeeting: o.combined?.shareMeeting ?? null, benchmarkMet: o.combined?.benchmarkMet ?? null, n: o.combined?.n ?? 0 })),
      status: !contributing.length ? "Not addressed by this course" : !withEvidence.length ? "Mapped, but no evidence collected" : withEvidence.every((o) => o.combined!.benchmarkMet) ? "Benchmark met" : "Benchmark not met by every contributing outcome" };
  });

  return { section: { id: sec.id, name: sec.name, bookId: sec.bookId, term: sec.term }, settings, studentCount: students.length, courseOutcomes, programResults, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- rendering
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const yn = (v: boolean | null) => (v == null ? "—" : v ? "Yes" : "No");

export function reportMarkdown(r: Awaited<ReturnType<typeof aolReport>>) {
  const s = r.settings; const L: string[] = [];
  L.push(`# Assurance of learning report`, ``,
    `**Course:** ${r.section.bookId.toUpperCase()} — ${r.section.name}${r.section.term ? ` — ${r.section.term}` : ""}  `,
    `**Program reported to:** ${s.program ?? "not set"}  `,
    `**Students enrolled:** ${r.studentCount}  `,
    `**Generated:** ${r.generatedAt.slice(0, 10)}`, ``,
    `**Benchmark.** A student meets expectations at ${s.meetsPct}% or above and exceeds them at ${s.exceedsPct}% or above. ` +
    `The benchmark is met when at least ${s.targetPct}% of assessed students meet or exceed expectations. ` +
    `Results are for the class as a whole; no individual student is identified. Any measure with fewer than ${s.minN} students assessed is marked as too few to support a conclusion.`, ``,
    `## Results by course outcome`, ``);
  for (const o of r.courseOutcomes) {
    L.push(`### ${o.code} — ${o.description}`, ``);
    if (!o.measures.length) { L.push(`No evidence is mapped to this outcome.`, ``); continue; }
    L.push(`| Measure | Evidence type | Students assessed | Exceeds | Meets | Below | Meeting or exceeding | Benchmark met |`, `|---|---|---|---|---|---|---|---|`);
    const rows = o.measures.length > 1 && o.combined ? [...o.measures, o.combined] : o.measures;
    for (const m of rows) L.push(`| ${m.label}${m.itemCount ? ` (${m.itemCount} questions)` : ""} | ${m.evidenceType} | ${m.n}${m.tooFew ? " — too few" : ""} | ${m.exceeds} | ${m.meets} | ${m.below} | ${pct(m.shareMeeting)} | ${yn(m.benchmarkMet)} |`);
    L.push(``);
  }
  if (r.programResults.length) {
    L.push(`## Results by program outcome`, ``, `| Program outcome | Course outcomes contributing | Status |`, `|---|---|---|`);
    for (const p of r.programResults) {
      const c = p.contributing.length ? p.contributing.map((x) => `${x.code} (${pct(x.shareMeeting)}, n=${x.n})`).join("; ") : "—";
      L.push(`| ${p.code}. ${p.label} | ${c} | ${p.status} |`);
    }
    const src = r.programResults.find((p) => p.sourceUrl);
    if (src) L.push(``, `Program outcomes as published at ${src.sourceUrl}${src.capturedAt ? `, captured ${src.capturedAt}` : ""}.`);
    L.push(``);
  }
  L.push(`## Faculty interpretation and actions`, ``,
    `To be completed by the instructor. For each outcome: what the results show, whether the benchmark was met, and what will change as a result (closing the loop).`, ``);
  for (const o of r.courseOutcomes) L.push(`**${o.code}.** `, ``);
  L.push(`---`, ``, `Question evidence reflects each question exactly as it was presented to students at the time of the attempt.`);
  return L.join("\n") + "\n";
}

export function reportCsv(r: Awaited<ReturnType<typeof aolReport>>) {
  const esc = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = [["course_outcome", "measure", "evidence_type", "students_assessed", "exceeds", "meets", "below", "share_meeting_pct", "benchmark_met", "too_few", "program_outcomes"]];
  for (const o of r.courseOutcomes) {
    const all = o.measures.length > 1 && o.combined ? [...o.measures, o.combined] : o.measures;
    for (const m of all) rows.push([o.code, m.label, m.evidenceType, String(m.n), String(m.exceeds), String(m.meets), String(m.below),
      m.shareMeeting == null ? "" : String(m.shareMeeting), m.benchmarkMet == null ? "" : String(m.benchmarkMet), String(m.tooFew),
      o.programOutcomeIds.map((id) => id.split(":")[1]).join(" ")]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
