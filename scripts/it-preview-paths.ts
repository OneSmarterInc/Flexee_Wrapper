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

// ------------------------------------------------- the collapse, and the two named requirements

console.log("The launch path");

const { createSection, enrolAs } = await import("@/lib/roster");
const { prepareLaunch, addSimToClass, removeSimFromClass } = await import("@/lib/sims");
const { startPreview, resetPreview, previewState, previewHolders, PREVIEW_DAYS, daysLeft, stateOf } =
  await import("@/lib/previews");
process.env.LAUNCH_SECRET = "test-launch-secret";

const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
/** A faculty member with their own class, so each check starts from a clean standing. */
async function faculty(name: string, email: string) {
  const u = await account(name, email);
  const sec = await createSection(u.id, "sad", `Class of ${name}`, "2027 Spring", { teach: true });
  return { user: u, section: sec };
}
const expire = (userId: string, simId: string) =>
  db().update(simPreviews).set({ expiresAt: new Date(Date.now() - 1000) })
    .where(and(eq(simPreviews.simId, simId), eq(simPreviews.userId, userId)));

await t("the loose path is gone: a published sim nobody adopted no longer just opens", async () => {
  // This is the removal. Before the collapse this launched as faculty_preview, indefinitely.
  const f = await faculty("Browser", "browser@flexee.org");
  const r = await prepareLaunch(f.user.id, PUBLISHED, f.section.id);
  assert.equal(r.ok, false, "a published sim they have not adopted must not simply open");
  assert.match(r.ok === false ? r.error : "", /Start a preview|add it to one of your classes/);
  // And no launch was recorded for a run that did not happen.
  const launches = await db().select().from(schema.simLaunches)
    .where(eq(schema.simLaunches.userId, f.user.id));
  assert.equal(launches.length, 0);
});

