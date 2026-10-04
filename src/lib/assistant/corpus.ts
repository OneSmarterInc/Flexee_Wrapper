import type { EntryManifest } from "@/lib/content";
import { Bm25 } from "./bm25";
import { anchorsFor, chunkEntry, type Chunk } from "./chunk";

/**
 * Building the searchable corpus (Spec 20 §2). Pure, so the server and the evaluation harness
 * share one definition: the harness reads chapter packages off a disk and the server reads the
 * class's pinned versions, and from here on the two are identical.
 */

export type Corpus = {
  key: string;
  chunks: Chunk[];
  bm25: Bm25;
  /** entryId -> every address a citation may point at. */
  anchors: Map<string, Set<string>>;
  entryTitles: Map<string, string>;
};

export type Entry = { manifest: EntryManifest; markdown: string };

export function buildCorpus(bookId: string, entries: Entry[]): Corpus {
  const chunks: Chunk[] = [];
  const anchors = new Map<string, Set<string>>();
  const entryTitles = new Map<string, string>();
  for (const { manifest, markdown } of entries) {
    chunks.push(...chunkEntry(markdown, manifest));
    anchors.set(manifest.id, anchorsFor(manifest));
    entryTitles.set(manifest.id, manifest.title);
  }
  return {
    key: `${bookId}|${entries.map((e) => `${e.manifest.id}@${e.manifest.version}:${e.manifest.contentHash}`).join(",")}`,
    chunks, anchors, entryTitles,
    // The heading is indexed with the body: a section's title is often the best match a short
    // question has.
    bm25: new Bm25(chunks.map((c) => `${c.heading}\n${c.text}`)),
  };
}

export const TOP_K = 5;

/**
 * The no-call floor (decision 1, layer 1). Deliberately tiny: it fired for **none** of the 200
 * in-book stems measured, so it catches only a question with nothing in common with the book. A
 * higher floor looked attractive until long off-topic questions were tried — they outscore the
 * fifth percentile of genuine questions — so the real refusing is done by the model and by the
 * citation check, not here.
 */
export const SCORE_FLOOR = 4;

export function search(corpus: Corpus, question: string, k = TOP_K) {
  const scored = corpus.bm25.top(question, k);
  const passages = scored.map((s) => ({ chunk: corpus.chunks[s.index], score: s.score }));
  return {
    passages,
    topScore: passages[0]?.score ?? 0,
    hopeless: passages.length === 0 || (passages[0]?.score ?? 0) < SCORE_FLOOR,
  };
}
