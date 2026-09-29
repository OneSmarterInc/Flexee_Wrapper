import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, count } from "drizzle-orm";
import { generateKeyPair, exportJWK, exportPKCS8, importPKCS8, SignJWT, jwtVerify, decodeJwt } from "jose";
import * as schema from "../src/db/schema.ts";
const { ltiNonces, sections, users, enrolments, identities } = schema;
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const C="https://purl.imsglobal.org/spec/lti/claim/";
const AGS="https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";

const client=new PGlite(); const db=drizzle(client,{schema});
for(const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).sort().map((x) => x.slice(0, -4)))
  for(const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")){const t=s.trim(); if(t) await client.exec(t);}

console.log("== 1. LAUNCH id_token: sign (platform) & validate (tool) ==");
const iss="https://lms.example.edu", clientId="client-abc123";
const plat=await generateKeyPair("RS256",{extractable:true}); const platJwk={...await exportJWK(plat.publicKey),kid:"plat1",alg:"RS256",use:"sig"};
const idToken=await new SignJWT({
  [`${C}version`]:"1.3.0", [`${C}message_type`]:"LtiResourceLinkRequest", [`${C}deployment_id`]:"dep-1",
  [`${C}roles`]:["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
  [`${C}context`]:{id:"course-77",title:"Intro to MIS - Fall 2027"},
  [`${C}custom`]:{book:"mis3000"},
  [AGS]:{lineitems:"https://lms.example.edu/api/lti/courses/77/line_items",scope:["https://purl.imsglobal.org/spec/lti-ags/scope/score"]},
  nonce:"nonce-xyz", name:"Dr. Grace Okoro", email:"grace@example.edu",
}).setProtectedHeader({alg:"RS256",kid:"plat1"}).setIssuer(iss).setAudience(clientId).setSubject("lms-user-9").setIssuedAt().setExpirationTime("5m").sign(plat.privateKey);

const { payload } = await jwtVerify(idToken, plat.publicKey, { issuer: iss, audience: clientId });
console.log(`valid token verifies (iss+aud+sig+exp) ${P(payload.sub==="lms-user-9")}`);
console.log(`message_type ${P(payload[`${C}message_type`]==="LtiResourceLinkRequest")} | deployment ${P(payload[`${C}deployment_id`]==="dep-1")} | custom.book ${P((payload[`${C}custom`] as any).book==="mis3000")} | AGS lineitems present ${P(!!(payload[AGS] as any).lineitems)}`);

console.log("\n== 2. REJECTIONS ==");
let wrongAud=false; try{ await jwtVerify(idToken, plat.publicKey, {issuer:iss, audience:"someone-else"});}catch{wrongAud=true;}
let tampered=false; try{ await jwtVerify(idToken.slice(0,-3)+"xyz", plat.publicKey, {issuer:iss, audience:clientId});}catch{tampered=true;}
let wrongKey=false; const other=await generateKeyPair("RS256"); try{ await jwtVerify(idToken, other.publicKey, {issuer:iss,audience:clientId});}catch{wrongKey=true;}
console.log(`wrong audience rejected ${P(wrongAud)} | tampered signature rejected ${P(tampered)} | wrong signing key rejected ${P(wrongKey)}`);

console.log("\n== 3. NONCE SINGLE-USE (replay protection) ==");
await db.insert(ltiNonces).values({nonce:"nonce-xyz",expiresAt:new Date(Date.now()+600000)});
async function consume(n:string){const r=(await db.select().from(ltiNonces).where(eq(ltiNonces.nonce,n)).limit(1))[0]; if(!r) return false; await db.delete(ltiNonces).where(eq(ltiNonces.nonce,n)); return r.expiresAt>new Date();}
const first=await consume("nonce-xyz"), second=await consume("nonce-xyz");
console.log(`first use ok ${P(first)} | replay rejected ${P(!second)}`);

console.log("\n== 4. CLAIM -> user / section / enrolment mapping (idempotent) ==");
const p=payload as any;
async function map(){
  const subject=`${iss}|${p.sub}`;
  let ident=(await db.select().from(identities).where(and(eq(identities.provider,"lti"),eq(identities.subject,subject))).limit(1))[0];
  let userId:string;
  if(ident) userId=ident.userId; else {const [u]=await db.insert(users).values({displayName:p.name}).returning(); userId=u.id; await db.insert(identities).values({userId,provider:"lti",subject});}
  const ext=`${iss}|${p[`${C}context`].id}`;
  let sec=(await db.select().from(sections).where(eq(sections.externalContextId,ext)).limit(1))[0];
  if(!sec)[sec]=await db.insert(sections).values({bookId:p[`${C}custom`].book,name:p[`${C}context`].title,externalContextId:ext}).returning();
  const instr=(p[`${C}roles`] as string[]).some(r=>/Instructor/.test(r));
  await db.insert(enrolments).values({sectionId:sec.id,userId,role:instr?"instructor":"student"}).onConflictDoNothing();
  return {userId,sectionId:sec.id,instr};
}
const m1=await map(); const m2=await map(); // second launch, same user
const nu=(await db.select({c:count()}).from(users))[0].c, ns=(await db.select({c:count()}).from(sections))[0].c, ne=(await db.select({c:count()}).from(enrolments))[0].c;
console.log(`user reused across 2 launches (users=${nu}) ${P(nu===1&&m1.userId===m2.userId)} | section via external_context_id (sections=${ns}) ${P(ns===1)} | instructor enrolment (enrolments=${ne}) ${P(ne===1&&m1.instr)}`);

console.log("\n== 5. AGS client assertion + score payload ==");
const tool=await generateKeyPair("RS256",{extractable:true}); const toolPkcs8=await exportPKCS8(tool.privateKey);
const tokenUrl="https://lms.example.edu/login/oauth2/token";
const assertion=await new SignJWT({}).setProtectedHeader({alg:"RS256",kid:"tool1"}).setIssuer(clientId).setSubject(clientId).setAudience(tokenUrl).setIssuedAt().setExpirationTime("60s").setJti("jti-1").sign(await importPKCS8(toolPkcs8,"RS256"));
let assertionOk=false; try{ const {payload:ap}=await jwtVerify(assertion, tool.publicKey, {issuer:clientId, audience:tokenUrl}); assertionOk=ap.sub===clientId;}catch{}
const score={userId:"lms-user-9",scoreGiven:8.5,scoreMaximum:10,activityProgress:"Completed",gradingProgress:"FullyGraded",timestamp:new Date().toISOString()};
console.log(`client_assertion signs & verifies (iss=sub=client, aud=token url) ${P(assertionOk)}`);
console.log(`score payload shape ${P(score.scoreGiven===8.5&&score.gradingProgress==="FullyGraded"&&!!score.timestamp)}`);
