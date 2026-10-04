import { norm } from "@/lib/render";
import { anchorFor } from "@/lib/render";
import type { EntryManifest, Section, Figure } from "@/lib/content";

/**
 * A chapter, cut into the pieces the assistant retrieves (Spec 20 §2).
 *
 * Pure: markdown and a manifest in, chunks out. No database, no store, no `server-only`, so the
 * evaluation harness cuts a chapter exactly as the server does — which is the only reason the
 * numbers measured before this was built are the numbers it ships with.
 *
 * Sections are cut at `##` and `###`, because the two books use different levels for the same
 * thing, and a `####` subsection stays with its parent section rather than becoming a chunk of its
 * own: at a median 182–237 words a section is already the right size for a passage, and splitting
 * further only scatters a single argument across two results.
 *
 * Each chunk's heading is matched back to a manifest section by the same `norm()` the renderer
 * uses to put ids on headings, so a citation points at the id the reader's HTML actually carries.
 */

export type Chunk = {
  bookId: string;
  entryId: string;
  chapter: number | null;
  entryTitle: string;
  /** The heading as written, with any leading enumerator removed. */
  heading: string;
  /** The manifest section id (cNsM), when this chunk is one of the manifest's sections. */
  anchor: string | null;
  text: string;
  words: number;
};

/**
 * Decision 2: a chapter's own review questions are not indexed. Excluding them *raised* retrieval
 * (SAD went 48/50 to 50/50 at top 5), because those sections are dense with question-like
 * language and pull in stems from every other chapter. The panel says the assistant does not
 * discuss them, so a student who asks is told why.
 */
export const EXCLUDED_HEADING = /review question|exercises?$/i;

const HEADING = /^(#{2,3})\s+(.*)$/;
const CHAPTER_TITLE = /^#\s+/;

/**
 * Markdown that only adds noise to a passage: images become their alt text, placeholders go, and a
 * thematic break goes with them — the books use `---` between sections, and left in it arrives in
 * the prompt right next to the separator between passages, which reads as an empty passage.
 * A table's `| :--- |` row is not a thematic break and stays.
 */
function clean(body: string) {
  return body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `[figure: ${alt}]` : ""))
    .replace(/^\s*\*?\s*artwork pending.*$/gim, "")
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkEntry(markdown: string, manifest: EntryManifest): Chunk[] {
  const sections: Section[] = manifest.sections ?? [];
  const byNorm = new Map(sections.map((s) => [norm(s.title), s.id]));
  const out: Chunk[] = [];
  let heading: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = clean(buf.join("\n"));
    buf = [];
    if (!text) return;
    const h = heading ?? "(chapter opening)";
    if (heading && EXCLUDED_HEADING.test(heading)) return;
    out.push({
      bookId: manifest.book,
      entryId: manifest.id,
      chapter: manifest.number ?? null,
      entryTitle: manifest.title,
      heading: h,
      anchor: heading ? byNorm.get(norm(heading)) ?? null : null,
      text,
      words: text.split(/\s+/).filter(Boolean).length,
    });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      heading = m[2].replace(/^\s*\d+[.)]\s*/, "").trim();
      continue;
    }
    if (CHAPTER_TITLE.test(line)) { flush(); heading = null; continue; }
    buf.push(line);
  }
  flush();
  return out;
}

/**
 * Every address a citation may point at inside one entry: its section ids, and its figure and
 * table anchors. Anything else a model returns is not a place in this book.
 */
export function anchorsFor(manifest: EntryManifest): Set<string> {
  const out = new Set<string>();
  for (const s of manifest.sections ?? []) out.add(s.id);
  for (const f of (manifest.figures ?? []) as Figure[]) out.add(anchorFor(f));
  return out;
}
