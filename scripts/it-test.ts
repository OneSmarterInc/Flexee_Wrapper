import { readFileSync, readdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
const { users, identities, sessions, sections, enrolments, bookmarks } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });

// Apply the current schema; later tests use columns introduced after 0000.
for (const file of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await client.exec(s);
  }
}
console.log("migrations applied");

// seed a section (as scripts/seed.ts would)
const [sec] = await db.insert(sections).values({ bookId: "mis3000", name: "Introduction to MIS — Default section", joinCode: "MIS3000-AB12" }).returning();

// signup: user + password identity
const [user] = await db.insert(users).values({ displayName: "Ada Student" }).returning();
await db.insert(identities).values({ userId: user.id, provider: "password", subject: "ada@example.edu", passwordHash: await bcrypt.hash("correcthorse", 10) });

// login check
const idRow = (await db.select().from(identities).where(and(eq(identities.provider, "password"), eq(identities.subject, "ada@example.edu"))).limit(1))[0];
console.log("login verifies:", await bcrypt.compare("correcthorse", idRow.passwordHash!), "| wrong pw rejected:", !(await bcrypt.compare("nope", idRow.passwordHash!)));

// session
await db.insert(sessions).values({ id: "sess_token_123", userId: user.id, expiresAt: new Date(Date.now() + 864e5) });

// enrol (idempotent)
await db.insert(enrolments).values({ sectionId: sec.id, userId: user.id }).onConflictDoNothing();
await db.insert(enrolments).values({ sectionId: sec.id, userId: user.id }).onConflictDoNothing(); // dup
const enr = (await db.select().from(enrolments).where(eq(enrolments.userId, user.id)))[0];
const enrCount = (await db.select().from(enrolments).where(eq(enrolments.userId, user.id))).length;
console.log("enrolments after double-enrol:", enrCount, "(expect 1)");

// entitlement: reading mis3000 allowed, sad denied
const canMis = (await db.select().from(enrolments).innerJoin(sections, eq(sections.id, enrolments.sectionId)).where(and(eq(enrolments.userId, user.id), eq(sections.bookId, "mis3000")))).length;
const canSad = (await db.select().from(enrolments).innerJoin(sections, eq(sections.id, enrolments.sectionId)).where(and(eq(enrolments.userId, user.id), eq(sections.bookId, "sad")))).length;
console.log("entitled to mis3000:", canMis === 1, "| entitled to sad:", canSad === 0);

// bookmark upsert twice -> one row, updated
async function saveBookmark(entryId: string, anchor: string, scroll: number) {
  await db.insert(bookmarks).values({ enrolmentId: enr.id, bookId: "mis3000", entryId, chapterVersion: 1, sectionAnchor: anchor, scroll })
    .onConflictDoUpdate({ target: [bookmarks.enrolmentId, bookmarks.bookId], set: { entryId, sectionAnchor: anchor, scroll, updatedAt: new Date() } });
}
await saveBookmark("ch01", "c1s2", 0.3);
await saveBookmark("ch05", "c5s4", 0.7);
const bms = await db.select().from(bookmarks).where(eq(bookmarks.enrolmentId, enr.id));
console.log("bookmark rows:", bms.length, "(expect 1) | resumes at:", bms[0].entryId, bms[0].sectionAnchor, "scroll", bms[0].scroll);
