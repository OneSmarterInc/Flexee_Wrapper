// Integration test: C2-2 §4 — /session.html, the invite a student follows.
//
// The eight steps are checked as states rather than scraped out of markup, which is what
// sessionState exists for. The page itself is rendered too, once per state, by test:a11y-pages.
//
// The property worth most here is §4's last line: "The page decides nothing the launch doesn't."
// So every state that lets a student through is cross-checked against prepareLaunch, and every
// refusal is one the launch would also have made — except the two that stop earlier on purpose.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, enrolAs, setAccessRelease, setJoinCodeEnabled } from "@/lib/roster";
import { addSimToClass, adminUpdateSim, prepareLaunch } from "@/lib/sims";
import { setAdminByEmail } from "@/lib/admin";
import { withdrawStudents } from "@/lib/withdraw";
import { sessionState } from "@/lib/session-entry";

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
const enrolmentOf = async (sectionId: string, userId: string) =>
  (await db().select().from(enrolments).where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.userId, userId))))[0];

const SIM = "rapid-05-approve";
const CODE = "M7K2P";
const prof = await account("Pat Professor", "prof@flexee.org");
const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");
const cls = await createSection(prof.id, "sad", "Systems Analysis 01", "2027 Spring", { teach: true });
await db().insert(schema.sims).values({ id: SIM, number: 5, title: "Would You Approve This?", launchUrl: "https://sim05.example.app" });
await adminUpdateSim(admin.id, SIM, { published: true });
await addSimToClass(prof.id, cls.id, SIM);

const ann = await account("Ann Wright", "ann@wright.edu");
await enrolAs(cls.id, ann.id, "student");
const viewerOf = (u: { id: string }, isAdmin = false) => ({ id: u.id, isAdmin });
const link = (over: Record<string, string | null> = {}) =>
  ({ sim: SIM, session: CODE, course: cls.id, ...over });

await t("step 1: a sim that has no sessions, or a code of the wrong shape, is an invalid link", async () => {
  // Checked before anything is read, so a mistyped link reveals nothing about what exists.
  for (const over of [{ sim: "rapid-01-disaster" }, { sim: "rapidsimplus-02" }, { sim: "" }, { sim: "nonsense" }]) {
    assert.equal((await sessionState(link(over), null)).kind, "invalid", JSON.stringify(over));
  }
  for (const bad of ["", "ABC1", "ABC123", "AB C2", "ABC01", "abc", "ABCDEF"]) {
    assert.equal((await sessionState(link({ session: bad }), null)).kind, "invalid", bad);
  }
  // 06, 07 and 10 have sessions but no roster, and must still be valid links here.
  for (const sim of ["rapid-06-switch", "rapid-07-bought", "rapid-10-bubble"]) {
    assert.notEqual((await sessionState(link({ sim, course: null }), null)).kind, "invalid", sim);
  }
  // Lower case is accepted, because a student types what is on the slide.
  assert.notEqual((await sessionState(link({ session: "m7k2p" }), null)).kind, "invalid");
});

await t("step 2: a class that does not exist, or a sim not in it, says which", async () => {
  let s = await sessionState(link({ course: "no-such-class" }), null);
  assert.equal(s.kind, "no-class");
  assert.match((s as any).why, /could not be found/);

  const bare = await createSection(prof.id, "sad", "No Sims Here", "2027 Spring", { teach: true });
  s = await sessionState(link({ course: bare.id }), null);
  assert.equal(s.kind, "no-class");
  assert.match((s as any).why, /not part of this class/);
});

await t("step 2: the class title and code are carried into every later state", async () => {
  const s = await sessionState(link(), null);
  assert.equal(s.kind, "signed-out");
  assert.equal((s as any).className, "Systems Analysis 01");
});

await t("step 3: signed out, with the class known", async () => {
  const s = await sessionState(link(), null);
  assert.equal(s.kind, "signed-out");
  assert.equal((s as any).canJoinWithCode, false, "the class's switch is off by default");
  await setJoinCodeEnabled(cls.id, true);
  assert.equal((await sessionState(link(), null) as any).canJoinWithCode, true);
  await setJoinCodeEnabled(cls.id, false);
});

await t("step 4: an instructor is told it is a student link; so is an admin", async () => {
  assert.equal((await sessionState(link(), viewerOf(prof))).kind, "instructor");
  // An admin who is not on the class reaches the same place, because it is a student link either way.
  assert.equal((await sessionState(link(), viewerOf(admin, true))).kind, "instructor");
});

await t("step 5: a student who is not in the class is offered the join, if the class allows it", async () => {
  const outsider = await account("Outside", "outside@wright.edu");
  let s = await sessionState(link(), viewerOf(outsider));
  assert.equal(s.kind, "not-in-class");
  assert.equal((s as any).canJoinWithCode, false, "off by default, so the offer is not made");
  assert.equal((s as any).joinCode, cls.joinCode, "the code is still carried, for when it is on");

  await setJoinCodeEnabled(cls.id, true);
  s = await sessionState(link(), viewerOf(outsider));
  assert.equal((s as any).canJoinWithCode, true);
  await setJoinCodeEnabled(cls.id, false);
});

