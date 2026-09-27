import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { questions, learningObjectives, sections, users, enrolments, exams, examAttempts, examResponses, sectionOutcomes, outcomeObjectiveMap } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).map((x) => x.slice(0, -4)).sort()) // every migration, so this test never goes stale
  for (const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")) { const t = s.trim(); if (t) await client.exec(t); }
console.log("5 migrations applied");

// ingest objectives + questions (with objectiveId)
for (const o of JSON.parse(readFileSync("content/mis3000/objectives.json","utf8")))
  await db.insert(learningObjectives).values({ id:o.id, bookId:o.book, chapter:o.chapter, code:o.code, label:o.label, bloom:o.bloom });
const bank = JSON.parse(readFileSync("content/mis3000/questions.json","utf8"));
for (const q of bank)
  await db.insert(questions).values({ id:q.id, bookId:q.book, chapter:q.chapter, section:q.section, objective:q.objective, objectiveId:q.objectiveId, type:q.type, difficulty:q.difficulty, stem:q.stem, optionsJson:JSON.stringify(q.options), points:q.points, shuffleOptions:q.shuffleOptions, tagsJson:JSON.stringify(q.tags), contentHash:createHash("sha256").update(q.stem).digest("hex").slice(0,16) });
console.log("ingested objectives:", (await db.select().from(learningObjectives)).length, "questions:", bank.length, "all linked:", bank.every((q:any)=>q.objectiveId));

const opts = (q:any)=>JSON.parse(q.optionsJson); const correctId=(q:any)=>opts(q).find((o:any)=>o.correct).id;
const [sec] = await db.insert(sections).values({ bookId:"mis3000", name:"A", joinCode:"M1" }).returning();
const mk = async(n:string)=>{ const [u]=await db.insert(users).values({displayName:n}).returning(); const [e]=await db.insert(enrolments).values({sectionId:sec.id,userId:u.id}).returning(); return e; };
const alice=await mk("Alice"), bob=await mk("Bob");
const [exam]=await db.insert(exams).values({ sectionId:sec.id, title:"Ch4", blueprintJson:JSON.stringify({mode:"draw",rules:[{chapter:4,difficulty:"any",count:8}]}), status:"open" }).returning();

async function take(enrId:string, allCorrect:boolean){
  const cand=await db.select().from(questions).where(and(eq(questions.bookId,"mis3000"),eq(questions.chapter,4)));
  const picked=cand.sort(()=>Math.random()-.5).slice(0,8);
  const [att]=await db.insert(examAttempts).values({examId:exam.id,enrolmentId:enrId,servedJson:JSON.stringify(picked.map(p=>({questionId:p.id}))),maxPoints:picked.length}).returning();
  for(const q of picked){ const sel=allCorrect?correctId(q):opts(q).find((o:any)=>!o.correct).id; const ok=sel===correctId(q);
    await db.insert(examResponses).values({attemptId:att.id,questionId:q.id,selectedOptionId:sel,correct:ok,points:ok?1:0}); }
  await db.update(examAttempts).set({submittedAt:new Date()}).where(eq(examAttempts.id,att.id));
}
await take(alice.id,true); await take(bob.id,false);

// classMastery aggregation (mirror of lib)
const examRows=await db.select({id:exams.id}).from(exams).where(eq(exams.sectionId,sec.id));
const atts=await db.select().from(examAttempts).where(inArray(examAttempts.examId,examRows.map(e=>e.id)));
const resp=await db.select().from(examResponses).where(inArray(examResponses.attemptId,atts.map(a=>a.id)));
const qrows=await db.select().from(questions).where(inArray(questions.id,[...new Set(resp.map(r=>r.questionId))]));
const objOf=new Map(qrows.map(q=>[q.id,q.objectiveId]));
const agg=new Map<string,{s:number,c:number}>();
for(const r of resp){ const oid=objOf.get(r.questionId)!; const a=agg.get(oid)??{s:0,c:0}; a.s++; if(r.correct)a.c++; agg.set(oid,a); }
console.log("\nMastery by objective:");
for(const o of await db.select().from(learningObjectives)){ const a=agg.get(o.id); console.log(`  ${o.id}: ${a?Math.round(a.c/a.s*100):"—"}% (${a?a.c+"/"+a.s:"0"})  ${o.label.slice(0,40)}`); }

// syllabus rollup
const [outcome]=await db.insert(sectionOutcomes).values({sectionId:sec.id,code:"CLO-1",description:"Evaluate AI claims and pilots critically"}).returning();
await db.insert(outcomeObjectiveMap).values({outcomeId:outcome.id,objectiveId:"mis3000-c04-o1"});
await db.insert(outcomeObjectiveMap).values({outcomeId:outcome.id,objectiveId:"mis3000-c04-o3"});
const mapped=["mis3000-c04-o1","mis3000-c04-o3"].map(id=>{const a=agg.get(id); return a?Math.round(a.c/a.s*100):null;}).filter(x=>x!=null) as number[];
console.log(`\nSyllabus outcome CLO-1 rollup (o1+o3): ${mapped.length?Math.round(mapped.reduce((s,x)=>s+x,0)/mapped.length):"—"}%  <- mastery rolled up to a faculty outcome`);
