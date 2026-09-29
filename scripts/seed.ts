// Seed one section per book and pin it to the latest content versions.
// Run AFTER db:sync-content so versions exist to pin to.
// node --env-file=.env --experimental-strip-types scripts/seed.ts
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, desc, eq } from "drizzle-orm";
import { sections, chapterVersions, sectionContentPins } from "../src/db/schema.ts";

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.cwd(), "content");
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (e.g. in .env)."); process.exit(1); }
const sql = postgres(url, { prepare: false });
const db = drizzle(sql, { schema: { sections, chapterVersions, sectionContentPins } });

const dirs = await readdir(CONTENT_DIR, { withFileTypes: true });
for (const d of dirs) {
  if (!d.isDirectory()) continue;
  let bm;
  try { bm = JSON.parse(await readFile(path.join(CONTENT_DIR, d.name, "book.manifest.json"), "utf8")); } catch { continue; }
  let sec = (await db.select().from(sections).where(eq(sections.bookId, bm.id)).limit(1))[0];
  if (!sec) {
    const code = `${String(bm.id).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    [sec] = await db.insert(sections).values({ bookId: bm.id, name: `${bm.title} — Default section`, joinCode: code, bookPublishedAt: new Date() }).returning();
    console.log(`✓ created section for ${bm.id} (join code ${code})`);
  } else console.log(`· section already exists for ${bm.id}`);
  // pin to latest versions (if content has been synced)
  let pinned = 0;
  for (const s of bm.spine) {
    const v = (await db.select().from(chapterVersions).where(and(eq(chapterVersions.bookId, bm.id), eq(chapterVersions.entryId, s.ref))).orderBy(desc(chapterVersions.version)).limit(1))[0];
    if (!v) continue;
    await db.insert(sectionContentPins).values({ sectionId: sec.id, entryId: s.ref, versionId: v.id })
      .onConflictDoUpdate({ target: [sectionContentPins.sectionId, sectionContentPins.entryId], set: { versionId: v.id } });
    pinned++;
  }
  console.log(`  pinned ${pinned} entr${pinned === 1 ? "y" : "ies"}${pinned === 0 ? " (run db:sync-content first)" : ""}`);
}
await sql.end();