await t("step 5: an older link with no class at all asks to join rather than guessing one", async () => {
  // `course` is absent on older invites. Picking a class for the student would be a guess, and the
  // old platform asked for the code in exactly this case.
  const s = await sessionState(link({ course: null }), viewerOf(ann));
  assert.equal(s.kind, "not-in-class");
  assert.equal((s as any).className, null);
});

await t("step 7: enrolled but unreleased is a waiting state, not a refusal", async () => {
  // It has to be told apart from the other 403s, because it is the only one worth waiting on.
  const s = await sessionState(link(), viewerOf(ann));
  assert.equal(s.kind, "waiting");
  assert.equal((s as any).className, "Systems Analysis 01");
  // and the launch agrees it would have refused
  const r = await prepareLaunch(ann.id, SIM, cls.id, { session: CODE });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /Waiting on your instructor/);
});

await t("step 6: released, and the launch carries mode=play with the session code", async () => {
  await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [(await enrolmentOf(cls.id, ann.id)).id] });
  const s = await sessionState(link(), viewerOf(ann));
  assert.equal(s.kind, "go");
  const url = new URL((s as any).url);
  assert.equal(url.origin + url.pathname, "https://sim05.example.app/");
  assert.equal(url.searchParams.get("session"), CODE, "without this the student never reaches the room");
  assert.equal(url.searchParams.get("play"), null, "team or individual is the facilitator's choice");
  assert.ok(url.hash.startsWith("#lt="), "the pass travels in the fragment");
  const { verifyPass } = await import("@/lib/launchpass");
  const p = verifyPass(decodeURIComponent(url.hash.replace(/^#lt=/, "")))!;
  assert.equal(p.mode, "play"); assert.equal(p.role, "student"); assert.equal(p.course, cls.id);
});

await t("step 6: a lower-case code reaches the sim upper-cased", async () => {
  const s = await sessionState(link({ session: "m7k2p" }), viewerOf(ann));
  assert.equal(new URL((s as any).url).searchParams.get("session"), "M7K2P");
});

await t("step 8: a withdrawn student gets the launch's own words, not an invented sentence", async () => {
  const gone = await account("Gone Away", "gone2@wright.edu");
  await enrolAs(cls.id, gone.id, "student");
  const e = await enrolmentOf(cls.id, gone.id);
  await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [e.id] });
  await withdrawStudents(prof.id, cls.id, [e.id]);

  const s = await sessionState(link(), viewerOf(gone));
  assert.equal(s.kind, "refused");
  const r = await prepareLaunch(gone.id, SIM, cls.id, { session: CODE });
  assert.equal((s as any).message, r.ok === false ? r.error : "", "the page must not reword the launch");
  assert.match((s as any).message, /no longer enrolled/i);
});

await t("step 8: an unpublished sim refuses, in the launch's words", async () => {
  await adminUpdateSim(admin.id, SIM, { published: false });
  const s = await sessionState(link(), viewerOf(ann));
  assert.equal(s.kind, "refused");
  assert.match((s as any).message, /not open in your class/);
  await adminUpdateSim(admin.id, SIM, { published: true });
});

await t("the demo student goes straight through, as it does at launch", async () => {
  const demo = await account("Demo Student", "demo2@wright.edu");
  await enrolAs(cls.id, demo.id, "student", { isDemo: true });
  const s = await sessionState(link(), viewerOf(demo));
  assert.equal(s.kind, "go", "a demo is never gated, so it is never waiting");
  assert.equal(new URL((s as any).url).searchParams.get("session"), CODE);
});

await t("the page decides nothing the launch doesn't: no state lets anyone past it", async () => {
  // §4's closing rule, checked over every person in the fixture: whenever the page says "go", the
  // launch agrees, and whenever the page refuses or waits, the launch refuses too.
  const everyone = await db().select({ userId: enrolments.userId }).from(enrolments)
    .where(eq(enrolments.sectionId, cls.id));
  let gos = 0, stops = 0;
  for (const { userId } of everyone) {
    const s = await sessionState(link(), viewerOf({ id: userId }));
    const r = await prepareLaunch(userId, SIM, cls.id, { session: CODE });
    if (s.kind === "go") { assert.ok(r.ok, `page said go, launch said no for ${userId}`); gos++; }
    else if (s.kind === "waiting" || s.kind === "refused") {
      assert.equal(r.ok, false, `page said no, launch said yes for ${userId}`); stops++;
    }
  }
  assert.ok(gos > 0 && stops > 0, `the fixture must exercise both: ${gos} through, ${stops} stopped`);
});

await t("the waiting poller stops after ten minutes, and says why", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/WaitingForRelease.tsx", "utf8");
  assert.match(src, /everyMs = 5000/, "Addendum B §2: every 5 seconds");
  assert.match(src, /stopAfterMs = 10 \* 60 \* 1000/, "and stops after 10 minutes");
  assert.ok(src.includes("Check again"), "with a button");
  // It must re-ask the server rather than deciding anything itself.
  assert.ok(src.includes("router.refresh()"));
  assert.ok(!src.includes("prepareLaunch") && !src.includes("fetch("), "the client decides nothing");
});

await t("the page is not for search engines", async () => {
  const { metadata } = await import("@/app/session/page");
  assert.deepEqual((metadata as any).robots, { index: false, follow: false });
});

console.log("\n%d checks passed", passed);
