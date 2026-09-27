import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { sections, users, enrolments, announcements, sectionSyllabus, scheduleItems } = schema;
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const client=new PGlite(); const db=drizzle(client,{schema});
for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).map((x) => x.slice(0, -4)).sort()) // every migration, so this test never goes stale
  for (const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")) { const t=s.trim(); if(t) await client.exec(t); }

const [u]=await db.insert(users).values({displayName:"Prof"}).returning();
const [a]=await db.insert(sections).values({bookId:"mis3000",name:"A",joinCode:"S1",term:"2027 Spring",createdBy:u.id}).returning();
const [b]=await db.insert(sections).values({bookId:"sad",name:"B",joinCode:"S2",term:"2026 Fall",createdBy:u.id}).returning();
const [c]=await db.insert(sections).values({bookId:"mis3000",name:"C",joinCode:"S3",createdBy:u.id}).returning(); // no term
for (const s of [a,b,c]) await db.insert(enrolments).values({sectionId:s.id,userId:u.id,role:"instructor"});

console.log("== ANNOUNCEMENTS ==");
await db.insert(announcements).values({sectionId:a.id,title:"Welcome",body:"First"});
await new Promise(r=>setTimeout(r,5));
await db.insert(announcements).values({sectionId:a.id,title:"Exam Friday",body:"Second"});
const ann=await db.select().from(announcements).where(eq(announcements.sectionId,a.id)).orderBy(desc(announcements.createdAt));
console.log(`listed ${ann.length}, newest first ${P(ann.length===2 && ann[0].title==="Exam Friday")}`);
await db.delete(announcements).where(and(eq(announcements.id,ann[0].id),eq(announcements.sectionId,a.id)));
console.log(`delete ${P((await db.select().from(announcements).where(eq(announcements.sectionId,a.id))).length===1)}`);

console.log("\n== SYLLABUS (upsert) ==");
async function setSyl(id:string,content:string){await db.insert(sectionSyllabus).values({sectionId:id,content,updatedAt:new Date()}).onConflictDoUpdate({target:sectionSyllabus.sectionId,set:{content,updatedAt:new Date()}});}
await setSyl(a.id,"v1"); await setSyl(a.id,"v2 revised");
const syl=await db.select().from(sectionSyllabus).where(eq(sectionSyllabus.sectionId,a.id));
console.log(`one row, updated content ${P(syl.length===1 && syl[0].content==="v2 revised")}`);

console.log("\n== SCHEDULE (order + upcoming) ==");
const past=new Date(Date.now()-864e5), soon=new Date(Date.now()+864e5), later=new Date(Date.now()+3*864e5);
await db.insert(scheduleItems).values({sectionId:a.id,title:"Read ch1 (past)",dueAt:past,kind:"reading"});
await db.insert(scheduleItems).values({sectionId:a.id,title:"Quiz 1",dueAt:later,kind:"exam"});
await db.insert(scheduleItems).values({sectionId:a.id,title:"Read ch2",dueAt:soon,kind:"reading"});
const all=await db.select().from(scheduleItems).where(eq(scheduleItems.sectionId,a.id)).orderBy(asc(scheduleItems.dueAt));
console.log(`all ordered by due ${P(all[0].title.includes("past") && all[2].title==="Quiz 1")}`);
const up=await db.select().from(scheduleItems).where(and(eq(scheduleItems.sectionId,a.id),gte(scheduleItems.dueAt,new Date()))).orderBy(asc(scheduleItems.dueAt));
console.log(`upcoming excludes past, soonest first ${P(up.length===2 && up[0].title==="Read ch2")}`);

console.log("\n== DASHBOARD (group by term) ==");
const rows=await db.select({name:sections.name,term:sections.term}).from(enrolments).innerJoin(sections,eq(sections.id,enrolments.sectionId)).where(and(eq(enrolments.userId,u.id),eq(enrolments.role,"instructor")));
const groups=new Map<string,any[]>(); for(const r of rows){const k=r.term||"No term";(groups.get(k)??groups.set(k,[]).get(k)!).push(r);}
const ordered=[...groups.entries()].sort((x,y)=>(x[0]==="No term"?1:y[0]==="No term"?-1:y[0].localeCompare(x[0]))).map(e=>e[0]);
console.log(`terms ordered ${JSON.stringify(ordered)} ${P(JSON.stringify(ordered)===JSON.stringify(["2027 Spring","2026 Fall","No term"]))}`);
