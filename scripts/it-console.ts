import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { users, identities, sections, enrolments, rosterInvites } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
for (const f of ["drizzle/0000_init.sql", "drizzle/0001_section_owner_and_invites.sql"])
  for (const s of readFileSync(f, "utf8").split("--> statement-breakpoint")) { const t = s.trim(); if (t) await client.exec(t); }
console.log("both migrations applied");

async function makeUser(name: string, email: string) {
  const [u] = await db.insert(users).values({ displayName: name }).returning();
  await db.insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: await bcrypt.hash("pw12345678", 10) });
  return u;
}

// instructor creates a section
const prof = await makeUser("Prof. Grace", "grace@uni.edu");
const [sec] = await db.insert(sections).values({ bookId: "mis3000", name: "Fall 2027 A", joinCode: "ABC123", createdBy: prof.id }).returning();
await db.insert(enrolments).values({ sectionId: sec.id, userId: prof.id, role: "instructor" });
console.log("section created, instructor enrolment:",
  (await db.select().from(enrolments).where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.role, "instructor")))).length === 1);

// an existing student
const bob = await makeUser("Bob", "bob@uni.edu");

// commit a roster: bob (exists) -> enrol; carol (unknown) -> invite; junk row ignored by route filter
async function commitRoster(rows: { email: string; name?: string }[]) {
  const emails = rows.map((r) => r.email.toLowerCase());
  const known = await db.select({ userId: identities.userId, email: identities.subject }).from(identities)
    .where(and(eq(identities.provider, "password"), inArray(identities.subject, emails)));
  const map = new Map(known.map((k) => [k.email, k.userId]));
  let enrolled = 0, invited = 0;
  for (const r of rows) {
    const uid = map.get(r.email.toLowerCase());
    if (uid) { await db.insert(enrolments).values({ sectionId: sec.id, userId: uid }).onConflictDoNothing(); enrolled++; }
    else { await db.insert(rosterInvites).values({ sectionId: sec.id, email: r.email.toLowerCase(), name: r.name }).onConflictDoNothing(); invited++; }
  }
  return { enrolled, invited };
}
console.log("commitRoster:", await commitRoster([{ email: "bob@uni.edu", name: "Bob" }, { email: "carol@uni.edu", name: "Carol" }]));
console.log("  bob enrolled:", (await db.select().from(enrolments).where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, bob.id)))).length === 1);
console.log("  carol invited:", (await db.select().from(rosterInvites).where(eq(rosterInvites.email, "carol@uni.edu"))).length === 1);

// carol signs up later -> claimInvites converts her invite to an enrolment
const carol = await makeUser("Carol", "carol@uni.edu");
async function claim(userId: string, email: string) {
  const invs = await db.select().from(rosterInvites).where(eq(rosterInvites.email, email));
  for (const i of invs) await db.insert(enrolments).values({ sectionId: i.sectionId, userId }).onConflictDoNothing();
  await db.delete(rosterInvites).where(inArray(rosterInvites.id, invs.map((i) => i.id)));
  return invs.length;
}
console.log("carol claimed invites:", await claim(carol.id, "carol@uni.edu"));
console.log("  carol now enrolled:", (await db.select().from(enrolments).where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, carol.id)))).length === 1);
console.log("  no invites left:", (await db.select().from(rosterInvites).where(eq(rosterInvites.sectionId, sec.id))).length === 0);

// join by code
const dave = await makeUser("Dave", "dave@uni.edu");
const found = (await db.select().from(sections).where(eq(sections.joinCode, "ABC123")).limit(1))[0];
await db.insert(enrolments).values({ sectionId: found.id, userId: dave.id }).onConflictDoNothing();
console.log("dave joined by code:", (await db.select().from(enrolments).where(and(eq(enrolments.sectionId, sec.id), eq(enrolments.userId, dave.id)))).length === 1);

// final roster: 1 instructor + 3 students
const roster = await db.select().from(enrolments).where(eq(enrolments.sectionId, sec.id));
console.log("final roster size:", roster.length, "(expect 4: prof + bob + carol + dave)");
