// Integration test: C2-2 v1.1 §2 — POST /api/session-enrolments.
//
// Driven through the route handler, not the library, because half of what the contract fixes is the
// HTTP shape: the status codes, the exact error bodies, no-store, 405 on anything but POST, and the
// absence of CORS headers. The passes are minted by the Wrapper's own launchPass, so a pass that
// the roster accepts is one a sim would have been given.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, enrolAs, setAccessRelease } from "@/lib/roster";
import { addSimToClass, adminUpdateSim } from "@/lib/sims";
import { setAdminByEmail } from "@/lib/admin";
import { withdrawStudents } from "@/lib/withdraw";
import { launchPass } from "@/lib/launchpass";
import { SESSION_SIMS, ROSTER_SIMS, participantId } from "@/lib/session-sims";
import { POST, GET, PUT, DELETE, HEAD } from "@/app/api/session-enrolments/route";

const { users, identities, enrolments } = schema;
process.env.LAUNCH_SECRET = "test-launch-secret";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
async function enrolmentOf(sectionId: string, userId: string) {
  const [e] = await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.userId, userId)));
  return e;
}

const SIM = "rapid-05-approve";                  // the contract's own test sim
const NOT_ROSTER = "rapid-06-switch";            // a session sim that does not read a roster
const prof = await account("Pat Professor", "prof@flexee.org");
const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });

for (const id of [SIM, NOT_ROSTER]) {
  await db().insert(schema.sims).values({ id, number: id === SIM ? 5 : 6, title: id, launchUrl: `https://${id}.example.app` });
  await adminUpdateSim(admin.id, id, { published: true });
}
await addSimToClass(prof.id, cls.id, SIM);

// Three students: one released, one waiting, one withdrawn. Names chosen so case-insensitive
// ordering differs from byte ordering — "ada" sorts before "Bea" only if case is folded.
const ada = await account("ada lovelace", "ada@wright.edu");
const bea = await account("Bea Clarke", "bea@wright.edu");
const cas = await account("Cas Gone", "cas@wright.edu");
for (const u of [ada, bea, cas]) await enrolAs(cls.id, u.id, "student");
await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [(await enrolmentOf(cls.id, ada.id)).id] });
await withdrawStudents(prof.id, cls.id, [(await enrolmentOf(cls.id, cas.id)).id]);

/** A pass of the shape a facilitator console would hold. */
const facultyPass = (over: Record<string, unknown> = {}) =>
  launchPass({ userId: prof.id, name: "Pat Professor", email: "prof@flexee.org", role: "faculty",
               simId: SIM, sectionId: cls.id, mode: "session", ...over } as any);

