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
            properties: { className: ["fx-figure"] },
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

export async function renderEntry(
  markdown: string,
  manifest: EntryManifest,
  assetBase: string,
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(anchorsPlugin(manifest.sections))
    .use(figuresPlugin(manifest.figures, assetBase))
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}
