// Integration test: Spec 27 B2 decision 3 — faculty previews, and migration 0027.
//
// This file starts as the migration's own suite and grows with the launch-path collapse. The two
// properties asked for by name are the ones most heavily covered, because each has a failure mode
// that looks like success: a second start_preview must *refuse* rather than quietly do nothing, and
// adopting a sim after its preview expired must restore access rather than stay locked out.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { grantPreview, visibleSims } from "@/lib/sims";
import { setAdminByEmail } from "@/lib/admin";

const { users, identities, simPreviews, sims } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const MIGRATION = "drizzle/0027_sim_preview_expiry.sql";
const source = readFileSync(MIGRATION, "utf8");

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");
const prof = await account("Pat Professor", "prof@flexee.org");

const PUBLISHED = "rapid-01-disaster";
const UNPUBLISHED = "rapid-11-draft";
await db().insert(sims).values([
  { id: PUBLISHED, number: 1, title: "Disaster or Breach?", launchUrl: "https://sim01.example.app", published: true },
  { id: UNPUBLISHED, number: 11, title: "Not Out Yet", launchUrl: "https://sim11.example.app", published: false },
]);

await t("the migration is additive: three nullable columns and a key, and it drops nothing", () => {
  for (const wanted of ['ADD COLUMN "expires_at"', 'ADD COLUMN "reset_at"', 'ADD COLUMN "reset_by"',
                        'ADD CONSTRAINT "sim_previews_reset_by_users_id_fk"']) {
    assert.ok(source.includes(wanted), `0027 should ${wanted}`);
  }
  for (const forbidden of ["DROP COLUMN", "DROP TABLE", "DROP INDEX", "SET NOT NULL", "DELETE FROM", "TRUNCATE"]) {
    assert.ok(!source.toUpperCase().includes(forbidden), `0027 must not ${forbidden}`);
  }
  // Unlike 0025, this one writes no data at all: every existing grant keeps its null expiry.
  const writes = source.match(/^\s*(UPDATE|INSERT|DELETE)\b/gim) ?? [];
  assert.equal(writes.length, 0, `0027 should write no data, found ${writes.length} statement(s)`);
});

await t("it says in the file that a correction must be a new migration", () => {
  assert.match(source, /must be a new migration, never an edit/);
});

await t("the journal lists 0027 once, after 0026, with a later timestamp", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const tags = journal.entries.map((e: any) => e.tag);
  assert.equal(tags.filter((x: string) => x === "0027_sim_preview_expiry").length, 1);
  assert.equal(tags[tags.indexOf("0027_sim_preview_expiry") - 1], "0026_class_join_code");
  const whens = journal.entries.map((e: any) => e.when);
  assert.ok(whens.every((w: number, i: number) => i === 0 || w > whens[i - 1]),
    "journal timestamps must be strictly increasing, or the file silently never runs");
});

await t("the three columns exist and start null, so an existing grant is unchanged", async () => {
  // The condition of the decision: nothing anyone holds today is shortened. An administrator's
  // grant is written by the same call as before, and comes out permanent.
  assert.ok((await grantPreview(admin.id, UNPUBLISHED, prof.id)).ok);
  const [row] = await db().select().from(simPreviews)
    .where(and(eq(simPreviews.simId, UNPUBLISHED), eq(simPreviews.userId, prof.id)));
  assert.equal(row.expiresAt, null, "null means permanent: an administrator's review grant");
  assert.equal(row.resetAt, null);
  assert.equal(row.resetBy, null);
  assert.equal(row.grantedBy, admin.id, "and who granted it is unchanged");
});

await t("null expiry still makes an unpublished sim visible, exactly as before", async () => {
  // visibleSims is the hinge for adoption as well as previews, and 0027 must not have touched it.
  assert.ok((await visibleSims(prof.id)).some((s) => s.id === UNPUBLISHED),
    "a granted unpublished sim stays visible");
  const other = await account("Other Prof", "other@flexee.org");
  assert.ok(!(await visibleSims(other.id)).some((s) => s.id === UNPUBLISHED),
    "and nobody else sees it");
  assert.ok((await visibleSims(other.id)).some((s) => s.id === PUBLISHED),
    "while a published sim is visible to everyone, which is what adoption depends on");
});

await t("the unique index is what makes 'once ever' possible, and it survived", async () => {
  // The row has to outlive its own expiry, or a second start would look like a first. Asserted on
  // the database rather than the schema file: a raw insert of a duplicate must fail.
  await assert.rejects(
    () => db().insert(simPreviews).values({ simId: UNPUBLISHED, userId: prof.id }),
    "a second row for the same person and sim must be impossible",
  );
  // Even when the first one has expired.
  await db().update(simPreviews).set({ expiresAt: new Date(Date.now() - 86400000) })
    .where(and(eq(simPreviews.simId, UNPUBLISHED), eq(simPreviews.userId, prof.id)));
  await assert.rejects(
    () => db().insert(simPreviews).values({ simId: UNPUBLISHED, userId: prof.id }),
    "an expired row still occupies the slot, which is the point",
  );
  await db().update(simPreviews).set({ expiresAt: null })
    .where(and(eq(simPreviews.simId, UNPUBLISHED), eq(simPreviews.userId, prof.id)));
});

await t("nothing reads the new columns yet: this commit is inert", () => {
  // The whole reason it ships alone. If a reader appears here before the next commit, the push
  // order stops protecting anything.
  for (const f of ["src/lib/sims.ts", "src/app/sim-actions.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!src.includes("expiresAt"), `${f} should not read expiresAt yet`);
    assert.ok(!src.includes("resetAt") && !src.includes("resetBy"), `${f} should not read the reset columns yet`);
  }
});

console.log("\n%d checks passed", passed);
