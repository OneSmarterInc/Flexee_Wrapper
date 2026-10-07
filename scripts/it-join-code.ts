// Integration test: Spec 27 B1 decision 2 — joining with the class code is a per-class switch.
//
// This is the one commit in B1 that takes something away. Before it, any student could type any
// class's code on their own dashboard and enrol themselves; now every class refuses by default.
// So most of what is checked here is that the refusal is distinguishable from a wrong code, that
// turning the switch on and off never changes the code itself, and that nothing else about
// enrolment moved.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, enrollByCode, setJoinCodeEnabled, sectionRoster } from "@/lib/roster";
import { withdrawStudents } from "@/lib/withdraw";

const { users, identities, sections, enrolments } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const prof = await account("Prof", "prof@flexee.org");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });

await t("a new class does not accept its code, which is the change", async () => {
  const [row] = await db().select().from(sections).where(eq(sections.id, cls.id));
  assert.equal(row.joinCodeEnabled, false, "decision 2: off for every class");
  assert.ok(row.joinCode, "but the code still exists");

  const u = await account("Hopeful", "hopeful@wright.edu");
  const r = await enrollByCode(u.id, cls.joinCode!);
  assert.ok(r && "refused" in r, "a correct code for a closed class is refused, not accepted");
  // and nothing was created by trying
  const rows = await db().select().from(enrolments).where(eq(enrolments.userId, u.id));
  assert.equal(rows.length, 0, "a refused join must not leave an enrolment");
});

await t("a refusal is told apart from a code that does not exist", async () => {
  // The distinction that matters to a student: one means "look again", the other means "ask your
  // instructor". A single shared message would send someone hunting for a typo that is not there.
  const u = await account("Two Ways", "twoways@wright.edu");
  const refused = await enrollByCode(u.id, cls.joinCode!);
  const missing = await enrollByCode(u.id, "ZZZZZZ");
  assert.ok(refused && "refused" in refused);
  assert.equal(missing, null, "no such code is null, not a refusal");
});

await t("the exact refusal a student is shown", async () => {
  // Read out of the action, so the wording cannot drift from what was agreed.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/app/actions.ts", "utf8");
  assert.ok(src.includes("This class isn't accepting students who join with a code. Ask your instructor to add you."),
    "the agreed sentence is not in enrollByCodeAction");
  // and the two outcomes do not share one message
  assert.ok(src.includes("No class found for that code."));
});

await t("with the switch on, joining works exactly as it did before", async () => {
  await setJoinCodeEnabled(cls.id, true);
  const u = await account("Joiner", "joiner@wright.edu");
  const r = await enrollByCode(u.id, cls.joinCode!);
  assert.ok(r && !("refused" in r), "an accepted join returns the class");
  assert.equal((r as { id: string }).id, cls.id);
  assert.equal((r as { withdrawn: boolean }).withdrawn, false);
  const roster = await sectionRoster(cls.id);
  const row = roster.find((x) => x.userId === u.id)!;
  assert.ok(row, "the student is on the roster");
  assert.equal(row.role, "student");
  // Spec 27 B1: and they are not released, so joining does not grant simulation access
  assert.equal(row.releasedAt, null);
});

await t("the code is case-insensitive and tolerates surrounding space, as before", async () => {
  const u = await account("Sloppy", "sloppy@wright.edu");
  const r = await enrollByCode(u.id, `  ${cls.joinCode!.toLowerCase()} `);
  assert.ok(r && !("refused" in r));
});

await t("turning the switch off and on again never changes the code", async () => {
  // A code may be printed on a slide from last term. Regenerating it here would strand that slide,
  // which is why the switch and the code are separate things.
  const before = (await db().select().from(sections).where(eq(sections.id, cls.id)))[0].joinCode;
  await setJoinCodeEnabled(cls.id, false);
  await setJoinCodeEnabled(cls.id, true);
  await setJoinCodeEnabled(cls.id, false);
  const after = (await db().select().from(sections).where(eq(sections.id, cls.id)))[0].joinCode;
  assert.equal(after, before);
  // off really is off again
  const u = await account("After Off", "afteroff@wright.edu");
  assert.ok((await enrollByCode(u.id, before!)) as any);
  assert.ok("refused" in (await enrollByCode(u.id, before!) as any));
});

await t("a withdrawal still survives a re-join when the switch is on", async () => {
  // Spec 19 decision 3, re-checked here because decision 2 put a new branch in front of it: the
  // early return for a closed class must not have moved the withdrawal behaviour.
  await setJoinCodeEnabled(cls.id, true);
  const u = await account("Gone", "gone@wright.edu");
  await enrollByCode(u.id, cls.joinCode!);
  const [e] = await db().select().from(enrolments).where(eq(enrolments.userId, u.id));
  await withdrawStudents(prof.id, cls.id, [e.id]);

  const again = await enrollByCode(u.id, cls.joinCode!);
  assert.ok(again && !("refused" in again));
  assert.equal((again as { withdrawn: boolean }).withdrawn, true, "and it reports the withdrawal");
  const [still] = await db().select().from(enrolments).where(eq(enrolments.id, e.id));
  assert.ok(still.withdrawnAt, "still withdrawn");
});

await t("one class's switch does not affect another's", async () => {
  const open = await createSection(prof.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
  await setJoinCodeEnabled(open.id, true);
  await setJoinCodeEnabled(cls.id, false);
  const u = await account("Across", "across@wright.edu");
  assert.ok("refused" in (await enrollByCode(u.id, cls.joinCode!) as any), "the closed one refuses");
  const r = await enrollByCode(u.id, open.joinCode!);
  assert.ok(r && !("refused" in r), "the open one accepts");
});

await t("only the class's own faculty can move the switch", async () => {
  // The action checks ownedSection before calling the library, which is where the guard belongs:
  // setJoinCodeEnabled itself is a writer, not a gate, so this asserts the gate is in the caller.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/app/actions.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function setJoinCodeEnabledAction"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes("ownedSection"), "the action must check ownedSection");
  assert.ok(body.includes('redirect("/teach")'), "and send a stranger away");
  assert.ok(body.indexOf("ownedSection") < body.indexOf("setJoinCodeEnabled("),
    "the check has to come before the write");
});

console.log("\n%d checks passed", passed);
