/**
 * The evaluation harness (Spec 20 §7).
 *
 *   npm run eval:assistant -- --book sad
 *   npm run eval:assistant -- --packages "G:/My Drive/Flexee/FiveZero-4950/MIS4950_v1_CURRENT"
 *   npm run eval:assistant -- --book sad --real --yes
 *
 * For every question in the bank it asks the **stem** as a student would and checks that the
 * answer cites a section from that question's own chapter. The bank's options and rationales are
 * never given to the assistant — they are not even read into the prompt path, and the harness
 * scans every captured prompt for them afterwards to prove it.
 *
 * Offline against the fake provider by default, which is how it runs in CI. With `--real` it
 * prints an estimated cost first and refuses to go on without `--yes`.
 *
 * `--packages` reads a book's chapter packages and banks straight off a disk (decision 7), so
 * MIS 4950 can be evaluated before it is admitted to the library.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EntryManifest } from "@/lib/content";
import { buildCorpus, search, type Entry } from "@/lib/assistant/corpus";
import { ask } from "@/lib/assistant/ask";
import { NOT_IN_BOOK, NO_REVIEW_QUESTIONS, buildPrompt } from "@/lib/assistant/answer";
import { gate, GATE_MESSAGES } from "@/lib/assistant/gate";
import { fakeProvider } from "@/lib/ai/fake";
import { provider as realProvider, estimateCostMicros, formatMicros, priceTable } from "@/lib/ai";
import { estimateTokens } from "@/lib/ai/types";

// ---------------------------------------------------------------- the pass bar
const BAR = {
  // What retrieval must put in front of the model. Measured at 99/100 before this was built.
  rightChapter: 0.95,
  /**
   * What must then be cited. Offline the fake cites the top-ranked passage, so this figure is
   * retrieval at rank 1 — a floor, not the assistant's accuracy. Judge the assistant itself on a
   * --real run, where a model reads all five and the ceiling above is what it can reach.
   */
  citesRightChapter: 0.80,
  anyCitation: 0.98,      // answers carrying at least one valid citation
  bankTextInPrompts: 0,   // prompts containing a bank option or rationale
  attemptRefusal: 1.0,    // refusals while an attempt is in progress
};

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const j = argv.find((a) => a.startsWith(`--${n}=`));
  return j ? j.slice(n.length + 3) : undefined;
};

const BOOK = value("book");
const PACKAGES = value("packages");
const LIMIT = Number(value("limit") || 0);
const REAL = flag("real");

type Question = { id: string; chapter: number; section?: string; stem: string; options?: { text?: string; rationale?: string }[] };

// ---------------------------------------------------------------- loading a book

/** From the repository's content tree (or CONTENT_DIR): the book the Wrapper would serve. */
function fromContentTree(bookId: string) {
  const root = process.env.CONTENT_DIR || path.join(process.cwd(), "content");
  const book = JSON.parse(readFileSync(path.join(root, bookId, "book.manifest.json"), "utf8")) as { spine: { ref: string; kind: string }[] };
  const entries: Entry[] = [];
  for (const s of book.spine.filter((x) => x.kind === "chapter")) {
    const dir = path.join(root, bookId, s.ref);
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as EntryManifest;
    entries.push({ manifest, markdown: readFileSync(path.join(dir, manifest.content), "utf8") });
  }
  return entries;
}

/**
 * From a book's source packages on disk. The manifest is synthesised the way tools/flexee_intake.py
 * does it — `### ` headings become sections `cNsM`, with a leading enumerator stripped — so what
 * is measured here is what the intake will produce when the book is admitted.
 */
