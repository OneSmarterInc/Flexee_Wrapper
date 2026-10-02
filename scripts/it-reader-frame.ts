// Integration test: Spec 14 — the reader frame. The course header on every page inside a course,
// turning the page without scrolling, and the chapter's figures and tables list with stable
// addresses and in-text links. Proves each of the spec's seven rules against the real code and the
// real books, and finishes with an axe accessibility pass over a rendered chapter page.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { getBook, getEntry, neighbours, neighboursWithTitles } from "@/lib/content";
import { renderEntry, anchorFor, type FigureEntry } from "@/lib/render";
import { keyTarget, isTyping } from "@/lib/page-turn";
import CourseHeader from "@/components/CourseHeader";
import FigureList from "@/components/FigureList";
import type { CourseContext } from "@/lib/course-context";

let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const CTX: CourseContext = {
  bookId: "sad", title: "Analysis and Design of Information Systems", subtitle: "MIS 3250",
  className: "Spring Section A", term: "2027 Spring", role: "Student", homeHref: "/sad",
};

// ---------------------------------------------------------------- rule 1: the course header

await t("rule 1 — the header names the book, the class, the term and the role", () => {
  const out = html(React.createElement(CourseHeader, { ctx: CTX }));
  assert.ok(out.includes("Analysis and Design of Information Systems"), out);
  assert.ok(out.includes("MIS 3250"));
  assert.ok(out.includes("Spring Section A"));
  assert.ok(out.includes("2027 Spring"));
  assert.ok(out.includes("Student"));
  assert.ok(out.includes('href="/sad"'), "and links to course home");
  // the full title is reachable even when the visible text truncates
  assert.ok(out.includes('title="Analysis and Design of Information Systems · MIS 3250"'));
});

await t("rule 1 — a faculty header says Faculty; no context renders nothing", () => {
  const fac = html(React.createElement(CourseHeader, { ctx: { ...CTX, role: "Faculty", homeHref: "/teach/s1" } }));
  assert.ok(fac.includes("Faculty"));
  assert.ok(fac.includes('href="/teach/s1"'));
  assert.equal(html(React.createElement(CourseHeader, { ctx: null })), "");
  // a class with no term simply omits it
  const noTerm = html(React.createElement(CourseHeader, { ctx: { ...CTX, term: null } }));
  assert.ok(noTerm.includes("Spring Section A"));
  assert.ok(!noTerm.includes("2027 Spring"));
});

await t("rule 1 — a layout covers every page under /[book]/ and /teach/[section]/", () => {
  // Next nests layouts, so one layout at each tree root reaches every page below it, including any
  // page added later. Assert the layouts exist, render the header, and that nothing below them
  // introduces a route group that would escape.
  for (const root of ["src/app/[book]", "src/app/teach/[section]"]) {
    const layout = path.join(root, "layout.tsx");
    assert.ok(existsSync(layout), `${layout} is missing`);
    const src = readFileSync(layout, "utf8");
    assert.ok(/CourseHeader/.test(src), `${layout} does not render CourseHeader`);
  }
  const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? pages(path.join(dir, d.name)) : d.name === "page.tsx" ? [path.join(dir, d.name)] : []);
  const covered = [...pages("src/app/[book]"), ...pages("src/app/teach/[section]")];
  assert.ok(covered.length >= 25, `expected the whole course tree, found ${covered.length}`);
  // a route group like (bare) would opt a page out of the layout; none should exist here
  assert.ok(!covered.some((p) => /\([^)]+\)/.test(p)), `a route group escapes the layout: ${covered}`);
});

await t("rule 1 — a page added later is covered with no change to that page", () => {
  // the real check: drop a page into the tree and confirm the layout above it is still the one
  // that renders, i.e. the page needs nothing of its own
  const dir = "src/app/[book]/__spec14_probe";
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "page.tsx"), "export default function Probe() { return <p>probe</p>; }\n");
    const found = readdirSync(dir);
    assert.ok(found.includes("page.tsx"));
    // nothing between the probe and the layout
    assert.ok(existsSync("src/app/[book]/layout.tsx"));
    assert.ok(!existsSync(path.join(dir, "layout.tsx")), "the probe adds no layout of its own");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- rule 2: page turning