async function call(token: string | null, body: unknown, method = "POST") {
  const req = new Request("https://learn.flexee.org/api/session-enrolments", {
    method, headers: token == null ? {} : { "x-launch-token": token },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const res = method === "POST" ? await POST(req) : await ({ GET, PUT, DELETE, HEAD } as any)[method](req);
  return { res, body: await res.json().catch(() => ({})) };
}

await t("the two sim lists agree with C2-2 §1, and roster sims are a subset", () => {
  assert.equal(SESSION_SIMS.size, 8, "sims 03-10 may carry a session link");
  assert.equal(ROSTER_SIMS.size, 5, "five of them read a roster");
  for (const s of ROSTER_SIMS) assert.ok(SESSION_SIMS.has(s), `${s} reads a roster but has no session`);
  // The old platform's set held rapidsimplus-02 while its entry page did not; v1.1 settles that.
  assert.ok(!SESSION_SIMS.has("rapidsimplus-02"), "+02 has its own console");
  for (const s of ["rapid-06-switch", "rapid-07-bought", "rapid-10-bubble"]) {
    assert.ok(SESSION_SIMS.has(s) && !ROSTER_SIMS.has(s), `${s}: session yes, roster no`);
  }
});

await t("a facilitator's pass lists the class's students, released state and all", async () => {
  const { res, body } = await call(facultyPass(), { courseId: cls.id });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.students, [
    { participantId: participantId(ada.id), name: "ada lovelace", accessReleased: true },
    { participantId: participantId(bea.id), name: "Bea Clarke", accessReleased: false },
  ], "two active students, the withdrawn one absent, case-insensitively ordered");
  // accessReleased must be a real boolean: the sims test === true.
  for (const s of body.students) assert.equal(typeof s.accessReleased, "boolean");
});

await t("nothing else about a student is in the answer", async () => {
  const { body } = await call(facultyPass(), { courseId: cls.id });
  assert.deepEqual(Object.keys(body), ["students"]);
  for (const s of body.students) assert.deepEqual(Object.keys(s).sort(), ["accessReleased", "name", "participantId"]);
  const text = JSON.stringify(body);
  for (const leak of ["ada@wright.edu", "bea@wright.edu", "@wright.edu", "dept PO"]) {
    assert.ok(!text.includes(leak), `${leak} is in the roster answer`);
  }
});

await t("the participant id is platform: plus the same id the student's own pass carries", async () => {
  // The thing the sims actually match on. sim03/api/session.js builds `platform:${launched.sub}`
  // itself, so if these two ever differ, team assignment breaks and nothing reports it.
  const studentPass = launchPass({ userId: ada.id, name: "ada lovelace", role: "student", simId: SIM, sectionId: cls.id } as any);
  const { verifyPass } = await import("@/lib/launchpass");
  const sub = verifyPass(studentPass)!.sub;
  const { body } = await call(facultyPass(), { courseId: cls.id });
  assert.equal(body.students[0].participantId, `platform:${sub}`);
});

await t("releasing a student flips accessReleased on the next call (C2-2 §6 test 2)", async () => {
  const before = (await call(facultyPass(), { courseId: cls.id })).body.students
    .find((s: any) => s.participantId === participantId(bea.id));
  assert.equal(before.accessReleased, false);
  await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [(await enrolmentOf(cls.id, bea.id)).id] });
  const after = (await call(facultyPass(), { courseId: cls.id })).body.students
    .find((s: any) => s.participantId === participantId(bea.id));
  assert.equal(after.accessReleased, true);
});

await t("the Demo Student is listed, and always released (C2-2 v1.1)", async () => {
  const demo = await account("Zed Demo", "demo@wright.edu");
  await enrolAs(cls.id, demo.id, "student", { isDemo: true });
  const { body } = await call(facultyPass(), { courseId: cls.id });
  const row = body.students.find((s: any) => s.participantId === participantId(demo.id));
  assert.ok(row, "the demo is an ordinary roster row");
  assert.equal(row.accessReleased, true, "and always released, so it can be put in a team");
  // Its own enrolment carries no release: the rule is read, not stored, exactly as at launch.
  assert.equal((await enrolmentOf(cls.id, demo.id)).releasedAt, null);
});

await t("an instructor is never listed", async () => {
  const { body } = await call(facultyPass(), { courseId: cls.id });
  assert.ok(!body.students.some((s: any) => s.participantId === participantId(prof.id)));
});

await t("check 1: no pass, a broken pass, or one signed with another secret → 401", async () => {
  for (const bad of [null, "", "not-a-pass", "a.b"]) {
    const { res, body } = await call(bad as any, { courseId: cls.id });
    assert.equal(res.status, 401, String(bad));
    assert.deepEqual(body, { error: "faculty_authorization_required" });
  }
  const { signPass } = await import("@/lib/launchpass");
  const forged = signPass({ sub: prof.id, sim: SIM, role: "faculty", mode: "session", course: cls.id, exp: Date.now() + 60000 },
                          { LAUNCH_SECRET: "someone-elses-secret" } as any);
  assert.equal((await call(forged, { courseId: cls.id })).res.status, 401);
});

await t("check 1: an expired pass is refused, which is how a console goes quiet after 120 minutes", async () => {
  const token = facultyPass();
  const real = Date.now, base = real();
  Date.now = () => base + 121 * 60000;
  try {
    const { res, body } = await call(token, { courseId: cls.id });
    assert.equal(res.status, 401);
    assert.deepEqual(body, { error: "faculty_authorization_required" });
  } finally { Date.now = real; }
});

