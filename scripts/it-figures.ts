// Integration test: Spec 21 rules 2 and 3 — figure descriptions and table headers.
//
// Two halves. First the golden: every figure of all three books must render byte for byte as it did
// before this work, because none of them uses a title attribute yet and rule 2's promise is that
// adding the convention changes nothing until a book opts in. Then the new behaviour, built from
// markdown through the real renderer.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { renderEntry, numberFromFileName, anchorFor } from "@/lib/render";
import type { EntryManifest } from "@/lib/content";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const BOOKS = [
  { book: "sad", root: "content/sad" },
  { book: "mis3000", root: "content/mis3000" },
  { book: "fz1003", root: process.env.FZ1003_CONTENT || "", optional: true },
];

function figureMarkup(html: string) {
  return [
    ...html.matchAll(/<figure[^>]*>[\s\S]*?<\/figure>/g),
    ...html.matchAll(/<div class="fx-figure-pending"[^>]*>[\s\S]*?<\/div>/g),
    // A table that Spec 16 turned into a figure is rule 3's business, not rule 2's: `scope` on its
    // header cells is a deliberate change to that markup in this same commit. Image figures are
    // what rule 2 promises are untouched, so they are what the golden holds.
  ].map((m) => m[0]).filter((b) => !b.includes("<table")).join("\n");
}

const rendered: { key: string; html: string; figures: unknown }[] = [];
const skipped: string[] = [];
for (const b of BOOKS) {
  if (!b.root || !existsSync(b.root)) {
    if (b.optional) { skipped.push(b.book); continue; }
    throw new Error(`${b.book}: no content at ${b.root}`);
  }
  for (const entry of readdirSync(b.root).filter((d) => /^ch\d+$/.test(d)).sort()) {
    const manifest = JSON.parse(readFileSync(path.join(b.root, entry, "manifest.json"), "utf8")) as EntryManifest;
    const markdown = readFileSync(path.join(b.root, entry, manifest.content), "utf8");
    const r = await renderEntry(markdown, manifest, `/api/asset/${b.book}/${entry}`);
    rendered.push({ key: `${b.book}/${entry}`, html: r.html, figures: r.figures });
  }
}
if (skipped.length) {
  console.log(`SKIP ${skipped.join(", ")} — set FZ1003_CONTENT to a tree the intake produced:`);
  console.log('       python3 tools/flexee_intake.py --book-id fz1003 --local "G:/My Drive/Flexee/FiveZero-4950/FZ1003_v1_CURRENT" --out /tmp/fz --validator tools/build_questions.py');
  console.log("       python3 tools/flexee_intake.py --book-id fz1003 --out /tmp/fz --approve");
  console.log("       FZ1003_CONTENT=/tmp/fz/fz1003 npm run test:figures");
}
console.log(`\n${rendered.length} chapters rendered`);

// --------------------------------------------------------------------------------- the golden

const golden: Record<string, { figureHtml: string; count: number; figures: string }> =
  JSON.parse(readFileSync("scripts/fixtures/figures-golden.json", "utf8"));

await t("every figure of every book renders exactly as it did before rule 2", () => {
  // The baseline was written by npm run golden:figures from the commit before the figure work.
  // Running that again would rewrite it and prove nothing, which is why there is no --update.
  const drifted: string[] = [];
  let checked = 0, figures = 0;
  for (const r of rendered) {
    const want = golden[r.key];
    if (!want) { drifted.push(`${r.key}: not in the golden — regenerate it deliberately or add the chapter`); continue; }
    const marks = figureMarkup(r.html);
    const count = (marks.match(/<figure|<div class="fx-figure-pending"/g) || []).length;
    const got = createHash("sha256").update(marks).digest("hex");
    if (count !== want.count) drifted.push(`${r.key}: ${count} figures, the golden has ${want.count}`);
    else if (got !== want.figureHtml) drifted.push(`${r.key}: the figure markup changed`);
    const figs = createHash("sha256").update(JSON.stringify(r.figures)).digest("hex");
    if (figs !== want.figures) drifted.push(`${r.key}: the figures list changed`);
    checked++; figures += count;
  }
  assert.deepEqual(drifted, [], `\n      ${drifted.join("\n      ")}`);
  console.log(`      ${figures} figures over ${checked} chapters, unchanged`);
});

// ------------------------------------------------------------------------- the new behaviour

const MANIFEST = {
  id: "x", book: "x", kind: "chapter", number: 1, title: "A chapter", version: 1,
  contentHash: "x", content: "c.md", sections: [], figures: [], schemaVersion: 2,
} as unknown as EntryManifest;

const build = async (md: string, figures: unknown[] = []) =>
  (await renderEntry(md, { ...MANIFEST, figures } as EntryManifest, "/api/asset/x/ch01")).html;

await t("a figure's number comes from its file name", () => {
  assert.equal(numberFromFileName("fig4_2_level0.png"), "4.2");
  assert.equal(numberFromFileName("fig-4-2.png"), "4.2");
  assert.equal(numberFromFileName("fig12_3.svg"), "12.3");
  assert.equal(numberFromFileName("fig_7_11_wide.png"), "7.11");
  // One number is a chapter with no figure in it, or a figure with no chapter: either way there is
  // no "N.M" to make, and inventing one would mint an address a link could not be trusted to reach.
  assert.equal(numberFromFileName("fig-01.png"), null);
  assert.equal(numberFromFileName("diagram.png"), null);
  assert.equal(numberFromFileName("figure_one.png"), null);
});

