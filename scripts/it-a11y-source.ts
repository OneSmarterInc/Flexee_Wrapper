// Spec 21: the colour rules that only a scan of the source can hold.
//
// Contrast is computed from the tokens in scripts/it-a11y-colour.ts. This suite holds the other
// half: that a colour decided once, in a class, has not been written out by hand somewhere else.
// A hand-written colour is not wrong because it looks different — it is wrong because it does not
// change when the theme does, and because the next person copies it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/[.](tsx|ts|css)$/.test(e)) out.push(p.split(path.sep).join("/"));
  }
  return out;
}
const files = walk("src").map((p) => ({ p, s: readFileSync(p, "utf8") }));
console.log(`\nscanning ${files.length} files under src`);

function hits(re: RegExp) {
  const found: string[] = [];
  for (const { p, s } of files) {
    s.split("\n").forEach((line, i) => {
      if (re.test(line)) found.push(`${p}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return found;
}

t("--navy is a text colour, never a button's surface", () => {
  // 23 buttons across 17 files used to set background: var(--navy) with color: #fff inline. They
  // are .nav-button.primary now, which is --link in both themes and flips its text colour in dark.
  // --navy is the heading colour; in dark mode it is near-white, so a white label on it vanishes.
  const found = hits(/(?:^|[ ;{(])(?:background|backgroundColor|background-color)[ ]*:[ ]*["']?var[(]--navy[)]/);
  assert.deepEqual(found, [], `\n      ${found.join("\n      ")}`);
});

t("the primary button's label colour is declared for both themes", () => {
  const css = files.find((f) => f.p.endsWith("ui-polish.css"))!.s;
  assert.match(css, /[.]nav-button[.]primary[ ]*[{][^}]*background: var[(]--link[)]/,
    "the primary button should sit on --link");
  // Both dark-mode spellings, because the site offers a toggle as well as following the system.
  for (const scheme of ['[data-theme="dark"] .nav-button.primary',
                        '[data-theme="light"]) .nav-button.primary']) {
    assert.ok(css.includes(scheme), `no dark override for ${scheme}`);
  }
});

console.log(`\n${passed} checks passed`);
