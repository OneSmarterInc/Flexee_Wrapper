import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, count } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { users, identities, enrolments, sections, ltiPlatforms, ltiLinks } = schema;
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const client=new PGlite(); const db=drizzle(client,{schema});
for(const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).sort().map((x) => x.slice(0, -4)))
  for(const s of readFileSync(`drizzle/${f}.sql`,"utf8").split("--> statement-breakpoint")){const t=s.trim(); if(t) await client.exec(t);}

// mock LMS with paginated NRPS + token
let PORT=0;
const server=http.createServer((req,res)=>{
  const chunks:Buffer[]=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>{
    const url=new URL(req.url!,`http://${req.headers.host}`);
    if(url.pathname==="/token"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({access_token:"tok"}));}
    if(url.pathname==="/memberships"){
      const page=url.searchParams.get("page")||"1";
      if(page==="1"){
        res.writeHead(200,{"content-type":"application/vnd.ims.lti-nrps.v2.membershipcontainer+json","link":`<http://127.0.0.1:${PORT}/memberships?page=2>; rel="next"`});
        return res.end(JSON.stringify({members:[
          {user_id:"u1",name:"Prof X",email:"prof@x.edu",roles:["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],status:"Active"},
          {user_id:"u2",name:"Alice",email:"alice@x.edu",roles:["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],status:"Active"},
          {user_id:"u3",name:"Bob",roles:["...#Learner"],status:"Active"},
          {user_id:"u4",name:"Carol",roles:["...#Learner"],status:"Inactive"},
        ]}));
      }
      res.writeHead(200,{"content-type":"application/vnd.ims.lti-nrps.v2.membershipcontainer+json"});
      return res.end(JSON.stringify({members:[{user_id:"u5",name:"Dave",roles:["...#Learner"],status:"Active"}]}));
    }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r())); PORT=(server.address() as any).port;

const [plat]=await db.insert(ltiPlatforms).values({issuer:"https://lms.example.edu",clientId:"c1",authLoginUrl:"x",tokenUrl:`http://127.0.0.1:${PORT}/token`,jwksUrl:"x"}).returning();
const [sec]=await db.insert(sections).values({bookId:"mis3000",name:"S",joinCode:"N1",externalContextId:"https://lms.example.edu|course-1"}).returning();
await db.insert(ltiLinks).values({sectionId:sec.id,platformId:plat.id,contextId:"course-1",nrpsUrl:`http://127.0.0.1:${PORT}/memberships`});

// mirror syncRoster
function nextLink(h:Headers){const l=h.get("link");if(!l)return null;const m=l.match(/<([^>]+)>\s*;\s*rel="?next"?/);return m?m[1]:null;}
async function syncRoster(){
  const link=(await db.select().from(ltiLinks).where(eq(ltiLinks.sectionId,sec.id)).limit(1))[0];
  let url:string|null=link.nrpsUrl!; let added=0,seen=0;
  while(url){
    const res:Response=await fetch(url,{headers:{authorization:"Bearer tok",accept:"application/vnd.ims.lti-nrps.v2.membershipcontainer+json"}});
    const data=await res.json();
    for(const m of (data.members||[])){
      if(m.status&&m.status!=="Active")continue; seen++;
      const subject=`https://lms.example.edu|${m.user_id}`;
      let ident=(await db.select().from(identities).where(and(eq(identities.provider,"lti"),eq(identities.subject,subject))).limit(1))[0];
      let userId:string;
      if(ident)userId=ident.userId; else {const [u]=await db.insert(users).values({displayName:m.name}).returning(); userId=u.id; await db.insert(identities).values({userId,provider:"lti",subject});}
      const isInstr=(m.roles||[]).some((r:string)=>/Instructor/.test(r));
      const ins=await db.insert(enrolments).values({sectionId:sec.id,userId,role:isInstr?"instructor":"student"}).onConflictDoNothing().returning();
      if(ins.length)added++;
    }
    url=nextLink(res.headers);
  }
  return {added,seen};
}
const r1=await syncRoster();
console.log(`added ${r1.added} seen ${r1.seen} (expect 4/4: u1,u2,u3,u5; Carol inactive skipped) ${P(r1.added===4&&r1.seen===4)}`);
const nUsers=(await db.select({c:count()}).from(users))[0].c;
const roles=await db.select({role:enrolments.role}).from(enrolments).where(eq(enrolments.sectionId,sec.id));
const instr=roles.filter(x=>x.role==="instructor").length, stud=roles.filter(x=>x.role==="student").length;
console.log(`users created ${nUsers} (expect 4) ${P(nUsers===4)} | instructors ${instr} students ${stud} (expect 1/3) ${P(instr===1&&stud===3)}`);
console.log(`pagination followed (u5 from page 2 present) ${P(!!(await db.select().from(identities).where(eq(identities.subject,"https://lms.example.edu|u5")).limit(1))[0])}`);
const r2=await syncRoster();
console.log(`re-sync idempotent: added ${r2.added} (expect 0) ${P(r2.added===0)} | users still ${(await db.select({c:count()}).from(users))[0].c} ${P((await db.select({c:count()}).from(users))[0].c===4)}`);
server.close();
