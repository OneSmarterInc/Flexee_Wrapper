/**
 * BM25 over a few hundred short passages (Spec 20 §2).
 *
 * Pure, dependency-free, and deliberately the simplest thing that cleared the bar: measured
 * before this was built, it put a passage from the question's own chapter in the top five for
 * **99 of 100** bank stems across the two books (SAD 50/50, MIS 4950 49/50, with each chapter's
 * review-question sections excluded). Embeddings were not needed to beat that, and a 250-chunk
 * corpus does not justify a vector store.
 *
 * The constants and the stopword list are the ones the measurement used. Changing them changes
 * the numbers in docs/specs/20_Course_Assistant.md, so they are not to be tuned casually.
 */

const K1 = 1.5;
const B = 0.75;

const STOP = new Set(`a an the and or but if then than that this these those of in on at to for from by with
as is are was were be been being it its they them their there here what which who whom how why
when where do does did doing have has had having not no nor so such too very can will just should
would could may might must about into over under again further once all any both each few more most
other some only own same don now you your i we he she his her my me us our`.split(/\s+/));

const WORD = /[a-z0-9']+/g;

/** Lower-case, drop stopwords and single characters. Shared by the index and every query. */
export function tokenise(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(WORD)) {
    const w = m[0];
    if (w.length > 1 && !STOP.has(w)) out.push(w);
  }
  return out;
}

export type Scored = { index: number; score: number };

export class Bm25 {
  private tf: Map<string, number>[];
  private len: number[];
  private avg: number;
  private idf: Map<string, number>;

  constructor(docs: string[]) {
    const toks = docs.map(tokenise);
    this.len = toks.map((t) => t.length);
    this.avg = this.len.length ? this.len.reduce((a, b) => a + b, 0) / this.len.length : 0;
    this.tf = toks.map((t) => {
      const m = new Map<string, number>();
      for (const w of t) m.set(w, (m.get(w) ?? 0) + 1);
      return m;
    });
    const df = new Map<string, number>();
    for (const m of this.tf) for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    const n = this.tf.length;
    this.idf = new Map();
    for (const [w, c] of df) this.idf.set(w, Math.log(1 + (n - c + 0.5) / (c + 0.5)));
  }

  /** Every document, best first. Ties break by document order, so a run is reproducible. */
  rank(query: string): Scored[] {
    const q = tokenise(query);
    const out: Scored[] = [];
    for (let i = 0; i < this.tf.length; i++) {
      const tf = this.tf[i];
      let s = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const idf = this.idf.get(w) ?? 0;
        s += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (this.avg ? this.len[i] / this.avg : 1)));
      }
      if (s > 0) out.push({ index: i, score: s });
    }
    out.sort((a, b) => b.score - a.score || a.index - b.index);
    return out;
  }

  top(query: string, k: number): Scored[] { return this.rank(query).slice(0, k); }
}
