// Integration test: Spec 27 B1 — access release (migration 0025 and the columns it adds).
//
// Every suite applies drizzle/*.sql to a fresh PGlite database, so a syntax error in 0025 fails
// all of them. What that does *not* test is the backfill, because the table is empty when the
// migration runs. It is tested here by reading the shipped statement out of the file and running
// it against rows that look like the live ones — and it is worth testing precisely because it can
// never be corrected: drizzle selects migrations by the journal's timestamp and never re-compares
// the recorded hash, so editing 0025 after it has run is silently ignored.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, enrolAs, setAccessRelease, waitingOnRelease } from "@/lib/roster";
import { addSimToClass, adminUpdateSim, prepareLaunch } from "@/lib/sims";
import { setAdminByEmail } from "@/lib/admin";
import { withdrawStudents, restoreStudents } from "@/lib/withdraw";

const { users, identities, enrolments } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const MIGRATION = "drizzle/0025_enrolment_access_release.sql";
const source = readFileSync(MIGRATION, "utf8");

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const prof = await account("Prof", "prof@flexee.org");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });

await t("the three columns exist, and a new enrolment is not released", async () => {
  const ann = await account("Ann", "ann@wright.edu");
  await enrolAs(cls.id, ann.id, "student");
  const [e] = await db().select().from(enrolments).where(eq(enrolments.userId, ann.id));
  assert.equal(e.releasedAt, null, "decision 1: a new enrolment starts unreleased");
  assert.equal(e.releasedBy, null);
  assert.equal(e.releasedNote, null);
  // and the enrolment itself is unaffected: release gates sim launches, not membership
  assert.equal(e.role, "student");
  assert.equal(e.withdrawnAt, null);
});

await t("the migration is additive: it adds columns, an index and a key, and drops nothing", () => {
  // Read from the file rather than described, so this check cannot drift from what ships.
  for (const wanted of ['ADD COLUMN "released_at"', 'ADD COLUMN "released_by"',
                        'ADD COLUMN "released_note"',
                        'CREATE INDEX "enrolments_section_released_idx"',
                        'ADD CONSTRAINT "enrolments_released_by_users_id_fk"']) {
    assert.ok(source.includes(wanted), `0025 should ${wanted}`);
  }
  for (const forbidden of ["DROP COLUMN", "DROP TABLE", "SET NOT NULL", "ALTER COLUMN", "DELETE FROM", "TRUNCATE"]) {
    assert.ok(!source.toUpperCase().includes(forbidden), `0025 must not ${forbidden}`);
  }
  // Exactly one statement writes data, and it is an UPDATE of this one table.
  const writes = source.match(/^\s*(UPDATE|INSERT|DELETE)\b/gim) ?? [];
  assert.equal(writes.length, 1, `expected one data write, found ${writes.length}`);
  assert.match(source, /UPDATE "enrolments"/);
});

await t("it says in the file that a correction must be a new migration", () => {
  // The one operational fact about this file that nobody can recover by reading the SQL.
  assert.match(source, /MUST BE A NEW MIGRATION, NEVER AN EDIT/);
});

await t("the shipped backfill releases every row that existed, dated to its own enrolment", async () => {
  // Three rows standing in for the live ones, all unreleased, with distinct creation times so a
  // backfill that used now() instead of created_at would be caught.
  const made: { id: string; createdAt: Date }[] = [];
  for (let i = 0; i < 3; i++) {
    const u = await account(`Old ${i}`, `old${i}@wright.edu`);
    await enrolAs(cls.id, u.id, "student");
    const when = new Date(Date.UTC(2026, 0, 2 + i, 9, 30));
    const [row] = await db().update(enrolments)
      .set({ createdAt: when, releasedAt: null, releasedBy: null, releasedNote: null })
      .where(eq(enrolments.userId, u.id)).returning();
    made.push({ id: row.id, createdAt: when });
  }
  const before = await db().select().from(enrolments).where(isNull(enrolments.releasedAt));
  assert.ok(before.length >= 3, "the fixture should start unreleased");

  // The actual statement that will run on the live database, taken from the file. Everything
  // before the UPDATE is DDL the test database already applied.
  const update = source.slice(source.indexOf('UPDATE "enrolments"'));
  assert.ok(update.includes("released_at") && update.includes("created_at"), update.slice(0, 120));
  await db().execute(sql.raw(update));

  for (const m of made) {
    const [row] = await db().select().from(enrolments).where(eq(enrolments.id, m.id));
    assert.ok(row.releasedAt, "every pre-existing row must end up released");
    assert.equal(row.releasedAt!.getTime(), m.createdAt.getTime(),
      "released_at must be the row's own created_at, not now()");
    assert.equal(row.releasedBy, null, "nobody performed this release, so released_by stays null");
    assert.match(row.releasedNote ?? "", /migration 0025/);
  }
  const after = await db().select().from(enrolments).where(isNull(enrolments.releasedAt));
  assert.equal(after.length, 0, "the backfill must leave no row unreleased");
});

