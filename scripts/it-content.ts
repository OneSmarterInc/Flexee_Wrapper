import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, desc, inArray, max } from "drizzle-orm";
import { diffLines } from "diff";
import * as schema from "../src/db/schema.ts";
const { sections, chapterVersions, sectionContentPins } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")).map((x) => x.slice(0, -4)).sort()) // every migration, so this test never goes stale
  for (const s of readFileSync(`drizzle/${f}.sql`, "utf8").split("--> statement-breakpoint")) { const t = s.trim(); if (t) await client.exec(t); }
console.log("3 migrations applied");

const BOOK = "mis3000", ENTRY = "ch05";
async function record(markdown: string, hash: string, kind: "feature" | "errata" = "feature", title = "What did you inherit?") {
  const dup = await db.select().from(chapterVersions).where(and(eq(chapterVersions.bookId, BOOK), eq(chapterVersions.entryId, ENTRY), eq(chapterVersions.contentHash, hash))).limit(1);
  if (dup[0]) return dup[0];
  const top = await db.select({ v: max(chapterVersions.version) }).from(chapterVersions).where(and(eq(chapterVersions.bookId, BOOK), eq(chapterVersions.entryId, ENTRY)));
  const version = (top[0]?.v ?? 0) + 1;
  const [row] = await db.insert(chapterVersions).values({ bookId: BOOK, entryId: ENTRY, version, contentHash: hash, kind, title, markdown, manifestJson: "{}" }).returning();
  if (kind === "errata") {
    const secIds = (await db.select({ id: sections.id }).from(sections).where(eq(sections.bookId, BOOK))).map((x) => x.id);
    if (secIds.length) await db.update(sectionContentPins).set({ versionId: row.id }).where(and(inArray(sectionContentPins.sectionId, secIds), eq(sectionContentPins.entryId, ENTRY)));
  }
  return row;
}
async function latest() { return (await db.select().from(chapterVersions).where(and(eq(chapterVersions.bookId, BOOK), eq(chapterVersions.entryId, ENTRY))).orderBy(desc(chapterVersions.version)).limit(1))[0]; }
async function pinOf(secId: string) { const p = (await db.select().from(sectionContentPins).where(and(eq(sectionContentPins.sectionId, secId), eq(sectionContentPins.entryId, ENTRY))).limit(1))[0]; return p ? (await db.select().from(chapterVersions).where(eq(chapterVersions.id, p.versionId)))[0] : null; }

// v1
const v1 = await record("# Ch5\n\nThe original text about inheriting systems.\n", "hash-v1");
console.log("v1 recorded:", v1.version === 1);

// section pins to latest (v1)
const [sec] = await db.insert(sections).values({ bookId: BOOK, name: "Sec A", joinCode: "Z1" }).returning();
const lv = await latest();
await db.insert(sectionContentPins).values({ sectionId: sec.id, entryId: ENTRY, versionId: lv.id });
console.log("section reads:", (await pinOf(sec.id))!.version, "(expect 1)");

// v2 feature upgrade
const v2 = await record("# Ch5\n\nThe original text about inheriting systems.\n\nA new paragraph added in v2.\n", "hash-v2");
console.log("v2 recorded:", v2.version === 2);
console.log("update available to section:", (await latest()).version > (await pinOf(sec.id))!.version);

// diff pinned(v1) -> latest(v2)
const parts = diffLines(v1.markdown, v2.markdown);
const added = parts.filter((p) => p.added).length;
console.log("diff shows additions:", added > 0);

// instructor publishes v2 to the section
await db.update(sectionContentPins).set({ versionId: v2.id }).where(and(eq(sectionContentPins.sectionId, sec.id), eq(sectionContentPins.entryId, ENTRY)));
console.log("after publish, section reads:", (await pinOf(sec.id))!.version, "(expect 2)");

// errata v3 -> auto-pushed
const v3 = await record("# Ch5\n\nThe original text about inheriting systems.\n\nA new paragraph added in v2. Typo fixed.\n", "hash-v3", "errata");
console.log("errata v3 auto-pushed, section now reads:", (await pinOf(sec.id))!.version, "(expect 3)");

// a second section created AFTER v3 pins to v3, independent of the first
const [sec2] = await db.insert(sections).values({ bookId: BOOK, name: "Sec B", joinCode: "Z2" }).returning();
await db.insert(sectionContentPins).values({ sectionId: sec2.id, entryId: ENTRY, versionId: (await latest()).id });
console.log("two sections can differ — A:", (await pinOf(sec.id))!.version, "B:", (await pinOf(sec2.id))!.version);
