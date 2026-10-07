// Integration test: RapidSims behind the front door (contract C2). RapidSim 01's OWN code (from
// Disaster_New) announces itself, verifies the Wrapper's launch pass and reports its completion into the
// Wrapper's endpoints, exactly as it would in production with PLATFORM_URL pointed at the Wrapper.
// Set RAPIDSIMS_REPO to a checkout of OneSmarterInc/Disaster_New (default /tmp/rs).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { db, schema } from "@/db";
import { setAdminByEmail, parsePeople } from "@/lib/admin";
import { createSection, commitRoster, setAccessRelease } from "@/lib/roster";
import { registerSim, visibleSims, adminUpdateSim, grantPreview, addSimToClass, removeSimFromClass, simsForClass,
  prepareLaunch, recordCompletion, recordTranscript, classCompletions, transcriptsFor } from "@/lib/sims";
import { POST as registerPOST } from "@/app/api/register/route";
import { POST as completePOST } from "@/app/api/complete/route";
import { POST as transcriptPOST } from "@/app/api/transcript/route";

const REPO = process.env.RAPIDSIMS_REPO || "/tmp/rs";
process.env.LAUNCH_SECRET = "shared-launch-secret";
process.env.PLATFORM_URL = "https://learn.flexee.test";
const require = createRequire(import.meta.url);
const sim = require(`${REPO}/sim/lib/launch.js`);          // RapidSim 01: verifyLaunch, signBack, reportCompletion, announce
const META = require(`${REPO}/sim/lib/scenario.js`).META;   // what RapidSim 01 says about itself

// The sim's fetch calls to PLATFORM_URL land in the Wrapper's route handlers.
const routes: Record<string, (r: Request) => Promise<Response>> = { "/api/register": registerPOST, "/api/complete": completePOST, "/api/transcript": transcriptPOST };
const calls: { path: string; status: number }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = new URL(String(url));
  if (u.origin === process.env.PLATFORM_URL && routes[u.pathname]) {
    const res = await routes[u.pathname](new Request(u, init)); calls.push({ path: u.pathname, status: res.status }); return res;
  }
  return realFetch(url, init);
}) as any;

