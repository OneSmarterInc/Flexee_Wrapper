// Integration test: Spec 21 rule 1 — every chapter of every book has a valid heading outline.
//
// This runs over the real chapters of all three books, not a fixture: SAD and MIS 3000 from the
// repository's content tree, and FZ1003 from a tree the real intake produced. Before the transform
// there were 24 skipped levels across 24 chapters; the point of this suite is that there are none,
// and that nothing else about the chapter moved.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { renderEntry } from "@/lib/render";
import type { EntryManifest } from "@/lib/content";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

/**
 * FZ1003 is not in the repository's content tree — it is admitted to the live library from its
 * packages. Point FZ1003_CONTENT at a tree the intake produced to include it; without that, the
 * suite says so and runs on the two books it has.
 */
const BOOKS: { book: string; root: string; optional?: boolean }[] = [
  { book: "sad", root: "content/sad" },
  { book: "mis3000", root: "content/mis3000" },
  { book: "fz1003", root: process.env.FZ1003_CONTENT || "", optional: true },
];

const H = /<h([1-6])\b([^>]*)>/g;

function skipsIn(levels: number[]) {
  const bad: string[] = [];
  if (levels.length && levels[0] !== 1) bad.push(`starts at h${levels[0]}`);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) bad.push(`h${levels[i - 1]} -> h${levels[i]} at heading ${i + 1}`);
  }
  return bad;
}

type Chapter = { book: string; entry: string; levels: number[]; ids: string[]; manifest: EntryManifest; html: string };
const chapters: Chapter[] = [];
const seen: string[] = [];

for (const b of BOOKS) {
  if (!b.root || !existsSync(b.root)) {
    if (b.optional) {
      console.log(`SKIP ${b.book} — set FZ1003_CONTENT to a tree the intake produced, for example:`);
      console.log(`       python3 tools/flexee_intake.py --book-id fz1003 --local "G:/My Drive/Flexee/FiveZero-4950/FZ1003_v1_CURRENT" --out /tmp/fz --validator tools/build_questions.py`);
      console.log(`       python3 tools/flexee_intake.py --book-id fz1003 --out /tmp/fz --approve`);
      console.log(`       FZ1003_CONTENT=/tmp/fz/fz1003 npm run test:headings`);
      continue;
    }
    throw new Error(`${b.book}: no content at ${b.root}`);
  }
  seen.push(b.book);
  for (const entry of readdirSync(b.root).filter((d) => /^ch\d+$/.test(d)).sort()) {
    const manifest = JSON.parse(readFileSync(path.join(b.root, entry, "manifest.json"), "utf8")) as EntryManifest;
    const markdown = readFileSync(path.join(b.root, entry, manifest.content), "utf8");
    const { html } = await renderEntry(markdown, manifest, `/api/asset/${b.book}/${entry}`);
    const tags = [...html.matchAll(H)];
    chapters.push({
      book: b.book, entry, manifest, html,
      levels: tags.map((m) => Number(m[1])),
      ids: tags.map((m) => /id="([^"]+)"/.exec(m[2])?.[1]).filter(Boolean) as string[],
    });
  }
}
console.log(`\n${chapters.length} chapters from ${seen.join(", ")}`);

await t("every chapter has exactly one h1, and it comes first", () => {
  for (const c of chapters) {
    const h1s = c.levels.filter((l) => l === 1).length;
    assert.equal(h1s, 1, `${c.book}/${c.entry}: ${h1s} h1 elements`);
    assert.equal(c.levels[0], 1, `${c.book}/${c.entry}: starts at h${c.levels[0]}`);
  }
});

await t("no chapter skips a heading level", () => {
  const broken: string[] = [];
  for (const c of chapters) {
    const bad = skipsIn(c.levels);
    if (bad.length) broken.push(`${c.book}/${c.entry}: ${bad.join("; ")}  (${c.levels.join("")})`);
  }
  assert.deepEqual(broken, [], `\n      ${broken.join("\n      ")}`);
});

