import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { sections, lineItems } = schema;
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const client=new PGlite(); const db=drizzle(client,{schema});
for (const f of ["0000_init","0001_section_owner_and_invites","0002_content_versioning","0003_assessment","0004_learning_objectives","0005_gradebook","0006_lti","0007_account_recovery","0008_nrps","0009_course_scaffolding"])
  for (const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")) { const t=s.trim(); if(t) await client.exec(t); }

const STARTERS:Record<string,{title:string;weight:number}[]>={mis3000:[{title:"Excel worksheets",weight:1},{title:"Book & exams",weight:1}],sad:[{title:"Book",weight:1},{title:"MVCFN simulation",weight:1}]};
async function applyStarter(sectionId:string,bookId:string){const st=STARTERS[bookId];if(!st)return;const ex=await db.select().from(lineItems).where(and(eq(lineItems.sectionId,sectionId),eq(lineItems.kind,"manual")));if(ex.length)return;let p=0;for(const s of st)await db.insert(lineItems).values({sectionId,kind:"manual",title:s.title,maxPoints:100,weight:s.weight,position:p++});}

const [mis]=await db.insert(sections).values({bookId:"mis3000",name:"MIS",joinCode:"G1"}).returning();
const [sad]=await db.insert(sections).values({bookId:"sad",name:"SAD",joinCode:"G2"}).returning();
await applyStarter(mis.id,"mis3000"); await applyStarter(sad.id,"sad");

const misCols=await db.select().from(lineItems).where(eq(lineItems.sectionId,mis.id));
const sadCols=await db.select().from(lineItems).where(eq(lineItems.sectionId,sad.id));
console.log("MIS 3000 starter:", misCols.map(c=>`${c.title}@${c.weight}`).join(", "));
console.log(`  two 50/50 columns ${P(misCols.length===2 && misCols.every(c=>c.weight===1) && misCols.some(c=>c.title==="Excel worksheets") && misCols.some(c=>c.title==="Book & exams"))}`);
console.log("SAD starter:", sadCols.map(c=>`${c.title}@${c.weight}`).join(", "));
console.log(`  Book + MVCFN columns ${P(sadCols.length===2 && sadCols.some(c=>c.title==="MVCFN simulation"))}`);

// idempotent
await applyStarter(mis.id,"mis3000");
console.log(`re-apply is idempotent ${P((await db.select().from(lineItems).where(eq(lineItems.sectionId,mis.id))).length===2)}`);
// editable: re-weight Excel to 3 (75/25)
const excel=misCols.find(c=>c.title==="Excel worksheets")!;
await db.update(lineItems).set({weight:3}).where(eq(lineItems.id,excel.id));
const w=(await db.select().from(lineItems).where(eq(lineItems.id,excel.id)))[0].weight;
console.log(`faculty can re-weight (Excel -> 3) ${P(w===3)}`);
// unknown book gets no starter
const [x]=await db.insert(sections).values({bookId:"otherbook",name:"X",joinCode:"G3"}).returning();
await applyStarter(x.id,"otherbook");
console.log(`unknown book -> empty gradebook (faculty fills) ${P((await db.select().from(lineItems).where(eq(lineItems.sectionId,x.id))).length===0)}`);
