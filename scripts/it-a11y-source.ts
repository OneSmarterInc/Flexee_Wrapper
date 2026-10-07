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

function hits(re: RegExp, skipTokens = false) {
  const found: string[] = [];
  for (const { p, s } of files) {
    if (skipTokens && p.endsWith("globals.css")) continue;   // the token blocks hold the real hexes
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

t("the red and the green are tokens, not literals written out again", () => {
  // #b4451f appeared 43 times in 29 files and #2a7d3f 11 times. Neither was redefined for dark, so
  // the red sat at 2.79:1 on a dark panel and the green at 3.01:1 — and neither could be fixed in
  // one place. They are --danger and --ok now; test:a11y-colour computes both schemes.
  const found = hits(/#b4451f|#2a7d3f/i, true);
  assert.deepEqual(found, [], `\n      ${found.join("\n      ")}`);
});

t("a colour is never written as a bare hex outside the token blocks", () => {
  // The exceptions are deliberate and few: #fff and #08111f are the two label colours a filled
  // button carries, and rgba() shadows are not colour pairs anybody reads text against. Anything
  // else means a colour that cannot follow the theme.
  const allowed = /#(?:fff|ffffff|08111f)\b/i;
  const found: string[] = [];
  for (const { p, s } of files) {
    if (p.endsWith("globals.css")) continue;      // the token blocks are where hexes belong
    s.split("\n").forEach((line, i) => {
      // A colour is never written straight after a word character. "go-github#3708" is an issue
      // reference, not a four-digit hex, and flagging it taught nobody anything.
      for (const m of line.matchAll(/(?<![\w])#[0-9a-fA-F]{3,8}\b/g)) {
        if (!allowed.test(m[0])) found.push(`${p}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(found, [], `\n      ${found.join("\n      ")}`);
});

t("there is one focus ring, it is never switched off without a replacement", () => {
  const globals = files.find((f) => f.p.endsWith("globals.css"))!.s;
  assert.match(globals, /:focus-visible[ ]*[{][^}]*outline: 3px solid var[(]--focus[)]/,
    "globals.css should declare the one ring");
  // outline: none is allowed only where the next line gives the element a ring of its own.
  const offenders: string[] = [];
  for (const { p, s } of files) {
    const lines = s.split("\n");
    lines.forEach((line, i) => {
      if (!/outline:[ ]*(none|0)\b/.test(line)) return;
      const near = lines.slice(i, i + 3).join(" ");
      if (!/focus-visible/.test(near) && !/focus-visible/.test(lines.slice(Math.max(0, i - 3), i + 1).join(" "))) {
        offenders.push(`${p}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `\n      ${offenders.join("\n      ")}`);
});

t("a reader who asks for less motion gets it over everything, not rule by rule", () => {
  const css = files.find((f) => f.p.endsWith("ui-polish.css"))!.s;
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.notEqual(at, -1, "no reduced-motion block");
  const block = css.slice(at, css.indexOf("}", css.indexOf("transition-duration", at)));
  for (const want of ["*,", "animation-duration", "transition-duration", "scroll-behavior"]) {
    assert.ok(block.includes(want), `the catch-all does not set ${want}`);
  }
});

t("a target is at least 44px wherever one is set", () => {
  // 2.75rem at the 16px root is 44px. A min-height written smaller than that on something clickable
  // is the thing this catches — the narrow-screen rule used to shrink every button to 43.2px.
  const found: string[] = [];
  for (const { p, s } of files) {
    if (!p.endsWith(".css")) continue;
    s.split("\n").forEach((line, i) => {
      const m = /min-(?:height|width):[ ]*([0-9.]+)rem/.exec(line);
      if (!m) return;
      const px = Number(m[1]) * 16;
      const clickable = /nav-button|button|catalog input|roster-check|fx-list-toggle|checkbox-label/;
      if (clickable.test(line) || clickable.test(s.slice(0, s.indexOf(line)).split("\n").slice(-6).join(" "))) {
        if (px < 44) found.push(`${p}:${i + 1}  ${m[1]}rem = ${px}px  ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(found, [], `\n      ${found.join("\n      ")}`);
});

console.log(`\n${passed} checks passed`);
