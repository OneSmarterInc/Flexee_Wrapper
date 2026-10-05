// Spec 21 rule 2 asks for a golden test: a book with no title attributes must render exactly as it
// did before the figure work. This writes the golden, and it is run once, from the commit before
// that work, so the file records what the renderer produced then rather than what it produces now.
//
//   npm run golden:figures          # writes scripts/fixtures/figures-golden.json
//
// Re-running it later would rewrite the baseline and make the comparison meaningless, so the suite
// that reads it (test:figures) prints this warning rather than offering a --update flag.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { renderEntry } from "@/lib/render";
import type { EntryManifest } from "@/lib/content";

const BOOKS = [
  { book: "sad", root: "content/sad" },
  { book: "mis3000", root: "content/mis3000" },
  { book: "fz1003", root: process.env.FZ1003_CONTENT || "", optional: true },
];

/**
 * What the golden covers: every figure the chapter renders, and the figures list the reader page is
 * built from. Not the whole page — rule 3 adds `scope` to table headers in the same commit, which
 * is a deliberate change to the markup, and a golden that is knowingly rewritten proves nothing.
 * Rule 2's promise is about figures, so that is what is frozen.
 */
function figureMarkup(html: string) {
  const blocks = [
    ...html.matchAll(/<figure[^>]*>[\s\S]*?<\/figure>/g),
    ...html.matchAll(/<div class="fx-figure-pending"[^>]*>[\s\S]*?<\/div>/g),
    // A table that Spec 16 turned into a figure is rule 3's business, not rule 2's — `scope` on its
    // header cells is a deliberate change to that markup in the same commit. Image figures are what
    // rule 2 promises are untouched, so they are what is frozen.
  ].map((m) => m[0]).filter((b) => !b.includes("<table"));
  return blocks.join("\n");
}

const out: Record<string, { figureHtml: string; count: number; figures: string }> = {};
for (const b of BOOKS) {
  if (!b.root || !existsSync(b.root)) {
    if (b.optional) { console.log(`SKIP ${b.book} — FZ1003_CONTENT is not set`); continue; }
    throw new Error(`${b.book}: no content at ${b.root}`);
  }
  for (const entry of readdirSync(b.root).filter((d) => /^ch\d+$/.test(d)).sort()) {
    const manifest = JSON.parse(readFileSync(path.join(b.root, entry, "manifest.json"), "utf8")) as EntryManifest;
    const markdown = readFileSync(path.join(b.root, entry, manifest.content), "utf8");
    const r = await renderEntry(markdown, manifest, `/api/asset/${b.book}/${entry}`);
    const marks = figureMarkup(r.html);
    out[`${b.book}/${entry}`] = {
      figureHtml: createHash("sha256").update(marks).digest("hex"),
      count: (marks.match(/<figure|<div class="fx-figure-pending"/g) || []).length,
      figures: createHash("sha256").update(JSON.stringify(r.figures)).digest("hex"),
    };
  }
}
writeFileSync("scripts/fixtures/figures-golden.json", JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${Object.keys(out).length} chapters to scripts/fixtures/figures-golden.json`);