await t("and it is idempotent, so a re-run cannot re-date an already-released row", async () => {
  // Not relied on by the deploy — drizzle runs it once — but a statement guarded by
  // "WHERE released_at IS NULL" should be safe to run twice, and if it were not, the guard would
  // be missing and a later hand-run would overwrite real release dates.
  const marker = new Date(Date.UTC(2026, 5, 1, 12, 0));
  const u = await account("Released", "released@wright.edu");
  await enrolAs(cls.id, u.id, "student");
  await db().update(enrolments)
    .set({ releasedAt: marker, releasedBy: prof.id, releasedNote: "dept PO 4471" })
    .where(eq(enrolments.userId, u.id));

  await db().execute(sql.raw(source.slice(source.indexOf('UPDATE "enrolments"'))));

  const [row] = await db().select().from(enrolments).where(eq(enrolments.userId, u.id));
  assert.equal(row.releasedAt!.getTime(), marker.getTime(), "a real release date was overwritten");
  assert.equal(row.releasedBy, prof.id, "a real releaser was overwritten");
  assert.equal(row.releasedNote, "dept PO 4471", "a faculty note was overwritten");
});

await t("the journal lists 0025 once, after 0024, with a later timestamp", () => {
  // drizzle applies a migration only when its journal `when` exceeds the newest applied row's, so
  // an out-of-order or duplicate entry means the file silently never runs.
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const tags = journal.entries.map((e: any) => e.tag);
  assert.equal(tags.filter((x: string) => x === "0025_enrolment_access_release").length, 1);
  const i = tags.indexOf("0025_enrolment_access_release");
  assert.equal(tags[i - 1], "0024_dismissed_uploads");
  const whens = journal.entries.map((e: any) => e.when);
  assert.ok(whens.every((w: number, n: number) => n === 0 || w > whens[n - 1]),
    "journal timestamps must be strictly increasing");
});

// ------------------------------------------------------------- the launch gate (commit 4)

console.log("The launch gate");

const SIM = "rapid-01-disaster";
// A successful launch signs a pass, which needs a secret. The pass itself is test:launch-pass's
// subject; here it only has to be mintable so that "the gate let them through" is reachable.
process.env.LAUNCH_SECRET = "test-launch-secret";
const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");
await db().insert(schema.sims).values({ id: SIM, number: 1, title: "Disaster or Breach?", launchUrl: "https://sim01.example.app" });
await adminUpdateSim(admin.id, SIM, { published: true });
await addSimToClass(prof.id, cls.id, SIM);

/** A fresh student of this class, unreleased, with their enrolment row. */
async function newStudent(name: string, email: string, opts: { demo?: boolean } = {}) {
  const u = await account(name, email);
  await enrolAs(cls.id, u.id, "student", { isDemo: opts.demo });
  const [e] = await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, cls.id), eq(enrolments.userId, u.id)));
  return { user: u, enr: e };
}

await t("an unreleased student cannot launch, and is told to wait on their instructor", async () => {
  const s = await newStudent("Unreleased", "unreleased@wright.edu");
  assert.equal(s.enr.releasedAt, null);
  const r = await prepareLaunch(s.user.id, SIM, cls.id);
  assert.equal(r.ok, false);
  const error = r.ok === false ? r.error : "";
  // The old platform's wording, as Addendum B §1 requires.
  assert.equal(error, "Waiting on your instructor — Your enrolment is confirmed, but access to this simulation hasn't been released yet.");
  assert.equal(r.ok === false ? r.status : 0, 403);
  // and nothing is recorded: a refused launch is not a launch
  const launches = await db().select().from(schema.simLaunches).where(eq(schema.simLaunches.userId, s.user.id));
  assert.equal(launches.length, 0);
});