await t("check 2: a faculty_preview pass, a student pass, or play mode → 401", async () => {
  for (const over of [{ role: "faculty_preview" as const }, { role: "student" as const }, { mode: "play" }]) {
    const { res, body } = await call(facultyPass(over), { courseId: cls.id });
    assert.equal(res.status, 401, JSON.stringify(over));
    assert.deepEqual(body, { error: "faculty_authorization_required" });
  }
});

await t("check 2: a sim that reads no roster is refused even in session mode", async () => {
  await addSimToClass(prof.id, cls.id, NOT_ROSTER);
  const { res } = await call(facultyPass({ simId: NOT_ROSTER }), { courseId: cls.id });
  assert.equal(res.status, 401, "06 has sessions but no roster");
});

await t("check 3: a missing, oversized, or mismatched courseId → 403 session_course_mismatch", async () => {
  for (const id of [undefined, "", null, 123, "x".repeat(201)]) {
    const { res, body } = await call(facultyPass(), { courseId: id });
    assert.equal(res.status, 403, String(id));
    assert.deepEqual(body, { error: "session_course_mismatch" });
  }
  // A real class, but not the one in the pass.
  const other = await createSection(prof.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
  await addSimToClass(prof.id, other.id, SIM);
  const { res, body } = await call(facultyPass(), { courseId: other.id });
  assert.equal(res.status, 403);
  assert.deepEqual(body, { error: "session_course_mismatch" },
    "holding one class's pass must not open another's roster");
});

await t("check 4: a pass for someone who no longer teaches the class → 403 forbidden", async () => {
  // Re-checked in the database, not taken from the pass. This is the case a signature cannot catch:
  // the pass was validly issued, and then the facts behind it changed. A pass lasts 120 minutes,
  // which is long enough for that to happen during one session.
  const sec = await createSection(prof.id, "sad", "MIS 3250-03", "2027 Spring", { teach: true });
  await addSimToClass(prof.id, sec.id, SIM);
  const token = launchPass({ userId: prof.id, name: "Pat", role: "faculty", simId: SIM, sectionId: sec.id, mode: "session" } as any);
  assert.equal((await call(token, { courseId: sec.id })).res.status, 200, "fine while teaching it");

  // The way it actually happens: the instructor's enrolment is removed from the class.
  const { removeEnrolment } = await import("@/lib/roster");
  await removeEnrolment(sec.id, (await enrolmentOf(sec.id, prof.id)).id);
  const { res, body } = await call(token, { courseId: sec.id });
  assert.equal(res.status, 403, "a pass outlives the enrolment it was issued against");
  assert.deepEqual(body, { error: "course_roster_forbidden" });
});

await t("check 4: and a withdrawn instructor enrolment is refused, though nothing can make one today", async () => {
  // C2-2 v1.1 check 4 asks for "an instructor enrolment that is not withdrawn". No supported path
  // creates one: setWithdrawn refuses any row whose role is not student (withdraw.ts), so the
  // column is written here directly. The filter is kept as defence — the column exists on every
  // enrolment, and a future bulk action or import that stopped excluding instructors would
  // otherwise hand a withdrawn one a live roster.
  const sec = await createSection(prof.id, "sad", "MIS 3250-05", "2027 Spring", { teach: true });
  await addSimToClass(prof.id, sec.id, SIM);
  const token = launchPass({ userId: prof.id, name: "Pat", role: "faculty", simId: SIM, sectionId: sec.id, mode: "session" } as any);
  assert.equal((await call(token, { courseId: sec.id })).res.status, 200);

  const mine = await enrolmentOf(sec.id, prof.id);
  assert.equal((await withdrawStudents(prof.id, sec.id, [mine.id])).ok, false,
    "the supported path still refuses to withdraw an instructor");
  await db().update(enrolments).set({ withdrawnAt: new Date() }).where(eq(enrolments.id, mine.id));

  const { res, body } = await call(token, { courseId: sec.id });
  assert.equal(res.status, 403);
  assert.deepEqual(body, { error: "course_roster_forbidden" });
});

await t("check 4: a pass naming a class or a person that does not exist → 403 forbidden", async () => {
  const ghostClass = launchPass({ userId: prof.id, name: "Pat", role: "faculty", simId: SIM, sectionId: "no-such-class", mode: "session" } as any);
  let r = await call(ghostClass, { courseId: "no-such-class" });
  assert.equal(r.res.status, 403);
  assert.deepEqual(r.body, { error: "course_roster_forbidden" });

  const ghostUser = launchPass({ userId: "no-such-user", name: "Nobody", role: "faculty", simId: SIM, sectionId: cls.id, mode: "session" } as any);
  r = await call(ghostUser, { courseId: cls.id });
  assert.equal(r.res.status, 403);
  assert.deepEqual(r.body, { error: "course_roster_forbidden" });
});

await t("check 5: a sim not added to that class → 403 simulation_not_on_course", async () => {
  const sec = await createSection(prof.id, "sad", "MIS 3250-04", "2027 Spring", { teach: true });
  const token = launchPass({ userId: prof.id, name: "Pat", role: "faculty", simId: SIM, sectionId: sec.id, mode: "session" } as any);
  const { res, body } = await call(token, { courseId: sec.id });
  assert.equal(res.status, 403);
  assert.deepEqual(body, { error: "simulation_not_on_course" });
});

await t("the checks are in the contract's order, so a refusal says as little as it can", async () => {
  // A pass that fails several checks at once must report the earliest. Otherwise the error code
  // tells a caller which facts it got right, about a class it has not proved it may see.
  const everything = launchPass({ userId: "no-such-user", name: "N", role: "student",
                                  simId: NOT_ROSTER, sectionId: "no-such-class", mode: "play" } as any);
  const { res, body } = await call(everything, { courseId: "mismatched" });
  assert.equal(res.status, 401, "check 2 comes before check 3");
  assert.deepEqual(body, { error: "faculty_authorization_required" });
});

await t("every method but POST is 405, and says so", async () => {
  for (const m of ["GET", "PUT", "DELETE", "HEAD"]) {
    const { res } = await call(facultyPass(), null, m);
    assert.equal(res.status, 405, m);
    assert.equal(res.headers.get("allow"), "POST");
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

await t("it sends no CORS headers, because the call is server to server", async () => {
  // C2-2 §2: "No CORS needed". The Wrapper's other three sim endpoints are open to any origin
  // because sims post to them from browsers too; this one is not, and widening it would expose a
  // class roster to any page on the internet that could obtain a pass.
  const { res } = await call(facultyPass(), { courseId: cls.id });
  for (const h of ["access-control-allow-origin", "access-control-allow-headers", "access-control-allow-methods"]) {
    assert.equal(res.headers.get(h), null, `${h} should not be sent`);
  }
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/app/api/session-enrolments/route.ts", "utf8");
  assert.ok(!src.includes("sim-endpoint"), "it must not borrow the CORS-bearing helper");
  assert.ok(!/export (const|async function) OPTIONS/.test(src), "and there is no preflight to answer");
});

await t("it reads no cookie: the pass is the only credential", async () => {
  const req = new Request("https://learn.flexee.org/api/session-enrolments", {
    method: "POST",
    headers: { cookie: "fx_session=whatever-a-browser-had", "content-type": "application/json" },
    body: JSON.stringify({ courseId: cls.id }),
  });
  const res = await POST(req);
  assert.equal(res.status, 401, "a cookie must not stand in for a pass");
});

await t("a body that is not JSON is a mismatch, not a crash", async () => {
  const req = new Request("https://learn.flexee.org/api/session-enrolments", {
    method: "POST", headers: { "x-launch-token": facultyPass() }, body: "not json at all",
  });
  const res = await POST(req);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "session_course_mismatch" });
});

console.log("\n%d checks passed", passed);
