import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toText } from "hast-util-to-text";
import type { EntryManifest, Figure, Section } from "./content";

// Assign each manifest section's stable id (cNsM) to its heading, matched by
// title in reading order. This works whichever heading level a book uses for
// sections (## in MIS, ### in SAD) and survives a heading being reworded only
// if the title in the manifest is updated with it — the id itself never changes.
// normalize so "### 3. A First Model…" (SAD) matches manifest title "A First
// Model…" and "## A fence falls down" (MIS) matches its own title: drop a
// leading enumerator, unify quotes/whitespace, trim trailing punctuation.
// Exported because the assistant's chunker maps a chunk's heading back to the same manifest
// section id (Spec 20), and two normalisers would be two definitions of what a heading is.
//
// The number stripped here must be the number tools/flexee_intake.py removes when it writes the
// manifest title — see SECTION_NUMBER there. "1." and "1)" are SAD's forms, "4.1" and "12.3."
// MIS 4950's. A bare number is not a section number, so "2024 Trends" keeps its year, and the
// trailing space is required, so "1.5x Faster" keeps its measurement.
const SECTION_NUMBER = /^\s*(?:\d+\.(?:\d+\.?)?|\d+\))\s+/;

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(SECTION_NUMBER, "")
    .replace(/\s+/g, " ")
    .replace(/[.,:;—–-]+$/, "")
    .trim();
}

function anchorsPlugin(sections: Section[]) {
  return () => (tree: any) => {
    let ptr = 0;
    visit(tree, "element", (node: any) => {
      if (ptr >= sections.length) return;
      if (/^h[1-6]$/.test(node.tagName)) {
        if (norm(toText(node)) === norm(sections[ptr].title)) {
          node.properties = node.properties || {};
          node.properties.id = sections[ptr].id;
          ptr++;
        }
      }
    });
  };
}

// Turn a bare image paragraph into a <figure> with its manifest caption, and
// rewrite figures/ srcs onto the asset route. Turn any surviving "artwork
// pending" placeholder paragraph into a labelled placeholder block.
function figuresPlugin(figures: Figure[], assetBase: string) {
  const byFile = new Map<string, Figure>();
  for (const f of figures) if (f.src) byFile.set(f.src.split("/").pop()!, f);
  const pendingRe = /^\[Figure\s+(\d+\.\d+):\s*artwork pending[^\]]*\]$/;

  return () => (tree: any) => {
    visit(tree, "element", (node: any, index: number | undefined, parent: any) => {
      if (index === undefined || !parent) return;
      if (node.tagName === "p" && node.children?.length === 1 && node.children[0].tagName === "img") {
        const img = node.children[0];
        const src = String(img.properties?.src || "");
        if (src.startsWith("figures/")) {
          const fig = byFile.get(src.split("/").pop()!);
          img.properties.src = `${assetBase}/${src}`;
          img.properties.loading = "lazy";
          const caption = fig?.caption || String(img.properties.alt || "");
          parent.children[index] = {
            type: "element",
            tagName: "figure",
            // Spec 14: a stable address built from the number, so a link survives a reload, and
            // tabIndex so focus can move here when someone jumps to it.
            properties: fig
              ? { className: ["fx-figure"], id: anchorFor(fig), tabIndex: -1 }
              : { className: ["fx-figure"] },
            children: [
              img,
              { type: "element", tagName: "figcaption", properties: {}, children: [{ type: "text", value: caption }] },
            ],
          };
        }
      } else if (node.tagName === "p") {
        const m = toText(node).trim().match(pendingRe);
        if (m) {
          parent.children[index] = {
            type: "element",
            tagName: "div",
            properties: { className: ["fx-figure-pending"], role: "img", "aria-label": `Figure ${m[1]}, artwork pending` },
            children: [{ type: "text", value: `Figure ${m[1]} — artwork pending` }],
          };
        }
      }
    });
  };
}

// --- Spec 14: stable addresses for figures and tables, and in-text links to them ---

/** The address a figure or table is reachable at: #fig-4-2, #table-6-1. */
export function anchorFor(f: Pick<Figure, "kind" | "number">): string {
  return `${f.kind === "table" ? "table" : "fig"}-${f.number.replace(/\./g, "-")}`;
}

/** Count the tables a chapter's markdown produced, so a manifest claim can be trusted or not. */
function countTables(tree: any): number {
  let n = 0;
  visit(tree, "element", (node: any) => { if (node.tagName === "table") n++; });
  return n;
}

