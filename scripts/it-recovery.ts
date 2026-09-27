import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, gt, isNull, count } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { users, identities, sessions, authTokens, rateCounters, sections, enrolments, bookmarks } = schema;
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const client=new PGlite(); const db=drizzle(client,{schema});
for(const f of readdirSync("drizzle").filter((x)=>x.endsWith(".sql")).map((x)=>x.slice(0,-4)).sort()) // every migration
  for(const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")){const t=s.trim(); if(t) await client.exec(t);}

const mkUser=async(name:string,email:string)=>{const [u]=await db.insert(users).values({displayName:name}).returning();await db.insert(identities).values({userId:u.id,provider:"password",subject:email,passwordHash:await bcrypt.hash("original1",10)});return u;};
const issue=async(userId:string,kind:string,email:string|null,ttl:number)=>{const token=randomBytes(16).toString("hex");await db.insert(authTokens).values({token,userId,kind,email,expiresAt:new Date(Date.now()+ttl*1000)});return token;};
const consume=async(token:string,kind:string)=>{const r=(await db.select().from(authTokens).where(and(eq(authTokens.token,token),eq(authTokens.kind,kind),isNull(authTokens.usedAt),gt(authTokens.expiresAt,new Date()))).limit(1))[0];if(!r)return null;await db.update(authTokens).set({usedAt:new Date()}).where(eq(authTokens.token,token));return r;};

console.log("== PASSWORD RESET ==");
const alice=await mkUser("Alice","alice@x.edu");
await db.insert(sessions).values({id:"sess-a",userId:alice.id,expiresAt:new Date(Date.now()+9e8)});
const rt=await issue(alice.id,"password_reset","alice@x.edu",3600);
const before=(await db.select().from(identities).where(eq(identities.userId,alice.id)))[0].passwordHash!;
const row=await consume(rt,"password_reset");
await db.update(identities).set({passwordHash:await bcrypt.hash("brandnew1",10)}).where(and(eq(identities.userId,alice.id),eq(identities.provider,"password")));
await db.delete(sessions).where(eq(sessions.userId,alice.id));
const after=(await db.select().from(identities).where(eq(identities.userId,alice.id)))[0].passwordHash!;
console.log(`token valid ${P(!!row)} | password changed ${P(await bcrypt.compare("brandnew1",after)&&!(await bcrypt.compare("brandnew1",before)))} | sessions cleared ${P((await db.select({c:count()}).from(sessions).where(eq(sessions.userId,alice.id)))[0].c===0)}`);
console.log(`reused token rejected ${P((await consume(rt,"password_reset"))===null)}`);
const expired=await issue(alice.id,"password_reset","alice@x.edu",-1);
console.log(`expired token rejected ${P((await consume(expired,"password_reset"))===null)}`);

console.log("\n== EMAIL VERIFICATION ==");
const vt=await issue(alice.id,"email_verify","alice@x.edu",86400);
const vr=await consume(vt,"email_verify");
if(vr) await db.update(identities).set({emailVerifiedAt:new Date()}).where(and(eq(identities.userId,alice.id),eq(identities.provider,"password"),eq(identities.subject,vr.email!)));
const verified=(await db.select().from(identities).where(eq(identities.userId,alice.id)))[0].emailVerifiedAt!=null;
console.log(`email verified ${P(verified)} | reused verify token rejected ${P((await consume(vt,"email_verify"))===null)}`);

console.log("\n== RATE LIMIT (max 3 / window) ==");
async function rl(key:string,max:number,windowSec:number){const now=new Date();const r=(await db.select().from(rateCounters).where(eq(rateCounters.key,key)).limit(1))[0];if(!r||now.getTime()-r.windowStart.getTime()>windowSec*1000){await db.insert(rateCounters).values({key,windowStart:now,count:1}).onConflictDoUpdate({target:rateCounters.key,set:{windowStart:now,count:1}});return true;}if(r.count>=max)return false;await db.update(rateCounters).set({count:r.count+1}).where(eq(rateCounters.key,key));return true;}
const results=[]; for(let i=0;i<5;i++) results.push(await rl("login:bob",3,900));
console.log(`attempts allowed: ${JSON.stringify(results)} (expect [t,t,t,f,f]) ${P(JSON.stringify(results)===JSON.stringify([true,true,true,false,false]))}`);

console.log("\n== ACCOUNT MERGE (mistyped-email duplicate) ==");
const real=await mkUser("Bob Real","bob@x.edu");
const dup=await mkUser("Bob Typo","bob@x.ed/");  // signed up with a typo'd email
const [secA]=await db.insert(sections).values({bookId:"mis3000",name:"A",joinCode:"RA"}).returning();
const [secB]=await db.insert(sections).values({bookId:"mis3000",name:"B",joinCode:"RB"}).returning();
await db.insert(enrolments).values({sectionId:secA.id,userId:real.id}); // real already in A
const [dupEnrA]=await db.insert(enrolments).values({sectionId:secA.id,userId:dup.id}).returning(); // dup also in A (will dedup)
const [dupEnrB]=await db.insert(enrolments).values({sectionId:secB.id,userId:dup.id}).returning(); // dup in B (will move)
await db.insert(bookmarks).values({enrolmentId:dupEnrB.id,bookId:"mis3000",entryId:"ch01",chapterVersion:1,scroll:0.4,updatedAt:new Date()});
// merge dup -> real
const intoSecs=new Set((await db.select({s:enrolments.sectionId}).from(enrolments).where(eq(enrolments.userId,real.id))).map(r=>r.s));
for(const e of await db.select().from(enrolments).where(eq(enrolments.userId,dup.id))) intoSecs.has(e.sectionId)?await db.delete(enrolments).where(eq(enrolments.id,e.id)):await db.update(enrolments).set({userId:real.id}).where(eq(enrolments.id,e.id));
const intoIds=new Set((await db.select().from(identities).where(eq(identities.userId,real.id))).map(i=>`${i.provider}|${i.subject}`));
for(const i of await db.select().from(identities).where(eq(identities.userId,dup.id))) intoIds.has(`${i.provider}|${i.subject}`)?await db.delete(identities).where(eq(identities.id,i.id)):await db.update(identities).set({userId:real.id}).where(eq(identities.id,i.id));
await db.delete(users).where(eq(users.id,dup.id));
const realEnr=(await db.select().from(enrolments).where(eq(enrolments.userId,real.id)));
const dupGone=(await db.select({c:count()}).from(users).where(eq(users.id,dup.id)))[0].c===0;
const bm=(await db.select().from(bookmarks).where(eq(bookmarks.enrolmentId,dupEnrB.id)))[0];
console.log(`real now enrolled in ${realEnr.length} sections (expect 2: A + moved B) ${P(realEnr.length===2)}`);
console.log(`duplicate account deleted ${P(dupGone)} | moved enrolment keeps its bookmark ${P(!!bm&&bm.scroll===0.4)}`);
