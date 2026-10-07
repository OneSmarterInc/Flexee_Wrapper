// Integration test: Addendum B §3 / Addendum A §5 — /open.html, direct-link entry.
//
// The job this page has that nothing else in the Wrapper does is find the class: /sims/launch
// requires a section id, and a link from inside a sim knows only the sim. So most of these checks
// are about that search — in particular that it never guesses when there is more than one answer,
// and that "no class of yours uses this" is told apart from "you are in no class at all".
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, enrolAs, setAccessRelease } from "@/lib/roster";
import { addSimToClass, adminUpdateSim } from "@/lib/sims";
import { setAdminByEmail } from "@/lib/admin";
import { withdrawStudents } from "@/lib/withdraw";
import { openState } from "@/lib/open-entry";

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
const release = async (actor: string, sectionId: string, userId: string) =>
  setAccessRelease(actor, sectionId, { released: true, enrolmentIds: [(await enrolmentOf(sectionId, userId)).id] });

const SIM = "rapid-01-disaster";
const OTHER_SIM = "rapid-05-approve";
const prof = await account("Pat Professor", "prof@flexee.org");
const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");

for (const [id, n] of [[SIM, 1], [OTHER_SIM, 5]] as const) {
  await db().insert(schema.sims).values({ id, number: n, title: id, launchUrl: `https://${id}.example.app` });
  await adminUpdateSim(admin.id, id, { published: true });
}

const alpha = await createSection(prof.id, "sad", "Alpha Class", "2027 Spring", { teach: true });
const beta = await createSection(prof.id, "sad", "Beta Class", "2027 Spring", { teach: true });
await addSimToClass(prof.id, alpha.id, SIM);
await addSimToClass(prof.id, beta.id, SIM);

const viewerOf = (u: { id: string }, isAdmin = false) => ({ id: u.id, isAdmin });

await t("an unknown sim, or none, is not recognised", async () => {
  for (const sim of ["", undefined, null, "not-a-sim", "rapid-99-nope"]) {
    assert.equal((await openState({ sim: sim as any }, null)).kind, "invalid", String(sim));
  }
});

await t("signed out, whatever the sim: sign in and come back", async () => {
  assert.equal((await openState({ sim: SIM }, null)).kind, "signed-out");
  // The state carries nothing about classes, because nothing has been proved about who this is.
  assert.deepEqual(Object.keys(await openState({ sim: SIM }, null)), ["kind"]);
});

await t("a student in no class at all is told to ask their instructor", async () => {
  const nobody = await account("No Class", "noclass@wright.edu");
  const s = await openState({ sim: SIM }, viewerOf(nobody));
  assert.equal(s.kind, "not-enrolled");
});

await t("a student in a class that does not use this sim is told *that*, with the class named", async () => {
  // The old platform added this distinction because "Not enrolled" was reported for both, sending
  // people to check a student's enrolment when the class was fine and the sim was simply not in it.
  const sec = await createSection(prof.id, "sad", "Gamma Class", "2027 Spring", { teach: true });
  const u = await account("Wrong Class", "wrongclass@wright.edu");
  await enrolAs(sec.id, u.id, "student");
  const s = await openState({ sim: SIM }, viewerOf(u));
  assert.equal(s.kind, "not-added");
  assert.equal((s as any).className, "Gamma Class", "naming the class is the point of the message");
});

