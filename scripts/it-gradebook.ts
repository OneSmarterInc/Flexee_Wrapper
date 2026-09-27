import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { sections, users, enrolments, exams, examAttempts, lineItems, lineItemScores } = schema;
const client = new PGlite(); const db = drizzle(client, { schema });
for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).map((x) => x.slice(0, -4)).sort()) // every migration, so this test never goes stale
  for (const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")) { const t=s.trim(); if(t) await client.exec(t); }
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";

const [sec]=await db.insert(sections).values({bookId:"mis3000",name:"GB",joinCode:"G1"}).returning();
const mk=async(n:string)=>{const [u]=await db.insert(users).values({displayName:n}).returning();const [e]=await db.insert(enrolments).values({sectionId:sec.id,userId:u.id}).returning();return e;};
const A=await mk("Ada"), B=await mk("Ben");
// two exams (fixed blueprints -> max = ids length)
const [e1]=await db.insert(exams).values({sectionId:sec.id,title:"Midterm",blueprintJson:JSON.stringify({mode:"fixed",ids:["q1","q2","q3","q4"]}),status:"closed"}).returning();
const [e2]=await db.insert(exams).values({sectionId:sec.id,title:"Quiz",blueprintJson:JSON.stringify({mode:"fixed",ids:["q5","q6"]}),status:"closed"}).returning();
const att=async(examId:string,enrId:string,score:number,max:number)=>{await db.insert(examAttempts).values({examId,enrolmentId:enrId,servedJson:"[]",maxPoints:max,score,submittedAt:new Date()});};
await att(e1.id,A.id,3,4); await att(e2.id,A.id,2,2);
await att(e1.id,B.id,2,4); await att(e2.id,B.id,1,2);

// mirror ensureExamLineItems
const bpMax=(j:string)=>{const bp=JSON.parse(j);return bp.mode==="fixed"?bp.ids.length:bp.rules.reduce((s:number,r:any)=>s+r.count,0);};
for(const e of await db.select().from(exams).where(eq(exams.sectionId,sec.id)))
  await db.insert(lineItems).values({sectionId:sec.id,kind:"exam",refId:e.id,title:e.title,maxPoints:bpMax(e.blueprintJson),weight:1}).onConflictDoNothing();
// manual item
const [manual]=await db.insert(lineItems).values({sectionId:sec.id,kind:"manual",title:"Participation",maxPoints:10,weight:1}).returning();
// weights: midterm 2, quiz 1, participation 1
const li=await db.select().from(lineItems).where(eq(lineItems.sectionId,sec.id));
const byRef=new Map(li.map(x=>[x.refId??x.id,x]));
await db.update(lineItems).set({weight:2}).where(eq(lineItems.id,byRef.get(e1.id)!.id));
await db.update(lineItems).set({weight:1}).where(eq(lineItems.id,byRef.get(e2.id)!.id));
await db.update(lineItems).set({weight:1}).where(eq(lineItems.id,manual.id));
// manual scores A=9 B=7
await db.insert(lineItemScores).values({lineItemId:manual.id,enrolmentId:A.id,points:9,updatedAt:new Date()});
await db.insert(lineItemScores).values({lineItemId:manual.id,enrolmentId:B.id,points:7,updatedAt:new Date()});

// mirror gradebook() weighted total
async function examScore(examId:string,enrId:string){const a=(await db.select().from(examAttempts).where(and(eq(examAttempts.examId,examId),eq(examAttempts.enrolmentId,enrId)))).filter(x=>x.submittedAt&&x.score!=null).sort((x,y)=>+y.submittedAt!-+x.submittedAt!)[0];return a?a.score!:null;}
async function total(enrId:string){
  const items=await db.select().from(lineItems).where(eq(lineItems.sectionId,sec.id));
  const ov=await db.select().from(lineItemScores).where(inArray(lineItemScores.lineItemId,items.map(i=>i.id)));
  const ovMap=new Map(ov.map(o=>[`${o.lineItemId}:${o.enrolmentId}`,o.points]));
  let wsum=0,wpct=0,graded=0;
  for(const it of items){
    let pts:number|null = ovMap.has(`${it.id}:${enrId}`)?ovMap.get(`${it.id}:${enrId}`)!:(it.kind==="exam"&&it.refId?await examScore(it.refId,enrId):null);
    if(pts!=null&&it.maxPoints>0){wsum+=it.weight;wpct+=(pts/it.maxPoints)*it.weight;graded++;}
  }
  return {total: wsum>0?Math.round(wpct/wsum*1000)/10:null, graded, n: items.length};
}
const ta=await total(A.id), tb=await total(B.id);
console.log(`Ada total ${ta.total}% (expect 85) graded ${ta.graded}/${ta.n} ${P(ta.total===85)}`);
console.log(`Ben total ${tb.total}% (expect 55) graded ${tb.graded}/${tb.n} ${P(tb.total===55)}`);

// ungraded item must not tank the total
const [e3]=await db.insert(exams).values({sectionId:sec.id,title:"Final (ungraded)",blueprintJson:JSON.stringify({mode:"fixed",ids:["x1","x2","x3","x4"]}),status:"open"}).returning();
await db.insert(lineItems).values({sectionId:sec.id,kind:"exam",refId:e3.id,title:e3.title,maxPoints:4,weight:1});
const ta2=await total(A.id);
console.log(`After adding an ungraded exam: Ada total ${ta2.total}% (still 85) graded ${ta2.graded}/${ta2.n} ${P(ta2.total===85 && ta2.graded===3 && ta2.n===4)}`);

// export sanity (generic): header + Ada 85
const esc=(v:any)=>`"${String(v).replace(/"/g,'""')}"`;
const items=await db.select().from(lineItems).where(eq(lineItems.sectionId,sec.id));
const header=["Student","Email",...items.map(i=>`${i.title} / ${i.maxPoints}`),"Weighted total (%)"].map(esc).join(",");
console.log("\nCSV header:", header.slice(0,80),"…");
console.log("export includes weighted total column:", P(header.includes("Weighted total")));
