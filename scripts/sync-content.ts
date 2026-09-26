// Snapshot the current content tree into the version store. Run after content
// changes: node --env-file=.env --experimental-strip-types scripts/sync-content.ts
// Add --errata to mark new versions as errata (auto-pushed to pinned sections).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray, max } from "drizzle-orm";
import { chapterVersions, sectionContentPins, sections } from "../src/db/schema.ts";

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.cwd(), "content");
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
const errata = process.argv.includes("--errata");
const sql = postgres(url);
const db = drizzle(sql, { schema: { chapterVersions, sectionContentPins, sections } });

const books = (await readdir(CONTENT_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
let created = 0;
for (const b of books) {
  const dir = path.join(CONTENT_DIR, b.name);
  let bm;
  try { bm = JSON.parse(await readFile(path.join(dir, "book.manifest.json"), "utf8")); } catch { continue; }
  for (const s of bm.spine) {
    const manifest = JSON.parse(await readFile(path.join(dir, s.ref, "manifest.json"), "utf8"));
    const markdown = await readFile(path.join(dir, s.ref, manifest.content), "utf8");
    const dup = await db.select().from(chapterVersions)
      .where(and(eq(chapterVersions.bookId, bm.id), eq(chapterVersions.entryId, s.ref), eq(chapterVersions.contentHash, manifest.contentHash))).limit(1);
    if (dup[0]) continue;
    const top = await db.select({ v: max(chapterVersions.version) }).from(chapterVersions)
      .where(and(eq(chapterVersions.bookId, bm.id), eq(chapterVersions.entryId, s.ref)));
    const version = (top[0]?.v ?? 0) + 1;
    const [row] = await db.insert(chapterVersions).values({
      bookId: bm.id, entryId: s.ref, version, contentHash: manifest.contentHash,
      kind: errata ? "errata" : "feature", title: manifest.title, markdown, manifestJson: JSON.stringify(manifest),
    }).returning();
    created++;
    console.log(`+ ${bm.id}/${s.ref} v${version}${errata ? " (errata)" : ""}`);
    if (errata) {
      const secIds = (await db.select({ id: sections.id }).from(sections).where(eq(sections.bookId, bm.id))).map((x) => x.id);
      if (secIds.length) await db.update(sectionContentPins).set({ versionId: row.id, updatedAt: new Date() })
        .where(and(inArray(sectionContentPins.sectionId, secIds), eq(sectionContentPins.entryId, s.ref)));
    }
  }
}
console.log(created ? `\n${created} new version(s) recorded.` : "\nNo content changes.");
await sql.end();