await t("one eligible class and released: straight through, with no class id in the link", async () => {
  const u = await account("One Class", "oneclass@wright.edu");
  await enrolAs(alpha.id, u.id, "student");
  await release(prof.id, alpha.id, u.id);
  const s = await openState({ sim: SIM }, viewerOf(u));
  assert.equal(s.kind, "go");
  const url = new URL((s as any).url);
  assert.equal(url.origin + url.pathname, "https://rapid-01-disaster.example.app/");
  const { verifyPass } = await import("@/lib/launchpass");
  const p = verifyPass(decodeURIComponent(url.hash.replace(/^#lt=/, "")))!;
  assert.equal(p.course, alpha.id, "the class it found is the one in the pass");
  assert.equal(p.role, "student");
});

await t("one eligible class, unreleased: waiting, named, and not a bare refusal", async () => {
  const u = await account("Unreleased One", "unrel1@wright.edu");
  await enrolAs(alpha.id, u.id, "student");
  const s = await openState({ sim: SIM }, viewerOf(u));
  assert.equal(s.kind, "waiting");
  assert.equal((s as any).className, "Alpha Class");
});

await t("more than one eligible class: it asks, and never guesses", async () => {
  // Addendum B §3. The old platform picked one with ORDER BY e.paid DESC LIMIT 1, which silently
  // decides for a student who has the sim in two classes.
  const u = await account("Two Classes", "two@wright.edu");
  await enrolAs(alpha.id, u.id, "student");
  await enrolAs(beta.id, u.id, "student");
  await release(prof.id, alpha.id, u.id);
  const s = await openState({ sim: SIM }, viewerOf(u));
  assert.equal(s.kind, "choose");
  const names = (s as any).classes.map((c: any) => c.name);
  assert.deepEqual(names, ["Alpha Class", "Beta Class"], "ordered by name, so the list is stable");
  // Each option says whether it is ready, so the choice is not made blind.
  assert.deepEqual((s as any).classes.map((c: any) => c.released), [true, false]);
  assert.equal((s as any).sim, SIM, "the sim is carried, since each option links back to the launch");
});

await t("a withdrawn enrolment is not an eligible class", async () => {
  const u = await account("Withdrawn Here", "wh@wright.edu");
  await enrolAs(alpha.id, u.id, "student");
  await enrolAs(beta.id, u.id, "student");
  await release(prof.id, alpha.id, u.id);
  await release(prof.id, beta.id, u.id);
  assert.equal((await openState({ sim: SIM }, viewerOf(u))).kind, "choose", "two to start with");

  await withdrawStudents(prof.id, beta.id, [(await enrolmentOf(beta.id, u.id)).id]);
  const s = await openState({ sim: SIM }, viewerOf(u));
  assert.equal(s.kind, "go", "down to one, so no choice to make");
  const { verifyPass } = await import("@/lib/launchpass");
  const p = verifyPass(decodeURIComponent(new URL((s as any).url).hash.replace(/^#lt=/, "")))!;
  assert.equal(p.course, alpha.id, "and it is the class they are still in");
});

await t("staff are sent to the class's Simulations page, not into the sim", async () => {
  // Addendum B §3: students only.
  const s = await openState({ sim: SIM }, viewerOf(prof));
  assert.equal(s.kind, "staff");
  assert.ok([alpha.id, beta.id].includes((s as any).sectionId), "a class of theirs that has the sim");

  // An admin who teaches nothing still gets the staff page, with nowhere specific to send them.
  const a = await openState({ sim: SIM }, viewerOf(admin, true));
  assert.equal(a.kind, "staff");
  assert.equal((a as any).sectionId, null);
});

await t("an instructor who teaches a class without this sim is still staff", async () => {
  const other = await account("Other Prof", "otherprof@flexee.org");
  const sec = await createSection(other.id, "sad", "No Sim Class", "2027 Spring", { teach: true });
  const s = await openState({ sim: SIM }, viewerOf(other));
  assert.equal(s.kind, "staff", "never 'not-added': they are not a student here");
  assert.equal((s as any).sectionId, sec.id, "sent to the class they do teach");
});

await t("a session code rides along to the sim, and a bad one is dropped rather than fatal", async () => {
  const u = await account("With Code", "withcode@wright.edu");
  await enrolAs(alpha.id, u.id, "student");
  await release(prof.id, alpha.id, u.id);

  const good = await openState({ sim: SIM, session: "m7k2p" }, viewerOf(u));
  assert.equal(new URL((good as any).url).searchParams.get("session"), "M7K2P");

  // A stale or mistyped code must not turn the whole visit into an error: the student can still
  // play, they just are not in a room. prepareLaunch would have refused the launch outright.
  const bad = await openState({ sim: SIM, session: "nope!" }, viewerOf(u));
  assert.equal(bad.kind, "go", "a bad code is dropped, not fatal");
  assert.equal(new URL((bad as any).url).searchParams.get("session"), null);
});

await t("an unpublished sim refuses in the launch's words, not the page's", async () => {
  const u = await account("Unpublished", "unpub@wright.edu");
  await enrolAs(alpha.id, u.id, "student");
  await release(prof.id, alpha.id, u.id);
  await adminUpdateSim(admin.id, SIM, { published: false });
  const s = await openState({ sim: SIM }, viewerOf(u));
  assert.equal(s.kind, "refused");
  const { prepareLaunch } = await import("@/lib/sims");
  const r = await prepareLaunch(u.id, SIM, alpha.id, {});
  assert.equal((s as any).message, r.ok === false ? r.error : "");
  await adminUpdateSim(admin.id, SIM, { published: true });
});

await t("the demo student goes through without a release, as everywhere else", async () => {
  const demo = await account("Demo Student", "demo3@wright.edu");
  await enrolAs(alpha.id, demo.id, "student", { isDemo: true });
  const s = await openState({ sim: SIM }, viewerOf(demo));
  assert.equal(s.kind, "go");
});

await t("no state lets anybody past the launch", async () => {
  // Everyone in Alpha, put through the page and the launch. For a "go" the class is read out of
  // the pass the page produced, so the launch is re-checked against the class the page actually
  // chose rather than one this test assumes.
  const everyone = await db().select({ userId: enrolments.userId }).from(enrolments)
    .where(eq(enrolments.sectionId, alpha.id));
  const { prepareLaunch } = await import("@/lib/sims");
  const { verifyPass } = await import("@/lib/launchpass");
  let gos = 0, stops = 0;
  for (const { userId } of everyone) {
    const s = await openState({ sim: SIM }, viewerOf({ id: userId }));
    if (s.kind === "go") {
      const chose = String(verifyPass(decodeURIComponent(new URL(s.url).hash.replace(/^#lt=/, "")))!.course);
      const r = await prepareLaunch(userId, SIM, chose, {});
      assert.ok(r.ok, `page said go for ${userId}, launch refused in ${chose}`);
      gos++;
    } else if (s.kind === "waiting" || s.kind === "refused") {
      // Alpha is the only class of theirs with this sim at this point, so it is the class the page
      // would have used, and the launch has to agree about it.
      const r = await prepareLaunch(userId, SIM, alpha.id, {});
      assert.equal(r.ok, false, `page stopped ${userId}, launch would have let them in`);
      stops++;
    }
  }
  assert.ok(gos > 0 && stops > 0, `both paths must be exercised: ${gos} through, ${stops} stopped`);
});

await t("it is not for search engines", async () => {
  const { metadata } = await import("@/app/open/page");
  assert.deepEqual((metadata as any).robots, { index: false, follow: false });
});

console.log("\n%d checks passed", passed);