await t("a live preview opens it, as faculty_preview", async () => {
  const f = await faculty("Trialist", "trialist@flexee.org");
  const started = await startPreview(f.user.id, PUBLISHED);
  assert.ok(started.ok, "ok" in started ? "" : (started as any).error);
  const r = await prepareLaunch(f.user.id, PUBLISHED, f.section.id);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  const { verifyPass } = await import("@/lib/launchpass");
  const p = verifyPass(decodeURIComponent(new URL((r as any).url).hash.replace(/^#lt=/, "")))!;
  assert.equal(p.role, "faculty_preview");
});

await t("a second start_preview REFUSES — it does not succeed quietly", async () => {
  // The requirement named first. The old platform used ON CONFLICT DO NOTHING here, which returns
  // success, leaves the clock alone, and tells nobody the preview was already spent. Driven through
  // startPreview rather than the table, so a silent no-op cannot pass as a pass.
  const f = await faculty("Twice", "twice@flexee.org");
  const first = await startPreview(f.user.id, PUBLISHED);
  assert.ok(first.ok);
  const firstExpiry = (first as any).expiresAt.getTime();

  const second = await startPreview(f.user.id, PUBLISHED);
  assert.equal(second.ok, false, "a second start must be refused");
  assert.equal(second.ok === false ? second.because : "", "already-live");
  assert.match(second.ok === false ? second.error : "", /already running/);

  // The clock was not extended, and there is still exactly one row.
  const after = await previewState(f.user.id, PUBLISHED);
  assert.equal(after.kind, "live");
  assert.equal((after as any).expiresAt.getTime(), firstExpiry, "the clock must not be extended");
  const rows = await db().select().from(simPreviews)
    .where(and(eq(simPreviews.simId, PUBLISHED), eq(simPreviews.userId, f.user.id)));
  assert.equal(rows.length, 1);
});

await t("and a start after it has expired refuses too, which is what 'ever' means", async () => {
  // The harder half: an expired row must still occupy the slot, or "one per sim ever" is only "one
  // at a time". A table-level test cannot tell the difference — the insert fails either way — so
  // this goes through the action and checks the reason it gives.
  const f = await faculty("Spent", "spent@flexee.org");
  assert.ok((await startPreview(f.user.id, PUBLISHED)).ok);
  await expire(f.user.id, PUBLISHED);
  assert.equal((await previewState(f.user.id, PUBLISHED)).kind, "ended");

  const again = await startPreview(f.user.id, PUBLISHED);
  assert.equal(again.ok, false, "an expired preview must not be restartable");
  assert.equal(again.ok === false ? again.because : "", "already-used");
  assert.match(again.ok === false ? again.error : "", /already used your preview/);
  // Still one row, still expired: nothing was quietly refreshed.
  const [row] = await db().select().from(simPreviews)
    .where(and(eq(simPreviews.simId, PUBLISHED), eq(simPreviews.userId, f.user.id)));
  assert.ok(row.expiresAt!.getTime() < Date.now());
});

await t("an expired preview refuses the launch, and says the seven days are up", async () => {
  const f = await faculty("Ended", "ended@flexee.org");
  assert.ok((await startPreview(f.user.id, PUBLISHED)).ok);
  await expire(f.user.id, PUBLISHED);
  const r = await prepareLaunch(f.user.id, PUBLISHED, f.section.id);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /preview has ended|seven days are up/i);
});

await t("ADOPTING the sim after the preview expired restores access", async () => {
  // The requirement named second, and mitigation 3. A faculty member who has since added the
  // simulation to a class must not be locked out by a clock that ran down in the meantime: the
  // class is the entitlement at that point. Tested as a sequence, because the order is the point.
  const f = await faculty("Adopter", "adopter@flexee.org");
  assert.ok((await startPreview(f.user.id, PUBLISHED)).ok);
  assert.ok((await prepareLaunch(f.user.id, PUBLISHED, f.section.id)).ok, "open while the trial runs");

  await expire(f.user.id, PUBLISHED);
  assert.equal((await prepareLaunch(f.user.id, PUBLISHED, f.section.id)).ok, false, "shut when it ends");

  assert.ok((await addSimToClass(f.user.id, f.section.id, PUBLISHED)).ok, "now adopt it");
  const r = await prepareLaunch(f.user.id, PUBLISHED, f.section.id);
  assert.ok(r.ok, r.ok === false ? r.error : "adopting must restore access");
  const { verifyPass } = await import("@/lib/launchpass");
  const p = verifyPass(decodeURIComponent(new URL((r as any).url).hash.replace(/^#lt=/, "")))!;
  assert.equal(p.role, "faculty", "and as faculty, not as a preview: the class is the entitlement");

  // The expired row is untouched by adoption — it is not quietly revived — so removing the sim
  // again returns them to the refusal rather than to a working preview.
  const [row] = await db().select().from(simPreviews)
    .where(and(eq(simPreviews.simId, PUBLISHED), eq(simPreviews.userId, f.user.id)));
  assert.ok(row.expiresAt!.getTime() < Date.now(), "adoption does not reset the clock");
  assert.ok((await removeSimFromClass(f.user.id, f.section.id, PUBLISHED)).ok);
  assert.equal((await prepareLaunch(f.user.id, PUBLISHED, f.section.id)).ok, false);
});

await t("adopted but not yet published stays unlimited, by decision", async () => {
  // Approved explicitly: this is how a new sim is reviewed before release, and it has no clock.
  const f = await faculty("Reviewer", "reviewer@flexee.org");
  assert.ok((await grantPreview(admin.id, UNPUBLISHED, f.user.id)).ok, "visible to them at all");
  assert.ok((await addSimToClass(f.user.id, f.section.id, UNPUBLISHED)).ok);
  const r = await prepareLaunch(f.user.id, UNPUBLISHED, f.section.id);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  const { verifyPass } = await import("@/lib/launchpass");
  assert.equal(verifyPass(decodeURIComponent(new URL((r as any).url).hash.replace(/^#lt=/, "")))!.role,
               "faculty_preview", "unpublished, so still a preview role");
  assert.equal((await previewState(f.user.id, UNPUBLISHED)).kind, "granted", "and no clock on it");
});

await t("an administrator's grant is untouched by the collapse, with or without a class", async () => {
  const f = await faculty("Granted", "granted@flexee.org");
  assert.ok((await grantPreview(admin.id, UNPUBLISHED, f.user.id)).ok);
  assert.equal((await previewState(f.user.id, UNPUBLISHED)).kind, "granted");
  const r = await prepareLaunch(f.user.id, UNPUBLISHED, f.section.id);
  assert.ok(r.ok, r.ok === false ? r.error : "a permanent grant must still open it");
});

await t("a trial cannot be started on an unpublished sim: that needs an administrator", async () => {
  // The reason the grant path cannot be deleted. An unpublished sim is not in visibleSims at all,
  // so a trial could never reach it.
  const f = await faculty("Early", "early@flexee.org");
  const r = await startPreview(f.user.id, UNPUBLISHED);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false ? r.because : "", "unpublished");
  assert.equal((await startPreview(f.user.id, "no-such-sim")).ok, false);
});

await t("starting a trial on something you already hold a grant for is refused, not downgraded", async () => {
  const f = await faculty("Both", "both@flexee.org");
  assert.ok((await grantPreview(admin.id, PUBLISHED, f.user.id)).ok);
  const r = await startPreview(f.user.id, PUBLISHED);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false ? r.because : "", "granted");
  // The permanent grant survived: a refused trial must not have written an expiry over it.
  assert.equal((await previewState(f.user.id, PUBLISHED)).kind, "granted");
});

await t("mitigation 4: an administrator resets a trial, and it is recorded", async () => {
  const f = await faculty("Reset Me", "resetme@flexee.org");
  assert.ok((await startPreview(f.user.id, PUBLISHED)).ok);
  await expire(f.user.id, PUBLISHED);
  assert.equal((await prepareLaunch(f.user.id, PUBLISHED, f.section.id)).ok, false);

  const r = await resetPreview(admin.id, PUBLISHED, f.user.id);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  assert.equal((await previewState(f.user.id, PUBLISHED)).kind, "live");
  assert.ok((await prepareLaunch(f.user.id, PUBLISHED, f.section.id)).ok, "access comes back");

  const [row] = await db().select().from(simPreviews)
    .where(and(eq(simPreviews.simId, PUBLISHED), eq(simPreviews.userId, f.user.id)));
  assert.ok(row.resetAt, "the reset is recorded, so 'once ever' stays answerable");
  assert.equal(row.resetBy, admin.id, "and by whom");
});

await t("only an administrator resets, and only a trial", async () => {
  const f = await faculty("Guarded", "guardedprev@flexee.org");
  assert.ok((await startPreview(f.user.id, PUBLISHED)).ok);
  const byFaculty = await resetPreview(f.user.id, PUBLISHED, f.user.id);
  assert.equal(byFaculty.ok, false);
  assert.match(byFaculty.ok === false ? byFaculty.error : "", /Only administrators/);

  // A permanent grant has no expiry, so there is nothing to reset and saying so beats pretending.
  const g = await faculty("Permanent", "permanent@flexee.org");
  assert.ok((await grantPreview(admin.id, UNPUBLISHED, g.user.id)).ok);
  const onGrant = await resetPreview(admin.id, UNPUBLISHED, g.user.id);
  assert.equal(onGrant.ok, false);
  assert.match(onGrant.ok === false ? onGrant.error : "", /does not expire/);

  // Nobody's preview at all.
  const none = await resetPreview(admin.id, PUBLISHED, g.user.id);
  assert.equal(none.ok, false);
  assert.match(none.ok === false ? none.error : "", /no preview/);
});

await t("mitigation 1: the clock is a whole number of days, rounded up", async () => {
  // So the last few hours read as "1 day left" rather than "0 days left" beside a working link.
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(daysLeft(new Date("2026-10-15T12:00:00Z"), now), 7);
  assert.equal(daysLeft(new Date("2026-10-09T00:30:00Z"), now), 1, "half a day still reads as one");
  assert.equal(daysLeft(new Date("2026-10-08T12:00:01Z"), now), 1, "and a second is one, not zero");
  assert.equal(daysLeft(new Date("2026-10-08T11:00:00Z"), now), 0, "past is zero, never negative");
  assert.equal(stateOf({ expiresAt: new Date("2026-10-15T12:00:00Z"), grantedBy: null }, now).kind, "live");
  assert.equal(stateOf({ expiresAt: new Date("2026-10-01T12:00:00Z"), grantedBy: null }, now).kind, "ended");
  assert.equal(stateOf({ expiresAt: null, grantedBy: admin.id }, now).kind, "granted");
  assert.equal(stateOf(undefined, now).kind, "none");
});

await t("mitigation 1: the page is given the clock, and mitigation 2 confirms before spending it", async () => {
  // Rendered in test:a11y-pages; what is asserted here is that the page reads the state and that
  // the first click cannot start a preview — the start action is reachable only from the confirm
  // step, because there is no second chance for the person who mis-clicks.
  const page = readFileSync("src/app/teach/[section]/sims/page.tsx", "utf8");
  assert.ok(page.includes("previewStates"), "the page must read the clock");
  assert.ok(page.includes("days left") || page.includes("day${"), "and show it");
  assert.ok(page.includes("sp.preview === a.id"), "the confirm step is keyed to one sim");
  // The start form appears only inside the confirming branch.
  const confirmBlock = page.slice(page.indexOf("confirming ? ("), page.indexOf("Cancel"));
  assert.ok(confirmBlock.includes("startPreviewAction"), "the action belongs to the confirm step");
  assert.ok(confirmBlock.includes("your only preview"), "and it says what it costs");
  // Matched as a form binding, not as an identifier. A bare search for "startPreviewAction" finds
  // the import at the top of the file, which is before the confirm step and always will be — the
  // third time in this work that a source check matched a mention instead of a use.
  const beforeConfirm = page.slice(0, page.indexOf("confirming ? ("));
  assert.ok(!beforeConfirm.includes("action={startPreviewAction}"),
    "no form may post to startPreviewAction before the confirmation");
  assert.equal((page.match(/action=\{startPreviewAction\}/g) ?? []).length, 1,
    "exactly one form starts a preview, and it is the confirmed one");
});

await t("mitigation 4: the admin page lists holders and confirms before resetting", async () => {
  const page = readFileSync("src/app/admin/sims/page.tsx", "utf8");
  assert.ok(page.includes("previewHolders"), "it must list who holds one");
  assert.ok(page.includes("sp.reset ==="), "with a confirm step keyed to the person and sim");
  const confirmBlock = page.slice(page.indexOf("confirming ? ("), page.indexOf("Cancel"));
  assert.ok(confirmBlock.includes("resetPreviewAction"));
  assert.ok(!page.slice(0, page.indexOf("confirming ? (")).includes("action={resetPreviewAction}"),
    "no form may post to resetPreviewAction before the confirmation");
  assert.equal((page.match(/action=\{resetPreviewAction\}/g) ?? []).length, 1,
    "exactly one form resets a preview");

  // And it really reports the people.
  const f = await faculty("Listed", "listed@flexee.org");
  assert.ok((await startPreview(f.user.id, PUBLISHED)).ok);
  const list = await previewHolders(PUBLISHED);
  const mine = list.find((h) => h.userId === f.user.id)!;
  assert.ok(mine, "the holder is listed");
  assert.equal(mine.email, "listed@flexee.org", "by the same identifier the grant form takes");
  assert.equal(mine.state.kind, "live");
});

await t("a student is unaffected by any of this", async () => {
  // The collapse is in the instructor branch only. A student's launch is governed by enrolment,
  // attachment, publication and release, and a preview row of theirs must change nothing.
  const stu = await account("Student", "student@wright.edu");
  await enrolAs(cls.id, stu.id, "student");
  await addSimToClass(prof.id, cls.id, PUBLISHED);
  const before = await prepareLaunch(stu.id, PUBLISHED, cls.id);
  assert.equal(before.ok, false, "unreleased, so refused");
  assert.match(before.ok === false ? before.error : "", /Waiting on your instructor/);

  // Even holding a preview row, which should be irrelevant to a student.
  await db().insert(simPreviews).values({ simId: PUBLISHED, userId: stu.id, expiresAt: new Date(Date.now() + 86400000) });
  const after = await prepareLaunch(stu.id, PUBLISHED, cls.id);
  assert.equal(after.ok, false);
  assert.match(after.ok === false ? after.error : "", /Waiting on your instructor/,
    "a preview must not become a side door into a class");
});

console.log("\n%d checks passed", passed);
