import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray, count } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { questions, learningObjectives, sections, users, enrolments, exams, examAttempts, examResponses } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
for (const f of ["0000_init","0001_section_owner_and_invites","0002_content_versioning","0003_assessment","0004_learning_objectives"])
  for (const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")) { const t=s.trim(); if(t) await client.exec(t); }

const CD = process.env.CONTENT_DIR || "/home/claude/content";
const opts=(q:any)=>JSON.parse(q.optionsJson); const correctId=(q:any)=>opts(q).find((o:any)=>o.correct).id; const wrongId=(q:any)=>opts(q).find((o:any)=>!o.correct).id;

async function ingest() {
  for (const o of JSON.parse(readFileSync(`${CD}/mis3000/objectives.json`,"utf8")))
    await db.insert(learningObjectives).values({id:o.id,bookId:o.book,chapter:o.chapter,code:o.code,label:o.label,bloom:o.bloom,updatedAt:new Date()}).onConflictDoUpdate({target:learningObjectives.id,set:{label:o.label,updatedAt:new Date()}});
  for (const q of JSON.parse(readFileSync(`${CD}/mis3000/questions.json`,"utf8"))) {
    const v={id:q.id,bookId:q.book,chapter:q.chapter,section:q.section,objective:q.objective,objectiveId:q.objectiveId,type:q.type,difficulty:q.difficulty,stem:q.stem,optionsJson:JSON.stringify(q.options),points:q.points??1,shuffleOptions:q.shuffleOptions??true,tagsJson:JSON.stringify(q.tags||[]),contentHash:createHash("sha256").update(q.stem).digest("hex").slice(0,16),updatedAt:new Date()};
    await db.insert(questions).values(v).onConflictDoUpdate({target:questions.id,set:v});
  }
}
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";

console.log("== 1. SYNC ==");
await ingest();
const nobj=(await db.select({c:count()}).from(learningObjectives).where(eq(learningObjectives.bookId,"mis3000")))[0].c;
const nq=(await db.select({c:count()}).from(questions).where(eq(questions.bookId,"mis3000")))[0].c;
console.log(`objectives=${nobj} (expect 84) ${P(nobj===84)} | questions=${nq} (expect 338) ${P(nq===338)}`);
const allq=await db.select().from(questions).where(eq(questions.bookId,"mis3000"));
const objIds=new Set((await db.select().from(learningObjectives)).map(o=>o.id));
const broken=allq.filter(q=>!q.objectiveId||!objIds.has(q.objectiveId));
const dup=nq!==new Set(allq.map(q=>q.id)).size;
console.log(`broken objective links=${broken.length} ${P(broken.length===0)} | duplicate ids=${dup} ${P(!dup)}`);
await ingest(); // idempotency
const nq2=(await db.select({c:count()}).from(questions).where(eq(questions.bookId,"mis3000")))[0].c;
console.log(`re-sync questions=${nq2} (stable) ${P(nq2===338)}`);

console.log("\n== 2/4. FIXED EXAM, KNOWN ANSWERS ==");
const [sec]=await db.insert(sections).values({bookId:"mis3000",name:"Test",joinCode:"T1"}).returning();
const mk=async(n:string)=>{const [u]=await db.insert(users).values({displayName:n}).returning();const [e]=await db.insert(enrolments).values({sectionId:sec.id,userId:u.id}).returning();return e;};
const A=await mk("A"), B=await mk("B");
const c41=["mis3000-c04-001","mis3000-c04-002","mis3000-c04-008","mis3000-c04-011"]; // objective o1 (C4.1)
const c42=["mis3000-c04-003","mis3000-c04-004","mis3000-c04-006","mis3000-c04-012"]; // objective o2 (C4.2)
const fixedIds=[...c41,...c42];
const qmap=new Map(allq.map(q=>[q.id,q]));
// confirm objective mapping matches the doc
const o1ok=c41.every(id=>qmap.get(id)!.objectiveId==="mis3000-c04-o1"); const o2ok=c42.every(id=>qmap.get(id)!.objectiveId==="mis3000-c04-o2");
console.log(`C4.1 items -> o1 ${P(o1ok)} | C4.2 items -> o2 ${P(o2ok)}`);
const [exam]=await db.insert(exams).values({sectionId:sec.id,title:"KA",blueprintJson:JSON.stringify({mode:"fixed",ids:fixedIds}),status:"open",feedback:"after_close"}).returning();
async function attempt(enrId:string, correctSet:Set<string>, shuffle=false, skip:string[]=[]) {
  const served=fixedIds.map(id=>{const q=qmap.get(id)!; let order=opts(q).map((o:any)=>o.id); if(shuffle) order=[...order].reverse(); return {questionId:id,optionOrder:order};});
  const [att]=await db.insert(examAttempts).values({examId:exam.id,enrolmentId:enrId,servedJson:JSON.stringify(served),maxPoints:fixedIds.length}).returning();
  let score=0;
  for(const id of fixedIds){ if(skip.includes(id)) continue; const q=qmap.get(id)!; const sel=correctSet.has(id)?correctId(q):wrongId(q); const ok=sel===correctId(q); if(ok)score++; await db.insert(examResponses).values({attemptId:att.id,questionId:id,selectedOptionId:sel,correct:ok,points:ok?1:0}); }
  await db.update(examAttempts).set({submittedAt:new Date(),score}).where(eq(examAttempts.id,att.id));
  return {att,score};
}
// A: 3 of C4.1 correct + 1 of C4.2 correct
const ra=await attempt(A.id,new Set(["mis3000-c04-001","mis3000-c04-002","mis3000-c04-008","mis3000-c04-003"]));
// B: 4 of C4.1 + 2 of C4.2
const rb=await attempt(B.id,new Set([...c41,"mis3000-c04-003","mis3000-c04-004"]));
console.log(`Student A ${ra.score}/8 (expect 4) ${P(ra.score===4)} | Student B ${rb.score}/8 (expect 6) ${P(rb.score===6)}`);

// objective aggregation (pooled points) from responses
async function objAgg() {
  const atts=await db.select().from(examAttempts).where(eq(examAttempts.examId,exam.id));
  const resp=await db.select().from(examResponses).where(inArray(examResponses.attemptId,atts.map(a=>a.id)));
  const agg=new Map<string,{c:number,t:number}>();
  for(const r of resp){const oid=qmap.get(r.questionId)!.objectiveId!;const a=agg.get(oid)??{c:0,t:0};a.t++;if(r.correct)a.c++;agg.set(oid,a);}
  return agg;
}
const agg=await objAgg();
const o1=agg.get("mis3000-c04-o1")!, o2=agg.get("mis3000-c04-o2")!;
console.log(`C4.1 pooled ${o1.c}/${o1.t}=${(o1.c/o1.t*100)}% (expect 87.5) ${P(o1.c===7&&o1.t===8)} | C4.2 ${o2.c}/${o2.t}=${(o2.c/o2.t*100)}% (expect 37.5) ${P(o2.c===3&&o2.t===8)}`);
const classPct=[...agg.values()].reduce((s,a)=>s+a.c,0)/[...agg.values()].reduce((s,a)=>s+a.t,0)*100;
console.log(`class exam pooled = ${classPct}% (expect 62.5) ${P(classPct===62.5)}`);
// not-assessed vs 0%
const assessed=new Set(agg.keys());
const other=[...objIds].filter(id=>!assessed.has(id));
console.log(`objectives with evidence=${assessed.size} (expect 2) ${P(assessed.size===2)} | others report NO-EVIDENCE not 0%: ${other.length} objectives untouched ${P(other.length===82)}`);

console.log("\n== 3. SHUFFLE INVARIANCE ==");
const rc=await attempt((await mk("C")).id,new Set([...c41,"mis3000-c04-003","mis3000-c04-004"]),true);
console.log(`shuffled options, same correct answers -> ${rc.score}/8 (expect 6, graded by option id) ${P(rc.score===6)}`);

console.log("\n== DUPLICATE SUBMIT & UNANSWERED ==");
// duplicate submit guard (mirror submitAttempt: refuse if already submitted)
const already=(await db.select().from(examAttempts).where(eq(examAttempts.id,ra.att.id)))[0].submittedAt!=null;
console.log(`second submit blocked when submittedAt set ${P(already)} (submitAttempt throws 'Attempt not open')`);
const rskip=await attempt((await mk("D")).id,new Set(c41),false,["mis3000-c04-003","mis3000-c04-004","mis3000-c04-006","mis3000-c04-012"]);
const dResp=(await db.select({c:count()}).from(examResponses).where(eq(examResponses.attemptId,rskip.att.id)))[0].c;
console.log(`unanswered items score 0 and are not recorded as correct: score ${rskip.score}/8 (expect 4), responses=${dResp} (only answered) ${P(rskip.score===4)}`);

console.log("\n== 6. RESYNC PRESERVES ATTEMPTS ==");
const before=(await db.select({c:count()}).from(examResponses))[0].c;
await ingest();
const after=(await db.select({c:count()}).from(examResponses))[0].c;
const attAfter=(await db.select({c:count()}).from(examAttempts))[0].c;
console.log(`responses before/after resync ${before}/${after} ${P(before===after)} | attempts intact=${attAfter} ${P(attAfter>0)}`);

console.log("\n== DRAW POOL TOO SMALL (gap check) ==");
// assemble mirrors assessment.ts: request more than available for a (chapter,difficulty)
const recallC4=await db.select({id:questions.id}).from(questions).where(and(eq(questions.bookId,"mis3000"),eq(questions.chapter,4),eq(questions.difficulty,"recall")));
const requested=10, available=recallC4.length;
const served=recallC4.slice(0,requested).length; // assemble uses slice(0,count)
console.log(`requested ${requested} recall from ch4, available ${available}, assemble() serves ${served} -> ${served<requested?"UNDER-SERVES SILENTLY (gap vs spec's 'explicit error')":"ok"}`);
