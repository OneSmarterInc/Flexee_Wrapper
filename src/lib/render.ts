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
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^\s*\d+[.)]\s*/, "")
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
 * Give each table its manifest number and caption, by document order.
 *
 * Only when the chapter's table count matches the manifest's: nothing in the markdown says which
 * table is which entry, so if the counts disagree one of them is unaccounted for and every
 * following table would take the wrong number. In that case none is captioned (Spec 14 decision 3).
 */
function tablesPlugin(figures: Figure[], onResolved: (resolved: Figure[]) => void) {
  const claimed = figures.filter((f) => f.kind === "table");
  return () => (tree: any) => {
    if (!claimed.length) { onResolved([]); return; }
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
function mentionsPlugin(present: Map<string, Figure>) {
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
        const fig = present.get(m[2]);
        if (!fig) continue;                                     // not in this chapter: leave as text
        if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index!) });
        out.push({
          type: "element", tagName: "a",
          properties: { href: `#${anchorFor(fig)}`, className: ["fx-ref"] },
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
export type FigureEntry = { anchor: string; number: string; caption: string; isTable: boolean };

export async function renderEntry(
  markdown: string,
  manifest: EntryManifest,
  assetBase: string,
): Promise<{ html: string; figures: FigureEntry[] }> {
  const images = (manifest.figures || []).filter((f) => f.kind !== "table");
  let tables: Figure[] = [];
  // Images are addressable whatever the markdown does; tables only once order-matching is safe.
  const present = new Map<string, Figure>(images.map((f) => [f.number, f]));

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(anchorsPlugin(manifest.sections))
    .use(figuresPlugin(manifest.figures, assetBase))
    .use(tablesPlugin(manifest.figures || [], (resolved) => {
      tables = resolved;
      for (const f of resolved) present.set(f.number, f);
    }))
    .use(mentionsPlugin(present))
    .use(rehypeStringify)
    .process(markdown);

  // in the book's own order, by number
  const entries = [...images, ...tables].sort((a, b) => cmpNumber(a.number, b.number)).map((f) => ({
    anchor: anchorFor(f),
    number: f.number,
    caption: stripNumber(f.caption || f.alt || "", f.number),
    isTable: f.kind === "table",
  }));
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
