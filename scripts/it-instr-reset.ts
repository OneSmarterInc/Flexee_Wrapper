import { readFileSync, readdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, count } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { users, identities, sessions, sections, enrolments } = schema;
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const client=new PGlite(); const db=drizzle(client,{schema});
for(const f of readdirSync("drizzle").filter((x)=>x.endsWith(".sql")).map((x)=>x.slice(0,-4)).sort()) // every migration
  for(const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")){const t=s.trim(); if(t) await client.exec(t);}

const [sec]=await db.insert(sections).values({bookId:"mis3000",name:"S",joinCode:"P1"}).returning();
const [u]=await db.insert(users).values({displayName:"Sam Student"}).returning();
await db.insert(identities).values({userId:u.id,provider:"password",subject:"sam@x.edu",passwordHash:await bcrypt.hash("oldpass12",10)});
const [enr]=await db.insert(enrolments).values({sectionId:sec.id,userId:u.id,role:"student"}).returning();
await db.insert(sessions).values({id:"s1",userId:u.id,expiresAt:new Date(Date.now()+9e8)});

// mirror setStudentPassword
async function setStudentPassword(sectionId:string,enrolmentId:string,newPassword:string){
  const e=(await db.select().from(enrolments).where(and(eq(enrolments.id,enrolmentId),eq(enrolments.sectionId,sectionId))).limit(1))[0];
  if(!e)throw new Error("not in section");
  const id=(await db.select().from(identities).where(and(eq(identities.userId,e.userId),eq(identities.provider,"password"))).limit(1))[0];
  if(!id)throw new Error("no password identity");
  await db.update(identities).set({passwordHash:await bcrypt.hash(newPassword,10)}).where(eq(identities.id,id.id));
  await db.delete(sessions).where(eq(sessions.userId,e.userId));
}
const before=(await db.select().from(identities).where(eq(identities.userId,u.id)))[0].passwordHash!;
await setStudentPassword(sec.id,enr.id,"TempPass99");
const after=(await db.select().from(identities).where(eq(identities.userId,u.id)))[0].passwordHash!;
console.log(`temp password set ${P(await bcrypt.compare("TempPass99",after) && !(await bcrypt.compare("TempPass99",before)))} | old no longer works ${P(!(await bcrypt.compare("oldpass12",after)))}`);
console.log(`student sessions cleared (forced re-login) ${P((await db.select({c:count()}).from(sessions).where(eq(sessions.userId,u.id)))[0].c===0)}`);
// LTI-only student (no password identity) -> clear error
const [u2]=await db.insert(users).values({displayName:"LTI Only"}).returning();
await db.insert(identities).values({userId:u2.id,provider:"lti",subject:"iss|x"});
const [enr2]=await db.insert(enrolments).values({sectionId:sec.id,userId:u2.id,role:"student"}).returning();
let err=""; try{ await setStudentPassword(sec.id,enr2.id,"whatever12"); }catch(e:any){ err=e.message; }
console.log(`LTI/no-password student -> clear error ${P(err.includes("no password identity"))}`);
