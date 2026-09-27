import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { questions, sections, users, enrolments, exams, examAttempts, examResponses } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).map((x) => x.slice(0, -4)).sort()) // every migration, so this test never goes stale
  for (const s of readFileSync(`drizzle/${f}.sql`, "utf8").split("--> statement-breakpoint")) { const t = s.trim(); if (t) await client.exec(t); }
console.log("4 migrations applied");

// ingest the real bank
const bank = JSON.parse(readFileSync("content/mis3000/questions.json", "utf8"));
for (const q of bank) {
  const optionsJson = JSON.stringify(q.options);
  await db.insert(questions).values({ id: q.id, bookId: q.book, chapter: q.chapter, section: q.section, objective: q.objective, type: q.type, difficulty: q.difficulty, stem: q.stem, optionsJson, points: q.points, shuffleOptions: q.shuffleOptions, tagsJson: JSON.stringify(q.tags), contentHash: createHash("sha256").update(q.stem).digest("hex").slice(0, 16) });
}
console.log("bank ingested:", bank.length, "questions");

const shuffle = <T>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const opts = (q: any) => JSON.parse(q.optionsJson);
const correctId = (q: any) => opts(q).find((o: any) => o.correct).id;

// section + two students
const [sec] = await db.insert(sections).values({ bookId: "mis3000", name: "A", joinCode: "EX1" }).returning();
const mk = async (n: string) => { const [u] = await db.insert(users).values({ displayName: n }).returning(); const [e] = await db.insert(enrolments).values({ sectionId: sec.id, userId: u.id }).returning(); return e; };
const alice = await mk("Alice"), bob = await mk("Bob");

// exam: draw 5 from ch4, any difficulty
const [exam] = await db.insert(exams).values({ sectionId: sec.id, title: "Ch4 quiz", blueprintJson: JSON.stringify({ mode: "draw", rules: [{ chapter: 4, difficulty: "any", count: 5 }] }), status: "open" }).returning();

async function assemble() {
  const cand = await db.select({ id: questions.id }).from(questions).where(and(eq(questions.bookId, "mis3000"), eq(questions.chapter, 4)));
  return shuffle(cand.map((c) => c.id)).slice(0, 5);
}
async function attemptAndScore(enrId: string, answerAllCorrect: boolean) {
  const picked = await assemble();
  const rows = await db.select().from(questions).where(inArray(questions.id, picked));
  const bankMap = new Map(rows.map((r) => [r.id, r]));
  const maxPoints = picked.reduce((s, id) => s + bankMap.get(id)!.points, 0);
  const [att] = await db.insert(examAttempts).values({ examId: exam.id, enrolmentId: enrId, servedJson: JSON.stringify(picked.map((id) => ({ questionId: id }))), maxPoints }).returning();
  let score = 0;
  for (const id of picked) {
    const q = bankMap.get(id)!; const cid = correctId(q);
    const sel = answerAllCorrect ? cid : opts(q).find((o: any) => !o.correct).id;
    const ok = sel === cid; if (ok) score += q.points;
    await db.insert(examResponses).values({ attemptId: att.id, questionId: id, selectedOptionId: sel, correct: ok, points: ok ? q.points : 0 });
  }
  await db.update(examAttempts).set({ submittedAt: new Date(), score }).where(eq(examAttempts.id, att.id));
  return { picked, score, maxPoints };
}

const ra = await attemptAndScore(alice.id, true);
const rb = await attemptAndScore(bob.id, false);
console.log("Alice served 5:", ra.picked.length === 5, "| all-correct score:", `${ra.score}/${ra.maxPoints}`);
console.log("Bob served 5:", rb.picked.length === 5, "| all-wrong score:", `${rb.score}/${rb.maxPoints}`);
console.log("served sets differ (random draw):", JSON.stringify(ra.picked.sort()) !== JSON.stringify(rb.picked.sort()));

// results + item analysis
const submitted = await db.select().from(examAttempts).where(and(eq(examAttempts.examId, exam.id)));
const resp = await db.select().from(examResponses).where(inArray(examResponses.attemptId, submitted.map((a) => a.id)));
const byQ = new Map<string, { s: number; c: number }>();
for (const r of resp) { const x = byQ.get(r.questionId) ?? { s: 0, c: 0 }; x.s++; if (r.correct) x.c++; byQ.set(r.questionId, x); }
console.log("submissions:", submitted.filter((a) => a.submittedAt).length, "| distinct items answered across class:", byQ.size);
console.log("item analysis sample:", [...byQ.entries()].slice(0, 3).map(([id, x]) => `${id}:${x.c}/${x.s}`).join("  "));