const { users, identities } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const other = await account("Other Prof", "other@flexee.org");
const ann = await account("Ann", "ann@wright.edu");
const bo = await account("Bo", "bo@wright.edu");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const otherCls = await createSection(other.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
await commitRoster(cls.id, parsePeople("ann@wright.edu"), "student");
await commitRoster(otherCls.id, parsePeople("bo@wright.edu"), "student");
// Spec 27 B1: a new enrolment is not released and cannot launch. Ann is released so the launch
// checks below are about the launch; the gate itself is pinned in test:access-release.
await setAccessRelease(prof.id, cls.id, { released: true, all: true });
await setAccessRelease(other.id, otherCls.id, { released: true, all: true });
const SIM = META.id as string;
const passIn = (url: string) => decodeURIComponent(new URL(url).hash.replace(/^#lt=/, ""));

console.log("A sim registers itself (RapidSim 01's own announce)");
await t("on start-up the sim announces itself; the Wrapper files it in the catalogue, unpublished", async () => {
  await sim.announce(META, "https://flexee-rapid-sim-01.example.app");
  assert.deepEqual(calls.at(-1), { path: "/api/register", status: 200 });
  const all = await visibleSims(admin.id); const s = all.find((x) => x.id === SIM)!;
  assert.equal(s.title, META.title); assert.equal(s.published, false); assert.equal(s.launchUrl, "https://flexee-rapid-sim-01.example.app");
  assert.ok(s.number && s.number >= 1); assert.equal(s.minutes, META.minutes);
});
await t("an unpublished sim is hidden from faculty until published, or until they are granted a preview", async () => {
  assert.ok(!(await visibleSims(prof.id)).some((s) => s.id === SIM));
  await grantPreview(admin.id, SIM, prof.id);
  assert.ok((await visibleSims(prof.id)).some((s) => s.id === SIM));
  assert.ok(!(await visibleSims(other.id)).some((s) => s.id === SIM));
});
await t("re-registration refreshes the address but keeps an administrator's wording — until the scenario changes", async () => {
  await adminUpdateSim(admin.id, SIM, { title: "Disaster or Breach? (Flexee edition)" });
  const again = sim.signBack({ kind: "register", sim: SIM, title: META.title, tagline: META.tagline, description: META.description,
    minutes: META.minutes, detail: META.detail || null, catalogueRevision: META.catalogueRevision, launchUrl: "https://new-address.example.app", iat: Date.now(), exp: Date.now() + 300000 });
  assert.equal((await registerSim(again)).ok, true);
  let s = (await visibleSims(admin.id)).find((x) => x.id === SIM)!;
  assert.equal(s.launchUrl, "https://new-address.example.app"); assert.equal(s.title, "Disaster or Breach? (Flexee edition)");
  const newScenario = sim.signBack({ kind: "register", sim: SIM, title: META.title, catalogueRevision: "disaster-v4", launchUrl: "https://new-address.example.app", iat: Date.now(), exp: Date.now() + 300000 });
  await registerSim(newScenario);
  s = (await visibleSims(admin.id)).find((x) => x.id === SIM)!;
  assert.equal(s.title, META.title, "a new scenario revision brings the sim's own title back");
});
await t("a registration not signed with the shared secret is refused", async () => {
  const res = await registerPOST(new Request("https://x/api/register", { method: "POST", body: JSON.stringify({ token: "abc.def" }) }));
  assert.equal(res.status, 401); assert.deepEqual(await res.json(), { error: "bad_signature" });
});

console.log("Sims in a class");
await t("faculty add a sim they can see to their own class; nobody else can", async () => {
  assert.equal((await addSimToClass(prof.id, cls.id, SIM)).ok, true);
  assert.equal((await addSimToClass(other.id, cls.id, SIM)).ok, false, "not their class");
  assert.equal((await addSimToClass(other.id, otherCls.id, SIM)).ok, false, "not visible to them");
  assert.equal((await addSimToClass(ann.id, cls.id, SIM)).ok, false);
});
await t("students do not see an unpublished sim even when it is in their class", async () => {
  assert.deepEqual((await simsForClass(cls.id, true)).map((s) => s.id), []);
  assert.equal((await prepareLaunch(ann.id, SIM, cls.id)).ok, false);
});
await t("faculty can open an unpublished sim, as a preview", async () => {
  const r = await prepareLaunch(prof.id, SIM, cls.id);
  assert.ok(r.ok); assert.equal(sim.verifyLaunch(passIn((r as any).url)).role, "faculty_preview");
});

console.log("Launching (RapidSim 01's own verifyLaunch reads the Wrapper's pass)");
await adminUpdateSim(admin.id, SIM, { published: true });
let annLaunch: any; let annToken = "";
await t("a student launches: the sim accepts the pass and learns who, in what class, and nothing else", async () => {
  const r = await prepareLaunch(ann.id, SIM, cls.id);
  assert.ok(r.ok);
  const url = new URL((r as any).url);
  assert.equal(url.origin + url.pathname, "https://new-address.example.app/");
  assert.ok(url.hash.startsWith("#lt="), "the pass travels in the fragment, never to a server");
  annToken = passIn((r as any).url);
  annLaunch = sim.verifyLaunch(annToken);
  assert.ok(annLaunch, "RapidSim 01 accepts the Wrapper's pass");
  assert.equal(annLaunch.sub, ann.id); assert.equal(annLaunch.role, "student"); assert.equal(annLaunch.sim, SIM);
  assert.equal(annLaunch.course, cls.id); assert.equal(annLaunch.mode, "play"); assert.equal(annLaunch.email, "ann@wright.edu");
  assert.deepEqual(Object.keys(annLaunch).sort(), ["course", "email", "exp", "iat", "mode", "name", "role", "sim", "sub"]);
  const life = (annLaunch.exp - annLaunch.iat) / 60000;
  assert.ok(life >= 119 && life <= 121, "a pass lasts 120 minutes (contract change C2-1)");
});
await t("C2-1: RapidSim 01's own verifier accepts the pass 119 minutes in, and not 121", () => {
  // The sim's code, not a copy of it. Every sim except 04 puts its final submit through the same
  // verifyLaunch, which is the whole reason C2-1 exists: at sixty minutes a pass minted at the
  // start of RapidSim+ 01 (70 minutes) or +02 (65) had expired by the time the sim reported.
  // Asserted here as well as in test:launch-pass because only here is the other side real.
  const real = Date.now, base = real();
  const seenAt = (m: number) => {
    Date.now = () => base + m * 60000;
    try { return sim.verifyLaunch(annToken); } finally { Date.now = real; }
  };
  assert.ok(seenAt(70), "RapidSim+ 01's declared 70 minutes, the length the old default broke");
  assert.ok(seenAt(119), "RapidSim 01 rejected the Wrapper's pass 119 minutes in");
  assert.equal(seenAt(121), null, "and it must still expire");
});
await t("a student of another class, or a stranger, cannot launch it here", async () => {
  assert.equal((await prepareLaunch(bo.id, SIM, cls.id)).ok, false);
  assert.equal((await prepareLaunch(bo.id, SIM, otherCls.id)).ok, false, "not added to Bo's class");
});
await t("faculty run a live class session: mode session, with the team or individual setting", async () => {
  // The code is five characters from A-Z and 2-9. This fixture said "ABC123" until C2-2 pinned the
  // shape, which is six characters and uses an excluded one; the format check now refuses it.
  const r = await prepareLaunch(prof.id, SIM, cls.id, { mode: "session", play: "team", session: "ABC23" });
  const u = new URL((r as any).url);
  assert.equal(u.searchParams.get("play"), "team"); assert.equal(u.searchParams.get("session"), "ABC23");
  const p = sim.verifyLaunch(passIn(u.href)); assert.equal(p.role, "faculty"); assert.equal(p.mode, "session");
  const s = await prepareLaunch(ann.id, SIM, cls.id, { mode: "session" });
  assert.equal(sim.verifyLaunch(passIn((s as any).url)).mode, "play", "students cannot open a session console");
});
await t("C2-2 §4 step 6: a student joining a session launches in play mode and keeps the code", async () => {
  // The defect this fixes. A student's mode is always "play", and the code used to be forwarded
  // only in "session" mode, so an invited student reached the sim with no room to join. RapidSim 01
  // is not a session sim, but prepareLaunch is the only place the code is attached, so the
  // behaviour is the same for the five that are.
  const r = await prepareLaunch(ann.id, SIM, cls.id, { session: "m7k2p" });
  assert.ok(r.ok, (r as any).error);
  const u = new URL((r as any).url);
  assert.equal(u.searchParams.get("session"), "M7K2P", "lower case is normalised, as a student will type it");
  const p = sim.verifyLaunch(passIn(u.href));
  assert.equal(p.mode, "play", "a joining student is playing, not facilitating");
  assert.equal(p.role, "student"); assert.equal(p.course, cls.id);
});
await t("a student cannot promote their own launch with play or mode", async () => {
  // The other half of the gate: `play` must stay session-only, or a student could put themselves
  // in the facilitator's team view by editing the address.
  const r = await prepareLaunch(ann.id, SIM, cls.id, { mode: "session", play: "team", session: "M7K2P" });
  const u = new URL((r as any).url);
  assert.equal(u.searchParams.get("play"), null, "play is the facilitator's choice");
  assert.equal(u.searchParams.get("session"), "M7K2P", "but the room still travels");
  assert.equal(sim.verifyLaunch(passIn(u.href)).mode, "play");
});
await t("a malformed session code is refused, and records no launch", async () => {
  const before = (await db().select().from(schema.simLaunches)).length;
  for (const bad of ["ABC1", "ABC123", "AB C2", "abc", "A-C23", "ABC10", "ABCDEF", " "]) {
    const r = await prepareLaunch(ann.id, SIM, cls.id, { session: bad });
    assert.equal(r.ok, false, `"${bad}" should be refused`);
    assert.equal((r as any).status, 400, bad);
  }
  // 0 and 1 are excluded because they are misread for O and I from a slide.
  assert.equal((await prepareLaunch(ann.id, SIM, cls.id, { session: "ABC01" })).ok, false);
  const after = (await db().select().from(schema.simLaunches)).length;
  assert.equal(after, before, "a refused code must not leave a launch in the log");
  // and an absent code still launches, with no session parameter at all
  const ok = await prepareLaunch(ann.id, SIM, cls.id, {});
  assert.ok(ok.ok);
  assert.equal(new URL((ok as any).url).searchParams.get("session"), null);
});

console.log("Completion and transcript (RapidSim 01's own reportCompletion)");
await t("the sim reports Ann finished; the Wrapper files it under her class", async () => {
  const metrics: Record<string, string> = {}; for (let i = 0; i < 15; i++) metrics[`m${i}`] = "x".repeat(300);
  await sim.reportCompletion({ launch: annLaunch, summary: { verdict: "breach", confidence: "high" }, metrics });
  assert.deepEqual(calls.at(-1), { path: "/api/complete", status: 200 });
  const rows = (await classCompletions(prof.id, cls.id))!;
  assert.equal(rows.length, 1); assert.equal(rows[0].name, "Ann"); assert.equal(rows[0].simId, SIM);
  assert.equal(Object.keys(rows[0].metrics).length, 12, "at most 12 metrics kept");
  assert.equal((rows[0].metrics as any).m0.length, 200, "each trimmed to 200 characters");
  assert.match(rows[0].summary!, /breach/);
});
await t("a completion for someone who never launched the sim here is refused; so is a forged one", async () => {
  const notLaunched = sim.signBack({ sub: bo.id, sim: SIM, course: cls.id, duration: 60, iat: Date.now(), exp: Date.now() + 300000 });
  assert.equal(((await recordCompletion(notLaunched)) as any).status, 404);
  const res = await completePOST(new Request("https://x/api/complete", { method: "POST", body: JSON.stringify({ token: notLaunched.split(".")[0] + ".forged" }) }));
  assert.equal(res.status, 401);
  assert.equal((await classCompletions(other.id, cls.id)), null, "another class's faculty cannot read it");
});
await t("transcripts: accepted when renderable; refused if they carry a character's words, are too large, or name another sim", async () => {
  const tok = sim.signBack({ sub: ann.id, sim: SIM, course: cls.id, iat: Date.now(), exp: Date.now() + 300000 });
  const env = { simId: SIM, simVersion: "v3", phases: [{ id: "p1" }], events: [{ ordinal: 1, phase: "p1", outputRef: "o-17" }] };
  const ok = await transcriptPOST(new Request("https://x/api/transcript", { method: "POST", body: JSON.stringify({ token: tok, envelope: env }) }));
  assert.equal(ok.status, 200);
  assert.equal(((await recordTranscript(tok, { ...env, events: [{ ordinal: 1, phase: "p1", text: "the CFO said…" }] })) as any).error, "event_carries_answer_text");
  assert.equal(((await recordTranscript(tok, { ...env, phases: [{ pad: "x".repeat(300 * 1024) }] })) as any).status, 413);
  assert.equal(((await recordTranscript(tok, { ...env, simId: "another-sim" })) as any).error, "sim_mismatch");
  const tr = (await transcriptsFor(prof.id, cls.id, ann.id, SIM))!;
  assert.equal(tr.length, 1); assert.equal(tr[0].envelope.events[0].outputRef, "o-17");
  assert.equal(await transcriptsFor(other.id, cls.id, ann.id, SIM), null);
});
await t("removing a sim from a class stops new launches; history stays", async () => {
  await removeSimFromClass(prof.id, cls.id, SIM);
  assert.equal((await prepareLaunch(ann.id, SIM, cls.id)).ok, false);
  assert.equal((await classCompletions(prof.id, cls.id))!.length, 1);
});

globalThis.fetch = realFetch;
console.log(`\n${passed} passed`);
