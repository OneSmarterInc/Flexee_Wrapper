import { getBook, getEntry } from "../src/lib/content.ts";
import { renderEntry } from "../src/lib/render.ts";
const book = await getBook("sad");
let ok = 0, bad: string[] = [];
for (const s of book.spine) {
  const { manifest, markdown } = await getEntry("sad", s.ref);
  const { html } = await renderEntry(markdown, manifest, `/api/asset/sad/${s.ref}`);
  const anchors = (html.match(/\bid="c\d+s\d+"/g) || []).length;
  const figs = (html.match(/<figure/g) || []).length;
  const good = anchors === manifest.sections.length && figs === manifest.figures.length;
  good ? ok++ : bad.push(`${s.ref}: anchors ${anchors}/${manifest.sections.length}, figures ${figs}/${manifest.figures.length}`);
}
console.log(`meta: ${book.meta} | default entry: ${book.defaultEntry} | admitted from register v${(book as any).admittedFromRegister}`);
console.log(`rendered ${ok}/${book.spine.length} chapters with every section anchor and figure resolved`);
if (bad.length) console.log("problems:\n" + bad.join("\n"));