await t("a file name alone makes the figure addressable, with no manifest entry", async () => {
  const html = await build("# T\n\n![A context diagram](figures/fig4_2_flows.png)\n");
  assert.ok(html.includes(`id="${anchorFor({ kind: "image", number: "4.2" })}"`), html);
  assert.match(html, /id="fig-4-2"/);
  // and a name that gives no number still renders as a figure, just without an address
  const no = await build("# T\n\n![A sketch](figures/sketch.png)\n");
  assert.match(no, /<figure class="fx-figure">/);
  assert.ok(!no.includes("id=\"fig-"), no);
});

await t("the caption comes from the title attribute, and the alt is left to describe the image", async () => {
  const html = await build('# T\n\n![Two queues feeding one clerk, who sends work back](figures/fig3_1_queue.png "Figure 3.1: The clerk as a bottleneck")\n');
  assert.ok(html.includes("<figcaption>Figure 3.1: The clerk as a bottleneck</figcaption>"), html);
  assert.ok(html.includes('alt="Two queues feeding one clerk, who sends work back"'), html);
  // the title is the caption now, so it is not also left on the image as a tooltip
  assert.ok(!html.includes('title="Figure 3.1'), "the title attribute survived onto the img");
});

await t("with no title attribute the caption still comes from the manifest, then the alt", async () => {
  const withManifest = await build("# T\n\n![Figure 3.1](figures/fig3_1_queue.png)\n",
    [{ id: "f1", kind: "image", src: "figures/fig3_1_queue.png", alt: "Figure 3.1",
       caption: "Figure 3.1: The clerk as a bottleneck", number: "3.1" }]);
  assert.ok(withManifest.includes("<figcaption>Figure 3.1: The clerk as a bottleneck</figcaption>"), withManifest);

  const altOnly = await build("# T\n\n![A queue of three people](figures/fig3_1_queue.png)\n");
  assert.ok(altOnly.includes("<figcaption>A queue of three people</figcaption>"), altOnly);
});

await t("a title attribute wins over the manifest's caption, because the author just wrote it", async () => {
  const html = await build('# T\n\n![A queue](figures/fig3_1_queue.png "The clerk as a bottleneck")\n',
    [{ id: "f1", kind: "image", src: "figures/fig3_1_queue.png", alt: "A queue",
       caption: "An older caption from the manifest", number: "3.1" }]);
  assert.ok(html.includes("<figcaption>The clerk as a bottleneck</figcaption>"), html);
  assert.ok(!html.includes("An older caption"), html);
});

await t("a long description becomes a collapsible under its own figure", async () => {
  const md = [
    "# T", "",
    "![Two queues feeding one clerk](figures/fig3_1_queue.png \"Figure 3.1: The bottleneck\")", "",
    "> Long description: Two arrows enter a single box marked Clerk. A third arrow leaves it and",
    "> returns to the first queue, which is how rework is shown.", "",
    "Some prose after it.", "",
    "![A second figure](figures/fig3_2_after.png \"Figure 3.2: After\")", "",
  ].join("\n");
  const html = await build(md);

  // inside the first figure, not the second, and not left as a quotation as well
  const figs = [...html.matchAll(/<figure[^>]*>[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  assert.equal(figs.length, 2, `${figs.length} figures`);
  assert.match(figs[0], /<details class="fx-longdesc">/);
  assert.match(figs[0], /<summary>Description<\/summary>/);
  assert.ok(figs[0].includes("A third arrow leaves it"), figs[0]);
  assert.ok(!figs[1].includes("<details"), "the description landed on the wrong figure");
  assert.ok(!html.includes("<blockquote>"), "the blockquote is shown twice");
  assert.ok(!html.includes("Long description:"), "the marker is still visible");
  assert.ok(html.includes("Some prose after it."), "the prose after it was eaten");

  // <details> and <summary> are operable from the keyboard with no script at all, which is the
  // whole reason for using them rather than a div that a click handler opens.
  assert.ok(!html.includes("onclick"), html);
  assert.ok(!html.includes('tabindex="0"'), html);
});

await t("a blockquote that is not a long description is left alone", async () => {
  const html = await build("# T\n\n![A queue](figures/fig3_1_q.png)\n\n> An ordinary quotation.\n");
  assert.match(html, /<blockquote>/);
  assert.ok(!html.includes("<details"), html);
});

await t("a table's header cells say which direction they head", async () => {
  const md = "# T\n\n| Stage | Who | Days |\n|---|---|---|\n| Analysis | Analyst | 10 |\n| Design | Analyst | 8 |\n";
  const html = await build(md);
  const ths = [...html.matchAll(/<th(?=[ >])[^>]*>/g)].map((m) => m[0]);
  assert.equal(ths.length, 3, ths.join(" "));
  for (const th of ths) assert.ok(th.includes('scope="col"'), th);
});

await t("every table in every real chapter has scope on every header cell", () => {
  const missing: string[] = [];
  let cells = 0;
  for (const r of rendered) {
    for (const table of r.html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
      for (const th of table.match(/<th(?=[ >])[^>]*>/g) ?? []) {
        cells++;
        if (!th.includes("scope=")) missing.push(`${r.key}: ${th}`);
      }
    }
  }
  assert.deepEqual(missing.slice(0, 10), [], `\n      ${missing.slice(0, 10).join("\n      ")}`);
  console.log(`      ${cells} header cells across the three books, all with scope`);
});

console.log(`\n${passed} checks passed`);