function fromPackages(root: string, bookId: string) {
  const chaptersDir = path.join(root, "04_Chapters");
  const zips = readdirSync(chaptersDir).filter((f) => /^Chapter_\d+_Package_.*\.zip$/i.test(f)).sort();
  if (!zips.length) throw new Error(`No Chapter_NN_Package_*.zip under ${chaptersDir}`);
  const work = mkdtempSync(path.join(tmpdir(), "eval-"));
  const entries: Entry[] = [];
  try {
    for (const z of zips) {
      const n = Number(/^Chapter_(\d+)_/.exec(z)![1]);
      const dest = path.join(work, `ch${n}`);
      const r = spawnSync("python3", [path.join(process.cwd(), "tools", "safe_unzip.py"), path.join(chaptersDir, z), dest], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`could not read ${z}: ${(r.stderr || "").slice(0, 200)}`);
      const md = walk(dest).find((f) => f.toLowerCase().endsWith(".md"));
      if (!md) throw new Error(`${z} holds no markdown`);
      const markdown = readFileSync(md, "utf8");
      const h1 = /^#\s+CHAPTER\s+(\d+):\s*(.+)$/im.exec(markdown);
      const sections = [...markdown.matchAll(/^### (.+)$/gm)].map((m, i) => ({
        id: `c${n}s${i + 1}`, title: m[1].replace(/^\d+\.\s*/, "").trim(),
      }));
      entries.push({
        markdown,
        manifest: {
          schemaVersion: 2, id: `ch${String(n).padStart(2, "0")}`, book: bookId, kind: "chapter",
          number: h1 ? Number(h1[1]) : n, label: String(n), title: h1 ? h1[2].trim() : `Chapter ${n}`,
          version: 1, contentHash: `local:${n}`, content: "content.md", sections, figures: [],
        } as EntryManifest,
      });
    }
  } finally {
    // The extracted copies are read into memory and then dropped; nothing is kept on disk.
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return entries;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/**
 * The bank, in either of the two layouts it exists in: one file per chapter under a book's
 * `07_Question_Banks/questions`, or the single `questions.json` the content tree carries.
 */
function loadBank(bookId: string, packages?: string): Question[] {
  if (packages) {
    const dir = path.join(packages, "07_Question_Banks", "questions");
    if (!existsSync(dir)) return [];
    const out: Question[] = [];
    for (const f of readdirSync(dir).filter((x) => /^ch\d+\.json$/i.test(x)).sort()) {
      out.push(...JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Question[]);
    }
    return out;
  }
  const one = path.join(process.env.CONTENT_DIR || path.join(process.cwd(), "content"), bookId, "questions.json");
  return existsSync(one) ? JSON.parse(readFileSync(one, "utf8")) as Question[] : [];
}

// ---------------------------------------------------------------- the run

const bookId = BOOK || (PACKAGES ? path.basename(PACKAGES).toLowerCase().replace(/[^a-z0-9]+/g, "-") : "");
if (!bookId) {
  console.error("Give --book <id> (the content tree) or --packages <path> (a book's source folder).");
  process.exit(1);
}

const entries = PACKAGES ? fromPackages(PACKAGES, bookId) : fromContentTree(bookId);
let bank = loadBank(bookId, PACKAGES);
if (!bank.length) {
  console.error(`No question bank found for ${bookId}. The content tree holds one as ` +
    `content/${bookId}/questions.json; a book's source folder holds one file per chapter under ` +
    `07_Question_Banks/questions, which --packages reads.`);
  process.exit(1);
}
if (LIMIT > 0) bank = bank.slice(0, LIMIT);

const corpus = buildCorpus(bookId, entries);
const chunkWords = corpus.chunks.map((c) => c.words).sort((a, b) => a - b);

console.log(`Book ${bookId}: ${entries.length} chapters, ${corpus.chunks.length} indexed section chunks`);
console.log(`  words per chunk: median ${chunkWords[Math.floor(chunkWords.length / 2)]}, max ${chunkWords[chunkWords.length - 1]}`);
console.log(`  bank: ${bank.length} questions across ${new Set(bank.map((q) => q.chapter)).size} chapters`);

// An estimate before anything is sent, every time — and a gate when it is real.
const sample = bank.slice(0, Math.min(25, bank.length));
const estIn = Math.round(sample.reduce((s, q) => {
  const { passages } = search(corpus, q.stem);
  return s + estimateTokens(buildPrompt({ question: q.stem, passages: passages.map((p) => p.chunk) }).system)
    + passages.reduce((t, p) => t + estimateTokens(p.chunk.text), 0) + estimateTokens(q.stem);
}, 0) / Math.max(1, sample.length));
const estOut = 300;
const { inPerM, outPerM } = priceTable();
console.log(`  estimated per question: ~${estIn} tokens in, ~${estOut} out` +
  `  ->  ${formatMicros(estimateCostMicros(estIn, estOut))} at $${inPerM}/$${outPerM} per MTok`);
console.log(`  estimated for this run: ${formatMicros(estimateCostMicros(estIn * bank.length, estOut * bank.length))}`);

if (REAL && !flag("yes")) {
  console.error("\n--real needs --yes as well. Nothing was sent.");
  process.exit(1);
}
const fake = fakeProvider();
const ai = REAL ? realProvider() : fake.provider;
console.log(`  provider: ${ai.name} (${ai.model})${REAL ? "" : " — offline, nothing leaves this machine"}\n`);

let rightChapter = 0, anyCitation = 0, notInBook = 0, reviewDeflected = 0, tokensIn = 0, tokensOut = 0;
let suppliedRightChapter = 0;
const misses: { id: string; chapter: number; cited: string[] }[] = [];

for (const q of bank) {
  const { passages, hopeless } = search(corpus, q.stem);
  const entryId = `ch${String(q.chapter).padStart(2, "0")}`;
  // What retrieval put in front of the model: the ceiling any provider could reach.
  if (passages.some((p) => p.chunk.entryId === entryId)) suppliedRightChapter++;
  const a = await ask({
    question: q.stem,
    passages: passages.map((p) => p.chunk),
    hopeless,
    allowed: { bookId, anchors: corpus.anchors, entryTitles: corpus.entryTitles },
    provider: ai,
  });
  tokensIn += a.tokensIn; tokensOut += a.tokensOut;
  if (a.text === NOT_IN_BOOK) notInBook++;
  else if (a.text === NO_REVIEW_QUESTIONS) reviewDeflected++;
  if (a.citations.length > 0) anyCitation++;
  if (a.citations.some((c) => c.entryId === entryId)) rightChapter++;
  else misses.push({ id: q.id, chapter: q.chapter, cited: a.citations.map((c) => c.href) });
}

const n = bank.length;
const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

/**
 * Rule 3, proved rather than asserted: no prompt may carry the bank's own options or rationales.
 *
 * The scan looks only for strings the **book does not contain**. A rationale is often written out
 * of the chapter it tests, so a prompt holding a passage can hold a sentence a rationale also
 * holds — on SAD that is 19 of 2,304 strings, and scanning for all of them flags 170 prompts and
 * calls the book's own words a leak. A string absent from every chapter can only have come from
 * the bank, which is the thing worth catching.
 */
const corpusText = entries.map((e) => e.markdown).join("\n");
const allNeedles: string[] = [];
for (const q of bank) {
  for (const o of q.options ?? []) {
    for (const s of [o.text, o.rationale]) {
      const t = (s ?? "").trim();
      if (t.length >= 25) allNeedles.push(t);
    }
  }
}
// Nor does a string that is part of some question's stem prove anything: asking a stem is what
// this harness does. On MIS 4950 exactly one string is caught that way — "99.9 percent
// availability", an option in c11-021 and part of c11-020's stem.
const stemText = bank.map((q) => q.stem).join("\n");
const needles = allNeedles.filter((t) => !corpusText.includes(t) && !stemText.includes(t));
const alsoInBook = allNeedles.length - needles.length;
let bankTextInPrompts = 0;
for (const cap of fake.captured) {
  const text = cap.system + cap.messages.map((m) => m.content).join("\n");
  if (needles.some((t) => text.includes(t))) bankTextInPrompts++;
}

// The attempt gate, shown rather than described.
const during = gate({
  aiAvailable: true, classEnabled: true, bookPublished: true, attemptsInProgress: 1,
  assignmentOff: false, requestsToday: 0, dailyPerStudent: 20, tokensThisMonth: 0, monthlyTokenCap: 500000,
});
const after = gate({
  aiAvailable: true, classEnabled: true, bookPublished: true, attemptsInProgress: 0,
  assignmentOff: false, requestsToday: 0, dailyPerStudent: 20, tokensThisMonth: 0, monthlyTokenCap: 500000,
});
const attemptOk = !during.allowed && during.reason === "attempt" && after.allowed;

console.log("Results");
console.log(`  the right chapter was among the ${5} passages supplied:   ${suppliedRightChapter}/${n}  ${pct(suppliedRightChapter)}`);
console.log(`  cites a section from the question's own chapter: ${rightChapter}/${n}  ${pct(rightChapter)}`);
console.log(`  carries at least one valid citation:             ${anyCitation}/${n}  ${pct(anyCitation)}`);
console.log(`  said it is not in the book:                     ${notInBook}/${n}  ${pct(notInBook)}`);
console.log(`  deflected as a review question:                 ${reviewDeflected}/${n}  ${pct(reviewDeflected)}`);
console.log(`  prompts containing bank options or rationales:   ${bankTextInPrompts}  (${needles.length} bank-only strings looked for; ${alsoInBook} more are the book's own words or part of a stem, and are not counted)`);
console.log(`  refuses during an attempt, works after:          ${attemptOk ? "yes" : "NO"}`);
console.log(`  tokens: ${tokensIn.toLocaleString()} in, ${tokensOut.toLocaleString()} out` +
  `  ->  ${formatMicros(estimateCostMicros(tokensIn, tokensOut))} at the rates above`);

if (misses.length) {
  console.log(`\n  ${misses.length} did not cite their own chapter:`);
  for (const m of misses.slice(0, 12)) console.log(`    ${m.id} (chapter ${m.chapter}) cited ${m.cited.length ? m.cited.join(", ") : "nothing"}`);
  if (misses.length > 12) console.log(`    … and ${misses.length - 12} more`);
}

const checks = [
  ["retrieval supplies the right chapter", suppliedRightChapter / n, BAR.rightChapter],
  ["cites the right chapter", rightChapter / n, BAR.citesRightChapter],
  ["any citation", anyCitation / n, BAR.anyCitation],
] as const;
let failed: string[] = checks.filter(([, got, want]) => got < want).map(([name]) => name);
if (bankTextInPrompts > BAR.bankTextInPrompts) failed = [...failed, "bank text in prompts"];
if (!attemptOk) failed = [...failed, "attempt refusal"];

console.log("\nPass bar");
for (const [name, got, want] of checks) {
  console.log(`  ${got >= want ? "PASS" : "FAIL"}  ${name}: ${(got * 100).toFixed(1)}% against ${(want * 100).toFixed(0)}%`);
}
console.log(`  ${bankTextInPrompts === 0 ? "PASS" : "FAIL"}  no bank text in any prompt`);
console.log(`  ${attemptOk ? "PASS" : "FAIL"}  refuses during an exam or quiz attempt`);
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : "\nAll measures clear the bar.");
process.exit(failed.length ? 1 : 0);