await t("releasing them lets them in, and records who did it and the note", async () => {
  const s = await newStudent("Released Later", "later@wright.edu");
  const r = await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [s.enr.id], note: "dept PO 4471" });
  assert.ok(r.ok && r.changed === 1, JSON.stringify(r));
  const [e] = await db().select().from(enrolments).where(eq(enrolments.id, s.enr.id));
  assert.ok(e.releasedAt, "released_at should be set");
  assert.equal(e.releasedBy, prof.id, "and by whom");
  assert.equal(e.releasedNote, "dept PO 4471");
  assert.ok((await prepareLaunch(s.user.id, SIM, cls.id)).ok);
});

await t("un-releasing shuts the door again, and keeps the paperwork", async () => {
  const s = await newStudent("On And Off", "onoff@wright.edu");
  await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [s.enr.id], note: "PO 9 pending" });
  assert.ok((await prepareLaunch(s.user.id, SIM, cls.id)).ok);

  await setAccessRelease(prof.id, cls.id, { released: false, enrolmentIds: [s.enr.id] });
  const [e] = await db().select().from(enrolments).where(eq(enrolments.id, s.enr.id));
  assert.equal(e.releasedAt, null);
  assert.equal(e.releasedBy, null, "the act is cleared");
  assert.equal(e.releasedNote, "PO 9 pending", "the note is not: a purchase order is still a fact");
  assert.equal((await prepareLaunch(s.user.id, SIM, cls.id)).ok, false);
});

await t("the Demo Student is never gated, released or not", async () => {
  // Decision 3. It is the enrolment faculty sign into to see the student view, so gating it would
  // mean nobody could check a simulation works before releasing a single student.
  const d = await newStudent("Demo Student", "demo@wright.edu", { demo: true });
  assert.equal(d.enr.isDemo, true);
  assert.equal(d.enr.releasedAt, null, "and it is not released in the data either");
  assert.ok((await prepareLaunch(d.user.id, SIM, cls.id)).ok, "a demo must launch unreleased");
  // The rule is read at launch, not stored, so no import or roster path can set it wrongly.
  assert.ok(!(await db().select().from(enrolments).where(eq(enrolments.id, d.enr.id)))[0].releasedAt);
});

await t("faculty are never checked, with or without a release record", async () => {
  // Asserted on the gate, not on the data. An earlier check in this suite runs 0025's backfill,
  // which releases *every* row including instructors — correctly, since it has no role filter and
  // nothing reads an instructor's release. So the instructor's row is explicitly cleared here and
  // the launch re-tried: that is the property, and it does not depend on what ran before.
  await db().update(enrolments).set({ releasedAt: null, releasedBy: null })
    .where(and(eq(enrolments.sectionId, cls.id), eq(enrolments.userId, prof.id)));
  const [e] = await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, cls.id), eq(enrolments.userId, prof.id)));
  assert.equal(e.releasedAt, null, "the instructor's row is unreleased");
  assert.equal(e.role, "instructor");
  const r = await prepareLaunch(prof.id, SIM, cls.id);
  assert.ok(r.ok, r.ok === false ? r.error : "an instructor must launch without a release");
});

await t("'not open in your class' still wins over 'waiting on your instructor'", async () => {
  // Order matters for the reader: a student whose class has not added the sim must not be told to
  // wait for a release that would not help them.
  const other = await createSection(prof.id, "sad", "MIS 3250-09", "2027 Spring", { teach: true });
  const u = await account("Elsewhere", "elsewhere@wright.edu");
  await enrolAs(other.id, u.id, "student");
  const r = await prepareLaunch(u.id, SIM, other.id);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /not open in your class/);
});

