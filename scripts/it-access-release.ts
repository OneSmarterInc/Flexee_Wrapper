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
import { createSection, enrolAs } from "@/lib/roster";

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

console.log("\n%d checks passed", passed);