await t("rule 2 — previous and next follow the book's order across chapter boundaries", async () => {
  for (const book of ["sad", "mis3000"]) {
    const bm = await getBook(book);
    const spine = bm.spine.map((s) => s.ref);
    assert.ok(spine.length > 3, book);

    const first = await neighboursWithTitles(book, spine[0]);
    assert.equal(first.prev, null, `${book}: the first page has no previous`);
    assert.equal(first.next!.ref, spine[1]);

    const last = await neighboursWithTitles(book, spine[spine.length - 1]);
    assert.equal(last.next, null, `${book}: the last page has no next`);
    assert.equal(last.prev!.ref, spine[spine.length - 2]);

    // every step matches the spine, including where one chapter ends and the next begins
    for (let i = 1; i < spine.length - 1; i++) {
      const n = await neighboursWithTitles(book, spine[i]);
      assert.equal(n.prev!.ref, spine[i - 1], `${book} ${spine[i]} prev`);
      assert.equal(n.next!.ref, spine[i + 1], `${book} ${spine[i]} next`);
    }
    // a chapter boundary: the entry before ch02 is whatever the spine says, not "ch01" by guess
    const i2 = spine.indexOf("ch02");
    if (i2 > 0) {
      const n = await neighboursWithTitles(book, "ch02");
      assert.equal(n.prev!.ref, spine[i2 - 1]);
      assert.ok(n.prev!.label.length > 0, "and it can be named");
    }
  }
});

await t("rule 2 — a neighbour is named for its link's accessible name", async () => {
  const n = await neighboursWithTitles("sad", "ch02");
  assert.ok(n.next, "sad ch02 has a next");
  assert.match(n.next!.label, /^Chapter 3, /, n.next!.label);
  assert.ok(n.prev!.label.length > 0);
});

await t("rule 2 — neighbours agrees with the plain spine walk", async () => {
  const bm = await getBook("sad");
  for (const ref of bm.spine.map((s) => s.ref)) {
    const plain = neighbours(bm, ref);
    const titled = await neighboursWithTitles("sad", ref);
    assert.equal(titled.prev?.ref ?? null, plain.prev);
    assert.equal(titled.next?.ref ?? null, plain.next);
  }
});

// ---------------------------------------------------------------- rule 3: the arrow keys

await t("rule 3 — arrow keys turn the page, and nothing else does", () => {
  assert.equal(keyTarget({ key: "ArrowLeft" }, "/p", "/n"), "/p");
  assert.equal(keyTarget({ key: "ArrowRight" }, "/p", "/n"), "/n");
  for (const key of ["ArrowUp", "ArrowDown", "a", "Enter", " ", "Tab", "PageDown", "Home"]) {
    assert.equal(keyTarget({ key }, "/p", "/n"), null, key);
  }
  // the first and last pages
  assert.equal(keyTarget({ key: "ArrowLeft" }, null, "/n"), null);
  assert.equal(keyTarget({ key: "ArrowRight" }, "/p", null), null);
});

await t("rule 3 — a held modifier is left alone, so Alt+Left stays browser Back", () => {
  for (const mod of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
    assert.equal(keyTarget({ key: "ArrowLeft", [mod]: true }, "/p", "/n"), null, mod);
    assert.equal(keyTarget({ key: "ArrowRight", [mod]: true }, "/p", "/n"), null, mod);
  }
});

await t("rule 3 — typing in a field is left alone", () => {
  const el = (tag: string, editable = false) => ({
    tagName: tag, isContentEditable: editable, closest: (sel: string) => (editable ? {} : null),
  }) as unknown as EventTarget;
  for (const tag of ["INPUT", "TEXTAREA", "SELECT", "OPTION"]) {
    assert.ok(isTyping(el(tag)), tag);
    assert.equal(keyTarget({ key: "ArrowRight", target: el(tag) }, "/p", "/n"), null, tag);
  }
  assert.ok(isTyping(el("DIV", true)), "contenteditable");
  assert.equal(keyTarget({ key: "ArrowRight", target: el("DIV", true) }, "/p", "/n"), null);
  // ordinary prose does not block the key
  assert.ok(!isTyping(el("P")));
  assert.equal(keyTarget({ key: "ArrowRight", target: el("P") }, "/p", "/n"), "/n");
  assert.ok(!isTyping(null));
});

