import { getEntry } from "../src/lib/content.ts";
import { renderEntry } from "../src/lib/render.ts";

async function check(book: string, entry: string) {
  const { manifest, markdown } = await getEntry(book, entry);
  const html = await renderEntry(markdown, manifest, `/api/asset/${book}/${entry}`);
  const anchors = [...html.matchAll(/<(h[1-6])[^>]*\bid="(c\d+s\d+)"/g)].map((m) => m[2]);
  const figcaps = (html.match(/<figcaption>/g) || []).length;
  const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const tables = (html.match(/<table>/g) || []).length;
  const pending = (html.match(/fx-figure-pending/g) || []).length;
  console.log(`\n== ${book}/${entry} — "${manifest.title}" ==`);
  console.log(`  sections in manifest: ${manifest.sections.length} | anchors assigned: ${anchors.length}`);
  console.log(`  anchors: ${anchors.slice(0, 6).join(", ")}${anchors.length > 6 ? " …" : ""}`);
  console.log(`  <table>: ${tables} | <figure>+caption: ${figcaps} | pending blocks: ${pending}`);
  console.log(`  img src: ${imgs.join(", ") || "(none)"}`);
}

await check("mis3000", "ch05"); // image 5.1 + table 5.2, ## sections
await check("mis3000", "ch06"); // two tables, no images
await check("sad", "ch05");     // ### sections + real image figures
