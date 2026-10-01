// Integration test for assurance of learning, run against the REAL library code:
//   node --import ./scripts/test-support/register.mjs --experimental-strip-types scripts/it-aol.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as S from "../src/db/schema.ts";
import { createExam, setExamStatus, startAttempt, submitAttempt, attemptResult } from "@/lib/assessment";
import { addOutcome, mapOutcome } from "@/lib/mastery";
import { addManualItem, setScore } from "@/lib/gradebook";
import { setSettings, loadProgramOutcomes, toggleProgramMap, setEvidence, aolReport, reportMarkdown, reportCsv } from "@/lib/aol";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";

let fails = 0; const P = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "*** FAIL ***"}  ${msg}`); };
const d = db();

// book: 2 objectives x 4 questions
await d.insert(S.learningObjectives).values([
  { id: "tbk-c01-o1", bookId: "tbk", chapter: 1, code: "C1.1", label: "Model data" },
  { id: "tbk-c01-o2", bookId: "tbk", chapter: 1, code: "C1.2", label: "Model process" },
]);
const qids: string[] = [];
for (let i = 1; i <= 8; i++) {
  const id = `tbk-c01-${String(i).padStart(3, "0")}`; qids.push(id);
  await d.insert(S.questions).values({ id, bookId: "tbk", chapter: 1, objective: "x", objectiveId: i <= 4 ? "tbk-c01-o1" : "tbk-c01-o2", difficulty: "apply",
    stem: `Original stem ${i}`, optionsJson: JSON.stringify([{ id: "a", text: "right", correct: true, rationale: "r" }, { id: "b", text: "wrong", correct: false, rationale: "w" }]),
    points: 1, shuffleOptions: false, contentHash: `h${i}` });
}
const [sec] = await d.insert(S.sections).values({ bookId: "tbk", name: "Section 01", joinCode: "AOL1", term: "2027 Spring" }).returning();
const [prof] = await d.insert(S.users).values({ displayName: "Prof" }).returning();
await d.insert(S.enrolments).values({ sectionId: sec.id, userId: prof.id, role: "instructor" });
const enr: string[] = [];
for (let i = 1; i <= 6; i++) {
  const [u] = await d.insert(S.users).values({ displayName: `S${i}` }).returning();
  const [e] = await d.insert(S.enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" }).returning(); enr.push(e.id);
}
await createExam(sec.id, { title: "Exam 1", blueprint: { mode: "fixed", ids: qids }, feedback: "immediate", timeLimitMin: null, attemptLimit: 1 });
const exam = (await d.select().from(S.exams).where(eq(S.exams.sectionId, sec.id)))[0];
await setExamStatus(exam.id, "open");
// correct answers per student on o1 (q1-4) and o2 (q5-8)
const plan = [[4, 4], [3, 2], [3, 3], [2, 4], [4, 1], [1, 3]];
const attempts: string[] = [];
for (let s = 0; s < 6; s++) {
  const a = await startAttempt(exam.id, enr[s]); attempts.push(a.id);
  const ans: Record<string, string> = {};
  qids.forEach((q, i) => { const within = i < 4 ? i : i - 4; const need = i < 4 ? plan[s][0] : plan[s][1]; ans[q] = within < need ? "a" : "b"; });
  await submitAttempt(a.id, ans);
}
// the instructor also takes it (must not be counted)
{ const a = await startAttempt(exam.id, (await d.select().from(S.enrolments).where(eq(S.enrolments.role, "instructor")))[0].id);
  await submitAttempt(a.id, Object.fromEntries(qids.map((q) => [q, "b"]))); }

// simulation column: s1..s5 scored, s6 not
await addManualItem(sec.id, "MVCFN model quality", 100, 1);
const sim = (await d.select().from(S.lineItems).where(eq(S.lineItems.title, "MVCFN model quality")))[0];
for (const [i, pts] of [[0, 90], [1, 80], [2, 60], [3, 70], [4, 95]] as const) await setScore(sim.id, enr[i], pts);

// course outcomes A (o1), B (o2 + simulation), C (simulation only)
await addOutcome(sec.id, "A", "Model data"); await addOutcome(sec.id, "B", "Model process"); await addOutcome(sec.id, "C", "Work in a team");
const oc = Object.fromEntries((await d.select().from(S.sectionOutcomes)).map((o) => [o.code, o.id]));
await mapOutcome(oc.A, "tbk-c01-o1"); await mapOutcome(oc.B, "tbk-c01-o2");
await setEvidence(sim.id, oc.B, "simulation"); await setEvidence(sim.id, oc.C, "simulation");
await loadProgramOutcomes([1, 2, 3, 5].map((n) => ({ program: "wsu-mis-bsb", framework: "ABET student outcome", code: `SO${n}`, label: `Outcome ${n}`, sourceUrl: "https://example.edu", capturedAt: "2026-09-25" })));
await toggleProgramMap(oc.A, "wsu-mis-bsb:SO1", true); await toggleProgramMap(oc.B, "wsu-mis-bsb:SO2", true);
await toggleProgramMap(oc.C, "wsu-mis-bsb:SO2", true); await toggleProgramMap(oc.C, "wsu-mis-bsb:SO5", true);
await setSettings(sec.id, { program: "wsu-mis-bsb", meetsPct: 70, exceedsPct: 85, targetPct: 70, minN: 5 });

const byCode = (r: Awaited<ReturnType<typeof aolReport>>, c: string) => r.courseOutcomes.find((o) => o.code === c)!;
let r = await aolReport(sec.id);
console.log("== course outcomes (hand-computed expectations) ==");
const A = byCode(r, "A").measures[0];
P(A.n === 6 && A.exceeds === 2 && A.meets === 2 && A.below === 2 && A.shareMeeting === 67 && A.benchmarkMet === false && A.itemCount === 4,
  `A questions: n6, exceeds2 meets2 below2, 67% -> benchmark not met, 4 items   [got n${A.n} ${A.exceeds}/${A.meets}/${A.below} ${A.shareMeeting}% items${A.itemCount}]`);
const B = byCode(r, "B"); const Bq = B.measures[0], Bs = B.measures[1], Bc = B.combined!;
P(Bs.n === 5 && Bs.exceeds === 2 && Bs.meets === 2 && Bs.below === 1 && Bs.shareMeeting === 80 && Bs.benchmarkMet === true && Bs.evidenceType.startsWith("Simulation"),
  `B simulation: n5, 2/2/1, 80% met, labelled simulation   [got n${Bs.n} ${Bs.exceeds}/${Bs.meets}/${Bs.below} ${Bs.shareMeeting}%]`);
P(Bc.n === 6 && Bc.exceeds === 2 && Bc.meets === 1 && Bc.below === 3 && Bc.shareMeeting === 50 && Bc.benchmarkMet === false,
  `B combined (per-student average): n6, 2/1/3, 50% not met   [got n${Bc.n} ${Bc.exceeds}/${Bc.meets}/${Bc.below} ${Bc.shareMeeting}%]`);
P(Bq.shareMeeting === 67, `B questions alone 67%   [got ${Bq.shareMeeting}%]`);
const C = byCode(r, "C");
P(C.measures.length === 1 && C.combined!.shareMeeting === 80 && C.combined!.tooFew === false, `C simulation only: 80%, n5 not flagged at minN 5`);
P(A.n === 6, "instructor's attempt excluded (6 students, not 7)");

console.log("\n== program outcomes ==");
const st = Object.fromEntries(r.programResults.map((p) => [p.code, p.status]));
P(st.SO1 === "Benchmark not met by every contributing outcome", `SO1 <- A (67%): ${st.SO1}`);
P(st.SO2 === "Benchmark not met by every contributing outcome", `SO2 <- B (50%) + C (80%): ${st.SO2}`);
P(st.SO3 === "Not addressed by this course", `SO3 unmapped: ${st.SO3}`);
P(st.SO5 === "Benchmark met", `SO5 <- C (80%): ${st.SO5}`);

console.log("\n== small groups ==");
await setSettings(sec.id, { program: "wsu-mis-bsb", meetsPct: 70, exceedsPct: 85, targetPct: 70, minN: 6 });
r = await aolReport(sec.id);
P(byCode(r, "C").combined!.tooFew === true && byCode(r, "A").measures[0].tooFew === false, "minN 6: simulation (n5) flagged too few; questions (n6) not");
await setSettings(sec.id, { program: "wsu-mis-bsb", meetsPct: 70, exceedsPct: 85, targetPct: 70, minN: 5 });

console.log("\n== questions frozen as served ==");
await d.update(S.questions).set({ stem: "EDITED stem", objectiveId: "tbk-c01-o2" }).where(eq(S.questions.id, qids[0]));
const res = await attemptResult(attempts[0]);
P(res!.items.some((i) => i.stem === "Original stem 1") && !res!.items.some((i) => i.stem === "EDITED stem"), "student review shows the question as it was served, not the edited bank");
r = await aolReport(sec.id);
const A2 = byCode(r, "A").measures[0];
P(A2.n === 6 && A2.shareMeeting === 67 && A2.itemCount === 4, "AoL evidence unchanged after the bank edit (objective taken from the snapshot)");

console.log("\n== outputs ==");
const md = reportMarkdown(r), csv = reportCsv(r);
P(md.includes("## Results by course outcome") && md.includes("## Results by program outcome") && md.includes("## Faculty interpretation and actions") && md.includes("Not addressed by this course"), "report has outcome, program, and closing-the-loop sections");
P(!/S[1-6]\b/.test(md) && !md.includes("Prof"), "report names no individual");
P(csv.split("\n").filter(Boolean).length === 1 + 1 + 3 + 1, `CSV: header + A(1) + B(3) + C(1) rows   [got ${csv.split("\n").filter(Boolean).length}]`);
console.log(`\n${fails ? `${fails} FAILED` : "ALL PASSED"}`);
// a sample of the report, for eyeballing — in the system temp folder, so this runs anywhere
const samplePath = path.join(tmpdir(), "aol_sample.md");
writeFileSync(samplePath, md);
console.log(`sample report written to ${samplePath}`);
// a failed check has to fail the suite, not just print: this ran green in CI however many
// checks were failing, because printing "*** FAIL ***" still exits 0
if (fails) process.exitCode = 1;