await t("'Release all' releases the active students and skips the withdrawn", async () => {
  const sec = await createSection(prof.id, "sad", "MIS 3250-07", "2027 Spring", { teach: true });
  await addSimToClass(prof.id, sec.id, SIM);
  const made = [];
  for (const n of ["A", "B", "C"]) {
    const u = await account(`Bulk ${n}`, `bulk${n}@wright.edu`);
    await enrolAs(sec.id, u.id, "student");
    const [e] = await db().select().from(enrolments)
      .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, u.id)));
    made.push({ user: u, enr: e });
  }
  await withdrawStudents(prof.id, sec.id, [made[2].enr.id]);

  assert.equal(await waitingOnRelease(sec.id), 2, "the withdrawn student is not 'waiting'");
  const r = await setAccessRelease(prof.id, sec.id, { released: true, all: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ok && r.changed, 2);
  assert.equal(r.ok && r.skippedWithdrawn, 1, "and it says how many it skipped");
  assert.equal(await waitingOnRelease(sec.id), 0);

  const [third] = await db().select().from(enrolments).where(eq(enrolments.id, made[2].enr.id));
  assert.equal(third.releasedAt, null, "Release all must not release a withdrawn student");
  // Restoring them does not quietly hand them access nobody released.
  await restoreStudents(prof.id, sec.id, [made[2].enr.id]);
  assert.equal((await prepareLaunch(made[2].user.id, SIM, sec.id)).ok, false);
  assert.equal(await waitingOnRelease(sec.id), 1, "restored, and now visibly waiting");
});

await t("a named withdrawn student is still released, because a tick means that row", async () => {
  const sec = await createSection(prof.id, "sad", "MIS 3250-08", "2027 Spring", { teach: true });
  const u = await account("Named", "named@wright.edu");
  await enrolAs(sec.id, u.id, "student");
  const [e] = await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, u.id)));
  await withdrawStudents(prof.id, sec.id, [e.id]);
  const r = await setAccessRelease(prof.id, sec.id, { released: true, enrolmentIds: [e.id] });
  assert.ok(r.ok && r.changed === 1, JSON.stringify(r));
  assert.ok((await db().select().from(enrolments).where(eq(enrolments.id, e.id)))[0].releasedAt);
  // Being withdrawn still refuses the launch: release is not the only gate.
  assert.equal((await prepareLaunch(u.id, SIM, sec.id)).ok, false);
});

await t("only this class's faculty or an administrator can release", async () => {
  const stranger = await account("Other Prof", "otherprof@flexee.org");
  const s = await newStudent("Guarded", "guarded@wright.edu");
  const r = await setAccessRelease(stranger.id, cls.id, { released: true, enrolmentIds: [s.enr.id] });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /faculty or an administrator/);
  assert.equal((await db().select().from(enrolments).where(eq(enrolments.id, s.enr.id)))[0].releasedAt, null);
  // An administrator can.
  assert.ok((await setAccessRelease(admin.id, cls.id, { released: true, enrolmentIds: [s.enr.id] })).ok);
});

await t("a student of another class cannot be released into this one", async () => {
  const sec = await createSection(prof.id, "sad", "MIS 3250-10", "2027 Spring", { teach: true });
  const u = await account("Foreign", "foreign@wright.edu");
  await enrolAs(sec.id, u.id, "student");
  const [e] = await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, u.id)));
  const r = await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [e.id] });
  assert.equal(r.ok, false, "an enrolment id from another class must not be accepted");
  assert.match(r.ok === false ? r.error : "", /not in this class/);
  assert.equal((await db().select().from(enrolments).where(eq(enrolments.id, e.id)))[0].releasedAt, null);
});

await t("an instructor enrolment is never touched by Release all, and never counted as waiting", async () => {
  const sec = await createSection(prof.id, "sad", "MIS 3250-11", "2027 Spring", { teach: true });
  const u = await account("Student One", "one@wright.edu");
  await enrolAs(sec.id, u.id, "student");
  assert.equal(await waitingOnRelease(sec.id), 1, "the instructor is not waiting on anything");
  const r = await setAccessRelease(prof.id, sec.id, { released: true, all: true });
  assert.equal(r.ok && r.changed, 1, "only the student");
  const [me] = await db().select().from(enrolments)
    .where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, prof.id)));
  assert.equal(me.releasedAt, null, "an instructor's row stays untouched");
});

await t("releasing nobody is refused rather than silently doing nothing", async () => {
  const r = await setAccessRelease(prof.id, cls.id, { released: true, enrolmentIds: [] });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /at least one student/);
});

console.log("\n%d checks passed", passed);
