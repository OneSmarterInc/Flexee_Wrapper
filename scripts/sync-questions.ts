// Ingest each book's learning objectives and question bank into the DB.
// node --env-file=.env --experimental-strip-types scripts/sync-questions.ts
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { questions, learningObjectives } from "../src/db/schema.ts";

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.cwd(), "content");
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
const sql = postgres(url);
const db = drizzle(sql, { schema: { questions, learningObjectives } });

let nq = 0, no = 0;
for (const d of (await readdir(CONTENT_DIR, { withFileTypes: true }))) {
  if (!d.isDirectory()) continue;
  const dir = path.join(CONTENT_DIR, d.name);
  // objectives first (questions reference them)
  try {
    const objs = JSON.parse(await readFile(path.join(dir, "objectives.json"), "utf8"));
    for (const o of objs) {
      await db.insert(learningObjectives).values({ id: o.id, bookId: o.book, chapter: o.chapter, code: o.code ?? null, label: o.label, bloom: o.bloom ?? null, updatedAt: new Date() })
        .onConflictDoUpdate({ target: learningObjectives.id, set: { chapter: o.chapter, code: o.code ?? null, label: o.label, bloom: o.bloom ?? null, updatedAt: new Date() } });
      no++;
    }
  } catch { /* no objectives for this book */ }
  // questions
  let bank;
  try { bank = JSON.parse(await readFile(path.join(dir, "questions.json"), "utf8")); } catch { continue; }
  for (const q of bank) {
    const optionsJson = JSON.stringify(q.options);
    const hash = createHash("sha256").update(q.stem + optionsJson + q.objective + q.difficulty).digest("hex").slice(0, 16);
    const vals = { id: q.id, bookId: q.book, chapter: q.chapter, section: q.section ?? null, objective: q.objective,
      objectiveId: q.objectiveId ?? null, type: q.type ?? "multiple_choice", difficulty: q.difficulty, stem: q.stem,
      optionsJson, points: q.points ?? 1, shuffleOptions: q.shuffleOptions ?? true,
      tagsJson: q.tags ? JSON.stringify(q.tags) : null,
      metaJson: (() => { const m = Object.fromEntries(["use", "style", "context", "figure", "review", "source"].filter((k) => q[k] != null).map((k) => [k, q[k]])); return Object.keys(m).length ? JSON.stringify(m) : null; })(),
      contentHash: hash, updatedAt: new Date() };
    await db.insert(questions).values(vals).onConflictDoUpdate({ target: questions.id, set: vals });
    nq++;
  }
  console.log(`· ${d.name}: ${bank.length} questions`);
}
console.log(`\n${no} objective(s), ${nq} question(s) synced.`);
await sql.end();