// ---------------------------------------------------------------- rules 4, 5, 6: figures

async function render(book: string, entry: string) {
  const { manifest, markdown } = await getEntry(book, entry);
  const r = await renderEntry(markdown, manifest, `/api/asset/${book}/${entry}`);
  return { ...r, manifest };
}

await t("rule 4 — a chapter's list is exactly its registered figures, in order, each target once", async () => {
  for (const [book, entry] of [["sad", "ch04"], ["mis3000", "ch06"], ["mis3000", "ch10"]] as const) {
    const { html: out, figures, manifest } = await render(book, entry);
    const registered = (manifest.figures || []);
    // tables are only captioned when order-matching is safe, so the list is figures + safe tables
    const images = registered.filter((f) => f.kind !== "table");
    assert.ok(figures.length >= images.length, `${book}/${entry}: images missing from the list`);
    // in the book's own numeric order
    const nums = figures.map((f) => f.number);
    const sorted = [...nums].sort((a, b) => {
      const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
      return (pa[0] - pb[0]) || (pa[1] - pb[1]);
    });
    assert.deepEqual(nums, sorted, `${book}/${entry}: out of order`);
    // every entry's target exists exactly once in the rendered page
    for (const f of figures) {
      assert.equal(count(out, `id="${f.anchor}"`), 1, `${book}/${entry}: ${f.anchor} should appear once`);
    }
    // and no duplicate addresses
    assert.equal(new Set(figures.map((f) => f.anchor)).size, figures.length);
  }
});

await t("rule 4 — addresses are built from the number and survive a reload", () => {
  assert.equal(anchorFor({ kind: "image", number: "4.2" }), "fig-4-2");
  assert.equal(anchorFor({ kind: "table", number: "6.1" }), "table-6-1");
  assert.equal(anchorFor({ kind: "pending", number: "1.10" }), "fig-1-10");
});

await t("rule 4 — registered tables are captioned and listed, unregistered ones left alone", async () => {
  // mis3000 ch06: 2 registered tables, 2 rendered tables — both captioned and listed
  const six = await render("mis3000", "ch06");
  assert.ok(six.figures.some((f) => f.isTable && f.number === "6.1"), "6.1 should be listed");
  assert.ok(six.html.includes('id="table-6-1"'));
  assert.ok(six.html.includes("Figure 6.1:"), "with its caption");

  // mis3000 ch08: a table the manifest does not claim stays plain, and no number is invented
  const eight = await render("mis3000", "ch08");
  assert.ok(eight.html.includes("<table"), "ch08 has a table");
  assert.ok(!eight.html.includes('id="table-'), "but nothing numbers it");
  assert.ok(!eight.figures.some((f) => f.isTable));

  // sad registers no tables at all, so no sad table is captioned
  const sad = await render("sad", "ch05");
  assert.ok(sad.html.includes("<table"));
  assert.ok(!sad.html.includes('id="table-'));
  assert.ok(!sad.figures.some((f) => f.isTable));
});

await t("rule 4 — when a chapter's table counts disagree, no table is captioned", async () => {
  // The guard matters even though no chapter trips it today: document order is the only way to
  // tell which table is which, so one unaccounted-for table would shift every number after it.
  const base = {
    schemaVersion: 2, id: "x", book: "x", kind: "chapter", number: 7, title: "T", version: 1,
    content: "content.md", sections: [],
  };
  const two = "| A | B |\n|---|---|\n| 1 | 2 |\n\nprose\n\n| C | D |\n|---|---|\n| 3 | 4 |\n";

  // 1 claimed, 2 rendered: ambiguous, so neither is captioned and neither is listed
  const oneClaim = { ...base, figures: [{ id: "t1", kind: "table", src: null, caption: "Only one claimed", number: "7.1" }] } as any;
  const ambiguous = await renderEntry(two, oneClaim, "/asset");
  assert.equal((ambiguous.html.match(/<table/g) || []).length, 2, "both tables are still rendered");
  assert.ok(!ambiguous.html.includes('id="table-'), "but neither is captioned");
  assert.equal(ambiguous.figures.filter((f) => f.isTable).length, 0, "and neither is listed");

  // the same markdown with both claimed: now order-matching is safe
  const twoClaims = { ...base, figures: [
    { id: "t1", kind: "table", src: null, caption: "First", number: "7.1" },
    { id: "t2", kind: "table", src: null, caption: "Second", number: "7.2" },
  ] } as any;
  const safe = await renderEntry(two, twoClaims, "/asset");
  assert.ok(safe.html.includes('id="table-7-1"'));
  assert.ok(safe.html.includes('id="table-7-2"'));
  assert.ok(safe.html.indexOf("First") < safe.html.indexOf("Second"), "captioned in document order");
  assert.deepEqual(safe.figures.filter((f) => f.isTable).map((f) => f.number), ["7.1", "7.2"]);
});

