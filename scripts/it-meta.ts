import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as S from "../src/db/schema.ts";
import { createExam, setExamStatus, startAttempt } from "@/lib/assessment";
let fails = 0; const P = (ok: boolean, m: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "*** FAIL ***"}  ${m}`); };
const d = db();
const mk = (n: number, meta: any) => d.insert(S.questions).values({ id: `mb-c01-00${n}`, bookId: "mb", chapter: 1, objective: "x", difficulty: "apply", stem: `Q${n}`,
  optionsJson: JSON.stringify([{ id: "a", text: "y", correct: true, rationale: "r" }, { id: "b", text: "n", correct: false, rationale: "r" }]),
  points: 1, shuffleOptions: false, contentHash: `h${n}`, metaJson: meta ? JSON.stringify(meta) : null });
await mk(1, { use: "exam", review: { status: "approved", reviewer: "VS", date: "2026-09-25" } });
await mk(2, { use: "exam", review: { status: "draft" } });
await mk(3, { use: "practice", review: { status: "approved", reviewer: "VS", date: "2026-09-25" } });
await mk(4, null); // an older bank with no metadata
const [sec] = await d.insert(S.sections).values({ bookId: "mb", name: "M", joinCode: "MB01" }).returning();
const [u] = await d.insert(S.users).values({ displayName: "s" }).returning();
const [e] = await d.insert(S.enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" }).returning();
const run = async (title: string, blueprint: any) => { await createExam(sec.id, { title, blueprint, feedback: "immediate", timeLimitMin: null, attemptLimit: 50 });
  const ex = (await d.select().from(S.exams).where(eq(S.exams.title, title)))[0]; await setExamStatus(ex.id, "open"); return ex; };
const drawn = new Set<string>(); const ex1 = await run("draw2", { mode: "draw", rules: [{ chapter: 1, difficulty: "any", count: 2 }] });
for (let i = 0; i < 20; i++) { const a = await startAttempt(ex1.id, e.id); (JSON.parse(a.servedJson) as any[]).forEach((s) => drawn.add(s.questionId)); }
P([...drawn].sort().join() === "mb-c01-001,mb-c01-004", `draws use only approved + unlabelled questions over 20 attempts: {${[...drawn].sort().join(", ")}}`);
const ex2 = await run("draw3", { mode: "draw", rules: [{ chapter: 1, difficulty: "any", count: 3 }] });
try { await startAttempt(ex2.id, e.id); P(false, "draw of 3 should fail"); } catch (x: any) { P(/only 2 exist/.test(x.message), `a draw needing 3 reports only 2 eligible: "${x.message.slice(0, 70)}…"`); }
const ex3 = await run("fixed", { mode: "fixed", ids: ["mb-c01-001", "mb-c01-002", "mb-c01-003"] });
try { await startAttempt(ex3.id, e.id); P(false, "fixed with draft should fail"); } catch (x: any) { P(x.message.includes("mb-c01-002 (not yet approved") && x.message.includes("mb-c01-003 (marked for practice only)"), `a fixed exam naming a draft and a practice question is refused, naming both`); }
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
// a failed check has to fail the suite, not just print: this ran green in CI however many
// checks were failing, because printing "*** FAIL ***" still exits 0
if (fails) process.exitCode = 1;