await t("sibling sections sit at the same level", () => {
  // In SAD and FZ1003 the numbered sections (###) and "Case Study" / "Review Questions" (##) are
  // the same thing written two ways. After the transform they must be siblings, so a chapter's
  // top-level sections are all at one level.
  for (const c of chapters) {
    const sectionLevels = new Set<number>();
    for (const s of c.manifest.sections) {
      const m = new RegExp(`<h([1-6])[^>]*id="${s.id}"`).exec(c.html);
      assert.ok(m, `${c.book}/${c.entry}: no heading carries the id ${s.id}`);
      sectionLevels.add(Number(m![1]));
    }
    assert.equal(sectionLevels.size <= 1, true,
      `${c.book}/${c.entry}: the manifest's sections render at ${[...sectionLevels].join(" and ")}`);
    if (sectionLevels.size) {
      assert.equal([...sectionLevels][0], 2, `${c.book}/${c.entry}: sections should be h2`);
    }
  }
});

await t("every section id is unchanged, and still on a heading", () => {
  for (const c of chapters) {
    const expected = c.manifest.sections.map((s) => s.id);
    for (const id of expected) {
      assert.ok(c.ids.includes(id), `${c.book}/${c.entry}: ${id} is not on a heading`);
    }
    assert.equal(new Set(c.ids).size, c.ids.length, `${c.book}/${c.entry}: a duplicate heading id`);
  }
});

await t("the 'In this chapter' list is unchanged, in order", () => {
  // The list is built from manifest.sections, which the transform never touches. This asserts the
  // headings still agree with it, in reading order, so the two cannot drift.
  for (const c of chapters) {
    const order = c.manifest.sections.map((s) => s.id);
    const onPage = c.ids.filter((id) => order.includes(id));
    assert.deepEqual(onPage, order, `${c.book}/${c.entry}: the sections render out of order`);
  }
});

await t("a book already written with h2 sections is left exactly as it was", () => {
  const mis = chapters.filter((c) => c.book === "mis3000");
  assert.ok(mis.length >= 14, "MIS 3000's chapters are in the set");
  for (const c of mis) {
    assert.deepEqual([...new Set(c.levels)].sort(), [1, 2],
      `${c.entry}: expected only h1 and h2, got ${c.levels.join("")}`);
  }
});

await t("the two books that skipped a level now close it, and keep their subsections", () => {
  for (const book of ["sad", "fz1003"]) {
    const set = chapters.filter((c) => c.book === book);
    if (!set.length) continue;
    for (const c of set) {
      assert.ok(!c.levels.includes(3) || c.levels.includes(2),
        `${book}/${c.entry}: an h3 with no h2 above it`);
    }
    // FZ1003 has #### subsections; they must survive as h3 rather than being flattened.
    if (book === "fz1003") {
      assert.ok(set.some((c) => c.levels.includes(3)), "the subsections are still a level down");
    }
  }
});

await t("the transform is a pure function of the shape, on cases the books do not have", async () => {
  // Built from markdown rather than asserted in the abstract, so this exercises the real plugin.
  const cases: [string, string, string][] = [
    ["already valid", "# T\n\n## A\n\ntext\n\n### A1\n\ntext\n\n## B\n\ntext\n", "1232"],
    ["h2 with real subsections", "# T\n\n## A\n\n### A1\n\n### A2\n\n## B\n", "12332"],
    ["a lone h1", "# T\n\ntext\n", "1"],
    ["no headings at all", "just a paragraph\n", ""],
    ["h1 then h4", "# T\n\n#### A\n\n#### B\n\n##### B1\n\n## C\n", "12232"],
    ["SAD's shape", "# T\n\n### 1. A\n\n### 2. B\n\n## Case Study\n\n## Review Questions\n", "12222"],
    ["FZ1003's shape", "# T\n\n### 1.1 A\n\n#### A1\n\n### 1.2 B\n\n## Case Study\n", "12322"],
  ];
  for (const [name, md, want] of cases) {
    const manifest = { id: "x", book: "x", kind: "chapter", number: 1, title: "T", version: 1,
      contentHash: "x", content: "c.md", sections: [], figures: [], schemaVersion: 2 } as unknown as EntryManifest;
    const { html } = await renderEntry(md, manifest, "/api/asset/x/x");
    const got = [...html.matchAll(H)].map((m) => m[1]).join("");
    assert.equal(got, want, `${name}: got ${got || "(none)"}, expected ${want || "(none)"}`);
  }
});

console.log(`\n${passed} checks passed over ${chapters.length} real chapters`);
