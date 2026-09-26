import http from "node:http";
import { generateKeyPair, exportPKCS8, exportJWK, importPKCS8, importJWK, SignJWT, jwtVerify } from "jose";
const P=(b:boolean)=>b?"PASS":"*** FAIL ***";
const C="https://purl.imsglobal.org/spec/lti/claim/";
const DL_CONTENT="https://purl.imsglobal.org/spec/lti-dl/claim/content_items";
const DL_DATA="https://purl.imsglobal.org/spec/lti-dl/claim/data";

// tool signing key (as the app's ensureKey would provide)
const tool=await generateKeyPair("RS256",{extractable:true});
const toolPkcs8=await exportPKCS8(tool.privateKey);
const toolJwk={...await exportJWK(tool.publicKey),kid:"tool1",alg:"RS256",use:"sig"};

// ---- mock LMS platform (AGS endpoints) ----
const seen:any={token:0,find:0,create:0,scores:[],createBody:null as any,assertion:null as any};
let lineitemExists=false;
const server=http.createServer((req,res)=>{
  const chunks:Buffer[]=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>{
    const body=Buffer.concat(chunks).toString(); const url=new URL(req.url!,`http://${req.headers.host}`);
    if(url.pathname==="/token"){seen.token++; const p=new URLSearchParams(body); seen.assertion=p.get("client_assertion"); res.writeHead(200,{"content-type":"application/json"}); return res.end(JSON.stringify({access_token:"mock-token",token_type:"Bearer",expires_in:3600}));}
    if(url.pathname==="/lineitems"&&req.method==="GET"){seen.find++; res.writeHead(200,{"content-type":"application/vnd.ims.lis.v2.lineitemcontainer+json"}); return res.end(JSON.stringify(lineitemExists?[{id:`http://127.0.0.1:${PORT}/lineitems/li-1`,resourceId:url.searchParams.get("resource_id")}]:[]));}
    if(url.pathname==="/lineitems"&&req.method==="POST"){seen.create++; seen.createBody=JSON.parse(body); lineitemExists=true; res.writeHead(201,{"content-type":"application/vnd.ims.lis.v2.lineitem+json"}); return res.end(JSON.stringify({id:`http://127.0.0.1:${PORT}/lineitems/li-1`,...JSON.parse(body)}));}
    if(url.pathname==="/lineitems/li-1/scores"&&req.method==="POST"){seen.scores.push({ctype:req.headers["content-type"],body:JSON.parse(body)}); res.writeHead(200); return res.end("{}");}
    res.writeHead(404); res.end();
  });
});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
const PORT=(server.address() as any).port;
const platform={clientId:"client-abc",tokenUrl:`http://127.0.0.1:${PORT}/token`,issuer:"https://lms.example.edu"} as any;
const lineitemsUrl=`http://127.0.0.1:${PORT}/lineitems`;

// ---- mirror the app's AGS client ----
async function platformToken(scopes:string[]){const pk=await importPKCS8(toolPkcs8,"RS256");const a=await new SignJWT({}).setProtectedHeader({alg:"RS256",kid:"tool1"}).setIssuer(platform.clientId).setSubject(platform.clientId).setAudience(platform.tokenUrl).setIssuedAt().setExpirationTime("60s").setJti("j1").sign(pk);const b=new URLSearchParams({grant_type:"client_credentials",client_assertion_type:"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",client_assertion:a,scope:scopes.join(" ")});const r=await fetch(platform.tokenUrl,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:b});return (await r.json()).access_token;}
function scoresUrl(u:string){const x=new URL(u);x.pathname=x.pathname.replace(/\/$/,"")+"/scores";return x.toString();}
async function ensureLineItem(resourceId:string,label:string,scoreMaximum:number){const t=await platformToken(["...lineitem"]);const find=new URL(lineitemsUrl);find.searchParams.set("resource_id",resourceId);const r=await fetch(find.toString(),{headers:{authorization:`Bearer ${t}`,accept:"application/vnd.ims.lis.v2.lineitemcontainer+json"}});if(r.ok){const items=await r.json();const f=Array.isArray(items)?items.find((i:any)=>i.resourceId===resourceId):null;if(f?.id)return f.id;}const c=await fetch(lineitemsUrl,{method:"POST",headers:{authorization:`Bearer ${t}`,"content-type":"application/vnd.ims.lis.v2.lineitem+json"},body:JSON.stringify({scoreMaximum,label,resourceId})});return (await c.json()).id;}
async function postScore(lineitemUrl:string,sub:string,scoreGiven:number,scoreMaximum:number){const t=await platformToken(["...score"]);await fetch(scoresUrl(lineitemUrl),{method:"POST",headers:{authorization:`Bearer ${t}`,"content-type":"application/vnd.ims.lis.v1.score+json"},body:JSON.stringify({userId:sub,scoreGiven,scoreMaximum,activityProgress:"Completed",gradingProgress:"FullyGraded",timestamp:new Date().toISOString()})});}