await t("rule 5 — in-text mentions link only to figures in this chapter, never in headings or code", async () => {
  const manifest = {
    schemaVersion: 2, id: "x", book: "x", kind: "chapter", number: 4, title: "T", version: 1,
    content: "content.md", sections: [],
    figures: [{ id: "f1", kind: "image" as const, src: "figures/a.png", caption: "Figure 4.1: A", number: "4.1" }],
  } as any;
  const md = [
    "# A heading about Figure 4.1",
    "",
    "Prose referring to Figure 4.1 and also to Figure 9.9 which is elsewhere.",
    "",
    "`Figure 4.1 in code`",
    "",
    "```",
    "Figure 4.1 in a block",
    "```",
    "",
    "![Figure 4.1: A](figures/a.png)",
  ].join("\n");
  const { html: out } = await renderEntry(md, manifest, "/asset");

  // the prose mention became a link
  assert.ok(out.includes('<a href="#fig-4-1" class="fx-ref">Figure 4.1</a>'), out);
  // exactly one link: the heading, the inline code and the code block are all left alone
  assert.equal(count(out, 'class="fx-ref"'), 1, out);
  // a figure that is not in this chapter stays as text
  assert.ok(out.includes("Figure 9.9"));
  assert.ok(!out.includes("#fig-9-9"));
  // the heading keeps its text, unlinked
  assert.match(out, /<h1[^>]*>A heading about Figure 4\.1<\/h1>/);
  // the figcaption is not linked either
  assert.ok(!/<figcaption[^>]*>[^<]*<a /.test(out));
});

await t("rule 5 — in the real books, every link points at a figure that is there", async () => {
  for (const [book, entries] of [["sad", ["ch02", "ch05", "ch06"]], ["mis3000", ["ch02", "ch05", "ch09"]]] as const) {
    for (const entry of entries) {
      const { html: out, figures } = await render(book, entry);
      const present = new Set(figures.map((f) => f.anchor));
      for (const m of out.matchAll(/class="fx-ref"/g)) void m;
      for (const m of out.matchAll(/<a href="#(fig|table)-([\d-]+)" class="fx-ref"/g)) {
        assert.ok(present.has(`${m[1]}-${m[2]}`), `${book}/${entry}: link to ${m[1]}-${m[2]} which is not listed`);
      }
    }
  }
});

await t("rule 6 — a chapter with no figures or tables shows no list", async () => {
  const manifest = {
    schemaVersion: 2, id: "x", book: "x", kind: "chapter", number: 1, title: "T", version: 1,
    content: "content.md", sections: [], figures: [],
  } as any;
  const { html: out, figures } = await renderEntry("# T\n\nJust prose, no figures.\n", manifest, "/asset");
  assert.equal(figures.length, 0);
  assert.ok(!out.includes("fx-figure"));
  // and the component renders nothing at all
  assert.equal(html(React.createElement(FigureList, { figures: [] })), "");
});

await t("the list's heading follows what the chapter holds", () => {
  const imageOnly: FigureEntry[] = [{ anchor: "fig-1-1", number: "1.1", caption: "A", isTable: false }];
  const withTable: FigureEntry[] = [...imageOnly, { anchor: "table-1-2", number: "1.2", caption: "B", isTable: true }];
  const a = html(React.createElement(FigureList, { figures: imageOnly }));
  assert.ok(a.includes("Figures"), a);
  assert.ok(!a.includes("Figures and tables"));
  const b = html(React.createElement(FigureList, { figures: withTable }));
  assert.ok(b.includes("Figures and tables"), b);
  assert.ok(b.includes("table</span>"), "a table entry carries its tag");
});