/**
 * Spec 16: a table followed directly by a caption paragraph becomes an addressable figure.
 *
 * "Directly" means the caption is the table's next sibling. The caption paragraph is consumed, so
 * it is not shown twice, and the table goes inside a scroller so a wide one scrolls sideways while
 * its caption stays in view.
 *
 * This runs before the manifest fallback, and reports what it claimed so the fallback leaves those
 * tables alone.
 */
function captionsPlugin(markdown: string, onCaptioned: (claimed: { number: string; title: string }[]) => void) {
  const raw = (node: any) => {
    const p = node?.position;
    return p?.start?.offset != null && p?.end?.offset != null
      ? markdown.slice(p.start.offset, p.end.offset)
      : toText(node);                       // no position: fall back to the rendered text
  };
  return () => (tree: any) => {
    const claimed: { number: string; title: string }[] = [];
    visit(tree, "element", (node: any, index: number | undefined, parent: any) => {
      if (node.tagName !== "table" || index === undefined || !parent) return;
      // rehype puts a "\n" text node between block elements, so "directly after" means the next
      // element, skipping whitespace — not literally children[index + 1].
      let j = index + 1;
      while (j < parent.children.length) {
        const c = parent.children[j];
        if (c.type === "text" && !String(c.value).trim()) { j++; continue; }
        break;
      }
      const next = parent.children[j];
      if (!next || next.type !== "element" || next.tagName !== "p") return;
      const cap = tableCaption(raw(next));
      if (!cap) return;
      parent.children.splice(index + 1, j - index);          // the caption is consumed, not repeated
      parent.children[index] = {
        type: "element", tagName: "figure",
        properties: { className: ["fx-table"], id: `table-${cap.number.replace(".", "-")}`, tabIndex: -1 },
        children: [
          { type: "element", tagName: "div", properties: { className: ["fx-table-scroll"] }, children: [node] },
          { type: "element", tagName: "figcaption", properties: {},
            children: [{ type: "text", value: `Table ${cap.number}. ${cap.title}` }] },
        ],
      };
      claimed.push(cap);
    });
    onCaptioned(claimed);
  };
}

/**
 * Give each table its manifest number and caption, by document order.
 *
 * Only when the chapter's table count matches the manifest's: nothing in the markdown says which
 * table is which entry, so if the counts disagree one of them is unaccounted for and every
 * following table would take the wrong number. In that case none is captioned (Spec 14 decision 3).
 */
function tablesPlugin(figures: Figure[], captioned: () => number, onResolved: (resolved: Figure[]) => void) {
  const claimed = figures.filter((f) => f.kind === "table");
  return () => (tree: any) => {
    if (!claimed.length) { onResolved([]); return; }
    // Spec 16: captions in the markdown win. Where any table carried one, the book is captioning its
    // tables itself and this fallback stays out of the way entirely.
    if (captioned() > 0) { onResolved([]); return; }
    if (countTables(tree) !== claimed.length) { onResolved([]); return; } // ambiguous: caption none
    let i = 0;
    visit(tree, "element", (node: any, index: number | undefined, parent: any) => {
      if (node.tagName !== "table" || index === undefined || !parent) return;
      const f = claimed[i++];
      if (!f) return;
      const caption = f.caption || `Figure ${f.number}`;
      parent.children[index] = {
        type: "element",
        tagName: "figure",
        properties: { className: ["fx-table"], id: anchorFor(f), tabIndex: -1 },
        children: [
          node,
          { type: "element", tagName: "figcaption", properties: {},
            children: [{ type: "text", value: `Figure ${f.number}: ${stripNumber(caption, f.number)}` }] },
        ],
      };
    });
    onResolved(claimed.slice(0, i));
  };
}

/** Captions in the manifest sometimes already lead with the number; don't say it twice. */
function stripNumber(caption: string, number: string): string {
  const re = new RegExp(`^\\s*(?:figure|table)\\s+${number.replace(".", "\\.")}\\s*[:.\\u2014-]\\s*`, "i");
  return caption.replace(re, "").trim() || caption.trim();
}

/**
 * Turn "see Figure 4.2" into a link to that figure, but only for numbers this chapter actually
 * has, and never inside a heading, a link, or code.
 */