console.log("== AGS: create line item + post scores (first push) ==");
let li=await ensureLineItem("flexee-col-1","Midterm",4);
await postScore(li,"lms-user-9",3,4); await postScore(li,"lms-user-10",2,4);
console.log(`token obtained ${P(seen.token>0)} | line item created once ${P(seen.create===1)} | create body ${JSON.stringify(seen.createBody)} ${P(seen.createBody.resourceId==="flexee-col-1"&&seen.createBody.scoreMaximum===4)}`);
console.log(`scores posted ${seen.scores.length} ${P(seen.scores.length===2)} | score body ${JSON.stringify(seen.scores[0].body)} ${P(seen.scores[0].body.scoreGiven===3&&seen.scores[0].body.gradingProgress==="FullyGraded")}`);
console.log(`scores content-type ${P(seen.scores[0].ctype==="application/vnd.ims.lis.v1.score+json")}`);
const asrt=await jwtVerify(seen.assertion,tool.publicKey,{issuer:platform.clientId,audience:platform.tokenUrl}); console.log(`client_assertion verifies ${P((asrt.payload as any).sub===platform.clientId)}`);

console.log("\n== AGS: second push finds the existing line item (no duplicate) ==");
const createsBefore=seen.create; li=await ensureLineItem("flexee-col-1","Midterm",4); await postScore(li,"lms-user-9",4,4);
console.log(`no new line item created ${P(seen.create===createsBefore)} | reused existing ${P(seen.find>=2)}`);
server.close();

console.log("\n== DEEP LINKING: response JWT ==");
const ctx={returnUrl:"https://lms.example.edu/deep_link_return",data:"opaque-data-123",iss:"https://lms.example.edu",clientId:"client-abc",deploymentId:"dep-1"};
const pk=await importPKCS8(toolPkcs8,"RS256");
const resp=await new SignJWT({[`${C}message_type`]:"LtiDeepLinkingResponse",[`${C}version`]:"1.3.0",[`${C}deployment_id`]:ctx.deploymentId,[DL_CONTENT]:[{type:"ltiResourceLink",title:"Flexee — Introduction to MIS",url:"https://tool/api/lti/launch",custom:{book:"mis3000"}}],[DL_DATA]:ctx.data}).setProtectedHeader({alg:"RS256",kid:"tool1"}).setIssuer(ctx.clientId).setAudience(ctx.iss).setIssuedAt().setExpirationTime("5m").setJti("dl1").sign(pk);
const dv=await jwtVerify(resp,tool.publicKey,{issuer:ctx.clientId,audience:ctx.iss});
const ci=(dv.payload as any)[DL_CONTENT][0];
console.log(`response verifies (iss=client, aud=platform) ${P(true)} | message_type ${P((dv.payload as any)[`${C}message_type`]==="LtiDeepLinkingResponse")}`);
console.log(`content item ltiResourceLink w/ custom.book ${P(ci.type==="ltiResourceLink"&&ci.custom.book==="mis3000")} | data echoed ${P((dv.payload as any)[DL_DATA]==="opaque-data-123")} | deployment ${P((dv.payload as any)[`${C}deployment_id`]==="dep-1")}`);
