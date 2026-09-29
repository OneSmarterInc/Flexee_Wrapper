// Integration test: administrators, classes, faculty and students (migration 0012, lib/admin, lib/roster).
// Runs the real library code against an in-memory Postgres with every migration applied.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { isAdmin, setAdminByEmail, allClasses, removeInvite, parsePeople } from "@/lib/admin";
import { createSection, commitRoster, claimInvites, teachingSections, sectionRoster, pendingInvites } from "@/lib/roster";

const { users, identities, enrolments, rosterInvites, sections } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const roleOf = async (sectionId: string, userId: string) =>
  (await db().select({ r: enrolments.role }).from(enrolments).where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.userId, userId))))[0]?.r ?? null;

console.log("Migration 0012");
await t("classes that existed before the migration count as published; new columns default safely", async () => {
  const pg = new PGlite(); const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort();
  const run = async (f: string) => { for (const s of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s.trim()); };
  for (const f of files.filter((f) => f < "0012")) await run(f);
  await pg.exec(`insert into users (id, display_name) values ('u0','Old Prof');
                 insert into sections (id, book_id, name, join_code, created_by) values ('s0','sad','Old class','OLD001','u0');
                 insert into roster_invites (id, section_id, email) values ('i0','s0','old@x.edu');`);
  await run(files.find((f) => f.startsWith("0012"))!);
  const s = await pg.query<{ p: string | null }>(`select book_published_at as p from sections where id='s0'`);
  const u = await pg.query<{ r: string }>(`select system_role as r from users where id='u0'`);
  const i = await pg.query<{ r: string }>(`select role as r from roster_invites where id='i0'`);
  assert.ok(s.rows[0].p, "existing class published"); assert.equal(u.rows[0].r, "user"); assert.equal(i.rows[0].r, "student");
});

console.log("Administrators");
const vikram = await account("Vikram Sethi", "vikram@flexee.org");
const chuck = await account("Chuck Nemer", "chuck@flexee.org");
const sam = await account("Sam Student", "sam@wright.edu");
await t("nobody is an admin by default", async () => { assert.equal(await isAdmin(vikram.id), false); });
await t("an admin is made by sign-in email; an unknown email is refused", async () => {
  assert.equal(await setAdminByEmail("VIKRAM@flexee.org "), true);
  assert.equal(await isAdmin(vikram.id), true);
  assert.equal(await setAdminByEmail("nobody@flexee.org"), false);
  assert.equal(await isAdmin(null), false);
});

console.log("Classes");
const setup = await createSection(vikram.id, "sad", "MIS 3250, Section 01", "2027 Spring", { teach: false });
const mine = await createSection(vikram.id, "mis3000", "MIS 3000, Section 02", "2027 Spring", { teach: true });
await t("an admin can create a class without teaching it", async () => {
  assert.equal(await roleOf(setup.id, vikram.id), null);
  assert.ok(setup.joinCode);
  assert.equal(setup.bookPublishedAt, null, "a new class's book starts hidden from students");
});
await t("…or create one and teach it", async () => { assert.equal(await roleOf(mine.id, vikram.id), "instructor"); });

console.log("Adding faculty and students");
await t("faculty with an account join at once as instructors; unknown faculty get an instructor invite", async () => {
  const r = await commitRoster(setup.id, parsePeople("chuck@flexee.org, Chuck Nemer\nnew.prof@flexee.org, New Prof"), "instructor");
  assert.deepEqual(r, { enrolled: 1, invited: 1 });
  assert.equal(await roleOf(setup.id, chuck.id), "instructor");
  const inv = await pendingInvites(setup.id);
  assert.equal(inv.find((i) => i.email === "new.prof@flexee.org")?.role, "instructor");
});
await t("a class list: header row, blanks, junk and duplicates are skipped; names are kept", async () => {
  const rows = parsePeople("email,name\nsam@wright.edu, Sam Student\n\nnot-an-email\nann@wright.edu\tAnn Lee\nSAM@wright.edu\n\"bo@wright.edu\",\"Bo Chan\"");
  assert.deepEqual(rows, [
    { email: "sam@wright.edu", name: "Sam Student" }, { email: "ann@wright.edu", name: "Ann Lee" }, { email: "bo@wright.edu", name: "Bo Chan" }]);
  assert.deepEqual(await commitRoster(setup.id, rows, "student"), { enrolled: 1, invited: 2 });
  assert.equal(await roleOf(setup.id, sam.id), "student");
});
await t("invited people land in the class with the right role when they sign up", async () => {
  const prof = await account("New Prof", "new.prof@flexee.org");
  const ann = await account("Ann Lee", "ann@wright.edu");
  assert.equal(await claimInvites(prof.id, "New.Prof@flexee.org"), 1);
  assert.equal(await claimInvites(ann.id, "ann@wright.edu"), 1);
  assert.equal(await roleOf(setup.id, prof.id), "instructor");
  assert.equal(await roleOf(setup.id, ann.id), "student");
  assert.equal((await pendingInvites(setup.id)).length, 1); // only bo@ is still invited
  assert.ok((await teachingSections(prof.id)).some((s) => s.id === setup.id), "new faculty see the class under My teaching");
});
await t("faculty are never demoted by a later student list; a student added as faculty is promoted", async () => {
  await commitRoster(setup.id, parsePeople("chuck@flexee.org"), "student");
  assert.equal(await roleOf(setup.id, chuck.id), "instructor");
  await commitRoster(setup.id, parsePeople("sam@wright.edu"), "instructor");
  assert.equal(await roleOf(setup.id, sam.id), "instructor");
});
await t("the same holds for invites: a faculty invite is not downgraded by a later student list", async () => {
  await commitRoster(mine.id, parsePeople("visitor@flexee.org"), "instructor");
  await commitRoster(mine.id, parsePeople("visitor@flexee.org"), "student");
  assert.equal((await pendingInvites(mine.id)).find((i) => i.email === "visitor@flexee.org")?.role, "instructor");
});
await t("withdrawing an invite only works within its own class", async () => {
  const inv = (await pendingInvites(setup.id)).find((i) => i.email === "bo@wright.edu")!;
  await removeInvite(mine.id, inv.id); // wrong class: no effect
  assert.ok((await pendingInvites(setup.id)).some((i) => i.id === inv.id));
  await removeInvite(setup.id, inv.id);
  assert.ok(!(await pendingInvites(setup.id)).some((i) => i.id === inv.id));
});

console.log("Admin overview");
await t("every class is listed with its faculty, student count and pending invites", async () => {
  const list = await allClasses();
  const a = list.find((c) => c.id === setup.id)!, b = list.find((c) => c.id === mine.id)!;
  assert.deepEqual(a.instructors.sort(), ["Chuck Nemer", "New Prof", "Sam Student"]);
  assert.equal(a.students, 1); assert.equal(a.pendingInvites, 0); assert.equal(a.bookPublished, false);
  assert.deepEqual(b.instructors, ["Vikram Sethi"]); assert.equal(b.pendingInvites, 1);
  const roster = await sectionRoster(setup.id);
  assert.ok(roster.find((r) => r.name === "Ann Lee")?.email === "ann@wright.edu");
});

console.log(`\n${passed} passed`);