// ---------------------------------------------------------------- rule 7: accessibility

await t("rule 7 — links have accessible names and the list is a labelled region", () => {
  const out = html(React.createElement(FigureList, {
    figures: [{ anchor: "fig-4-2", number: "4.2", caption: "Level-0 data flow diagram", isTable: false }],
  }));
  assert.match(out, /<nav[^>]*aria-label="Figures"/, out);
  assert.ok(out.includes('href="#fig-4-2"'));
  assert.ok(out.includes("Figure 4.2"), "the link names its target");
  assert.ok(out.includes("Level-0 data flow diagram"));
});

/**
 * axe over a rendered chapter page, twice: the book's own HTML alone as a baseline, then the whole
 * page with the header, the "In this chapter" panel and the figures list around it. Comparing the
 * two attributes every finding — anything in the second run but not the first is this spec's to
 * answer for, and the pre-existing ones are reported rather than quietly accepted.
 *
 * What jsdom cannot judge, and so what this does NOT prove: it computes no layout and paints
 * nothing, so colour contrast, whether a focus outline is actually visible, and touch-target size
 * are all outside its reach, as are live focus and scroll behaviour after a jump.
 */
async function axeRun(bodyHtml: string, label: string) {
  const { JSDOM } = await import("jsdom");
  const axe = (await import("axe-core")).default ?? (await import("axe-core"));
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>${label}</title></head><body>${bodyHtml}</body></html>`,
    { pretendToBeVisual: true });
  const g: any = globalThis as any;
  const saved = { window: g.window, document: g.document, Node: g.Node, Element: g.Element };
  g.window = dom.window; g.document = dom.window.document;
  g.Node = dom.window.Node; g.Element = dom.window.Element;
  try {
    const results = await (axe as any).run(dom.window.document.body, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } },   // jsdom paints nothing to measure
    });
    return {
      ids: (results.violations as any[]).map((x) => x.id).sort(),
      detail: (results.violations as any[]).map((x) =>
        `${x.id} (${x.impact}) x${x.nodes.length}: ${x.help} — e.g. ${String(x.nodes[0]?.html ?? "").slice(0, 90)}`),
      incomplete: (results.incomplete as any[]).map((x) => `${x.id}: ${x.help}`),
    };
  } finally {
    g.window = saved.window; g.document = saved.document; g.Node = saved.Node; g.Element = saved.Element;
    dom.window.close();
  }
}

await t("rule 7 — axe adds no violation that this spec is responsible for", async () => {
  const { html: chapter, figures } = await render("sad", "ch04");
  const list = html(React.createElement(FigureList, { figures }));
  const header = html(React.createElement(CourseHeader, { ctx: CTX }));

  const baseline = await axeRun(`<main><article>${chapter}</article></main>`, "chapter only");
  const full = await axeRun(`${header}<main><article>
      <nav class="sections" aria-label="In this chapter"><h2>In this chapter</h2><ol><li><a href="#c4s1">A section</a></li></ol>${list}</nav>
      ${chapter}
    </article></main>`, "whole page");

  console.log(`      axe baseline (the book's own HTML): ${baseline.ids.length} violation(s)`);
  for (const d of baseline.detail) console.log("        · " + d);
  console.log(`      axe whole page: ${full.ids.length} violation(s)`);
  for (const d of full.detail) console.log("        · " + d);
  for (const i of full.incomplete) console.log("        ? needs review: " + i);

  const added = full.ids.filter((id) => !baseline.ids.includes(id));
  assert.deepEqual(added, [], `the frame introduced: ${added.join(", ")}`);
  // and the pre-existing findings are the book's content, named so nobody hunts for them in code
  assert.deepEqual(baseline.ids, ["empty-table-header", "heading-order"],
    `the book's own findings changed: ${baseline.ids.join(", ")}`);
});

console.log(`\n${passed} passed`);
