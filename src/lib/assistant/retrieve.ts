import "server-only";
import { getBook } from "@/lib/content";
import { resolveEntryForSection } from "@/lib/versions";
import { buildCorpus, search, TOP_K, SCORE_FLOOR, type Corpus } from "./corpus";

export { TOP_K, SCORE_FLOOR };
export type { Corpus };

/**
 * The class's own book, cut up and searchable (Spec 20 §2).
 *
 * Three constraints the spec puts on retrieval, all met by going through
 * `resolveEntryForSection`:
 *
 *  - **Only the class's book**, because the book id comes from the class's own section row.
 *  - **Only at the class's pinned versions**, because that function returns the pin's markdown and
 *    falls back to the working tree exactly as the reader does. The student and the assistant
 *    therefore read the same words.
 *  - **Chapters only** (decision 3). Front matter is not course content.
 *
 * The question bank never comes near this. It lives in the `questions` table, and nothing in
 * src/lib/assistant reads that table.
 */

// One corpus per distinct set of pinned content. Two classes on the same pins share it; a
// republish changes the key and the next request builds a new one. The whole of either book is
// about 350 KB and 130 chunks, so this is cheap to hold and cheap to rebuild.
const CACHE = new Map<string, Corpus>();
const MAX_CACHED = 8;

export function clearIndexCache() { CACHE.clear(); }

export async function classCorpus(sectionId: string, bookId: string): Promise<Corpus> {
  const book = await getBook(bookId);
  const chapters = book.spine.filter((s) => s.kind === "chapter");
  const entries = await Promise.all(chapters.map(async (s) => {
    const { manifest, markdown } = await resolveEntryForSection(sectionId, bookId, s.ref);
    return { manifest, markdown };
  }));
  const built = buildCorpus(bookId, entries);
  const hit = CACHE.get(built.key);
  if (hit) return hit;
  if (CACHE.size >= MAX_CACHED) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(built.key, built);
  return built;
}

export async function retrieve(sectionId: string, bookId: string, question: string, k = TOP_K) {
  const corpus = await classCorpus(sectionId, bookId);
  return { corpus, ...search(corpus, question, k) };
}
