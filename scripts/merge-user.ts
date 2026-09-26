// Support operation: merge one account into another (e.g. a mistyped-email duplicate).
// node --env-file=.env --experimental-strip-types scripts/merge-user.ts --from dup@x.edu --into real@x.edu
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { identities, enrolments, sessions, users } from "../src/db/schema.ts";
const url = process.env.DATABASE_URL; if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
const a = process.argv; const get = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const fromEmail = get("--from"), intoEmail = get("--into");
if (!fromEmail || !intoEmail) { console.error("Usage: --from <email> --into <email>"); process.exit(1); }
const sql = postgres(url); const db = drizzle(sql, { schema: { identities, enrolments, sessions, users } });
const uid = async (e: string) => (await db.select().from(identities).where(and(eq(identities.provider, "password"), eq(identities.subject, e.toLowerCase()))).limit(1))[0]?.userId;
const from = await uid(fromEmail), into = await uid(intoEmail);
if (!from || !into) { console.error("Both accounts must exist (password identities)."); process.exit(1); }
if (from === into) { console.error("Same account."); process.exit(1); }
const intoSecs = new Set((await db.select({ s: enrolments.sectionId }).from(enrolments).where(eq(enrolments.userId, into))).map((r) => r.s));
for (const e of await db.select().from(enrolments).where(eq(enrolments.userId, from)))
  intoSecs.has(e.sectionId) ? await db.delete(enrolments).where(eq(enrolments.id, e.id)) : await db.update(enrolments).set({ userId: into }).where(eq(enrolments.id, e.id));
const intoIds = new Set((await db.select().from(identities).where(eq(identities.userId, into))).map((i) => `${i.provider}|${i.subject}`));
for (const i of await db.select().from(identities).where(eq(identities.userId, from)))
  intoIds.has(`${i.provider}|${i.subject}`) ? await db.delete(identities).where(eq(identities.id, i.id)) : await db.update(identities).set({ userId: into }).where(eq(identities.id, i.id));
await db.delete(sessions).where(eq(sessions.userId, from));
await db.delete(users).where(eq(users.id, from));
console.log(`Merged ${fromEmail} into ${intoEmail}.`);
await sql.end();