function mentionsPlugin(present: Map<string, string>) {
  const SKIP = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "a", "code", "pre", "figcaption"]);
  const re = /\b(Figure|Table)\s+(\d+\.\d+)\b/g;
  return () => (tree: any) => {
    if (!present.size) return;
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (index === undefined || !parent || SKIP.has(parent.tagName)) return;
      const value: string = node.value;
      if (!/\b(Figure|Table)\s+\d+\.\d+/.test(value)) return;
      const out: any[] = [];
      let last = 0;
      for (const m of value.matchAll(re)) {
        // Spec 16: keyed by the word as well as the number. A chapter can hold both a Figure 1.1
        // and a Table 1.1 — MIS 4950's chapter 1 does — so a number alone would send one to the
        // other. The word the prose used decides which is meant.
        const anchor = present.get(`${m[1].toLowerCase()}:${m[2]}`);
        if (!anchor) continue;                                  // not in this chapter: leave as text
        if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index!) });
        out.push({
          type: "element", tagName: "a",
          properties: { href: `#${anchor}`, className: ["fx-ref"] },
          children: [{ type: "text", value: m[0] }],
        });
        last = m.index! + m[0].length;
      }
      if (!out.length) return;
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;                                 // don't revisit what we just made
    });
  };
}

/** What the "In this chapter" list should show: the chapter's numbered figures and tables, in order. */
/**
 * One line of the "Figures and tables" list. `word` is how the book itself names the thing: a
 * captioned table calls itself "Table 3.1", while a book that numbers its tables in the figure
 * sequence (MIS 3000) calls them "Figure 6.1" and relies on the tag to tell them apart.
 */
export type FigureEntry = {
  anchor: string; number: string; caption: string;
  isTable: boolean; word: "Figure" | "Table";
};

// Spec 16: the two caption forms the Chapter Writing Standard defines and check_tables.py accepts.
// A bold or underscore wrapper is deliberately not a caption — that paragraph stays as text and the
// intake warns about it — so the reader and the gate agree on what a caption is.
const CAPTION_ITALIC = /^\*Table (\d+)\.(\d+)\. (\S.*?)\*$/;
const CAPTION_COLON = /^: Table (\d+)\.(\d+)\. (\S.*)$/;

/**
 * The caption a paragraph carries, or null.
 *
 * Matched against the paragraph's **raw markdown**, not its rendered text, because `*italic*` and
 * `_underscore_` both become `<em>` once parsed and only the source tells them apart. That is what
 * lets the reader accept exactly the two forms the standard defines and no more.
 *
 * Exported so the intake's ported copy can be tested against the same function.
 */
export function tableCaption(rawParagraph: string): { number: string; title: string } | null {
  const s = rawParagraph.trim();
  const m = CAPTION_ITALIC.exec(s) || CAPTION_COLON.exec(s);
  return m ? { number: `${m[1]}.${m[2]}`, title: m[3].trim() } : null;
}

export async function renderEntry(
  markdown: string,
  manifest: EntryManifest,
  assetBase: string,
): Promise<{ html: string; figures: FigureEntry[] }> {
  const images = (manifest.figures || []).filter((f) => f.kind !== "table");
  let tables: Figure[] = [];
  let caps: { number: string; title: string }[] = [];
  // Keyed by word and number, so a Figure 1.1 and a Table 1.1 in one chapter stay apart.
  const present = new Map<string, string>(images.map((f) => [`figure:${f.number}`, anchorFor(f)]));

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(anchorsPlugin(manifest.sections))
    .use(figuresPlugin(manifest.figures, assetBase))
    .use(captionsPlugin(markdown, (claimed) => {
      caps = claimed;
      for (const c of claimed) present.set(`table:${c.number}`, `table-${c.number.replace(".", "-")}`);
    }))
    .use(tablesPlugin(manifest.figures || [], () => caps.length, (resolved) => {
      tables = resolved;
      // this fallback's tables are numbered in the book's figure sequence, so the prose calls them
      // "Figure N.M" and that is the word to key them under
      for (const f of resolved) present.set(`figure:${f.number}`, anchorFor(f));
    }))
    .use(mentionsPlugin(present))
    .use(rehypeStringify)
    .process(markdown);

  // in the book's own order, by number
  const fromManifest: FigureEntry[] = [...images, ...tables].map((f) => ({
    anchor: anchorFor(f),
    number: f.number,
    caption: stripNumber(f.caption || f.alt || "", f.number),
    isTable: f.kind === "table",
    word: "Figure" as const,          // this path numbers tables in the figure sequence
  }));
  const fromCaptions: FigureEntry[] = caps.map((c) => ({
    anchor: `table-${c.number.replace(".", "-")}`,
    number: c.number,
    caption: c.title,
    isTable: true,
    word: "Table" as const,
  }));
  const entries = [...fromManifest, ...fromCaptions].sort((a, b) => cmpNumber(a.number, b.number));
  return { html: String(file), figures: entries };
}

function cmpNumber(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
