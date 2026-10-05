// Spec 21 rule 5: every colour pair the site actually puts together, computed from the tokens.
//
// The point of computing rather than asserting is that the figures cannot go stale. Change a token
// in globals.css and this suite recomputes every pair it takes part in; there is no table of
// expected numbers to forget to update. WCAG 1.4.3 wants 4.5:1 for text, 1.4.11 wants 3:1 for the
// boundary of a control or a focus ring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

// ------------------------------------------------------------------ relative luminance and ratio

function channel(v: number) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string) {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** WCAG 2.x contrast ratio, 1 to 21. */
function ratio(a: string, b: string) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

t("the ratio is computed correctly on pairs with a known answer", () => {
  // Black on white is 21:1 exactly, and the other two are the figures WCAG's own examples give.
  assert.equal(Number(ratio("#000000", "#ffffff").toFixed(2)), 21);
  assert.equal(Number(ratio("#ffffff", "#ffffff").toFixed(2)), 1);
  assert.equal(Number(ratio("#777777", "#ffffff").toFixed(2)), 4.48);
  assert.equal(Number(ratio("#f0f", "#ff00ff").toFixed(2)), 1);     // the short form expands
  assert.equal(ratio("#112233", "#ffffff"), ratio("#ffffff", "#112233"));
});

// ----------------------------------------------------------------------- the tokens, as declared

const css = readFileSync("src/app/globals.css", "utf8");

/** Every `--name: #hex;` inside the block that starts at the given selector. */
function tokensAfter(selector: string) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `globals.css has no ${selector} block`);
  const open = css.indexOf("{", at);
  let depth = 1, i = open + 1;
  while (depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  const body = css.slice(open + 1, i - 1);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+): *(#[0-9a-fA-F]{3,6})/g)) out[m[1]] = m[2];
  return out;
}

const LIGHT = tokensAfter(":root {");
const DARK = tokensAfter(':root[data-theme="dark"] {');
const DARK_MEDIA = tokensAfter(':root:not([data-theme="light"]) {');

t("the two dark blocks declare the same values", () => {
  // The site has a toggle as well as following the system, so dark mode is written twice. Two
  // copies that drift is the whole reason to check it here rather than trust a careful edit.
  assert.deepEqual(DARK, DARK_MEDIA, "the toggle and the system preference disagree");
});

const SURFACES = ["paper", "panel", "panel-soft", "mark", "figbg"];
const TEXT = ["ink", "muted", "link", "navy", "danger", "ok"];

t("every token a theme needs is declared in both themes", () => {
  for (const name of [...SURFACES, ...TEXT, "rule", "field-border", "focus"]) {
    assert.ok(LIGHT[name], `light mode has no --${name}`);
    assert.ok(DARK[name], `dark mode has no --${name}`);
  }
});

// ------------------------------------------------------------------------------ the pairs, tested

type Row = { pair: string; got: number; want: number };
function report(rows: Row[], theme: string) {
  const bad = rows.filter((r) => r.got < r.want);
  const worst = [...rows].sort((a, b) => a.got - b.got).slice(0, 3);
  console.log(`      ${theme}: ${rows.length} pairs, closest to the line — ` +
    worst.map((r) => `${r.pair} ${r.got.toFixed(2)} (needs ${r.want})`).join(", "));
  assert.deepEqual(bad.map((r) => `${r.pair} = ${r.got.toFixed(2)}, needs ${r.want}`), [],
    `\n      ${bad.map((r) => `${theme}: ${r.pair} = ${r.got.toFixed(2)}, needs ${r.want}`).join("\n      ")}`);
}

for (const [theme, tok] of [["light", LIGHT], ["dark", DARK]] as const) {
  t(`${theme} mode: every text colour reaches 4.5:1 on every surface it can sit on`, () => {
    const rows: Row[] = [];
    for (const fg of TEXT) {
      for (const bg of SURFACES) {
        rows.push({ pair: `--${fg} on --${bg}`, got: ratio(tok[fg], tok[bg]), want: 4.5 });
      }
    }
    report(rows, theme);
  });

  t(`${theme} mode: a control's edge and the focus ring reach 3:1`, () => {
    const rows: Row[] = [];
    for (const fg of ["field-border", "focus"]) {
      for (const bg of SURFACES) {
        rows.push({ pair: `--${fg} on --${bg}`, got: ratio(tok[fg], tok[bg]), want: 3 });
      }
    }
    // The ring is drawn with outline-offset, so it sits on the page beside a filled button rather
    // than on the button's own colour. These are the pairs that follows from, checked explicitly
    // because the offset is the only reason the ring is legible against --link.
    rows.push({ pair: "the ring beside a primary button (--focus on --paper)",
      got: ratio(tok["focus"], tok["paper"]), want: 3 });
    report(rows, theme);
  });
}

t("a filled button's label reaches 4.5:1 on its own background", () => {
  // .nav-button.primary and .nav-button.danger both carry #fff in light and #08111f in dark.
  const rows: Row[] = [];
  for (const [theme, tok, label] of [["light", LIGHT, "#ffffff"], ["dark", DARK, "#08111f"]] as const) {
    for (const surface of ["link", "danger"]) {
      rows.push({ pair: `${theme}: ${label} on --${surface}`, got: ratio(label, tok[surface]), want: 4.5 });
    }
  }
  report(rows, "buttons");
});

/** CSS `color-mix(in srgb, a p%, b)`: a straight per-channel blend of the encoded values. */
function mix(a: string, b: string, p: number) {
  const ch = (h: string) => {
    const n = parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = ch(a), [br, bg, bb] = ch(b);
  const one = (x: number, y: number) => Math.round(x * p + y * (1 - p)).toString(16).padStart(2, "0");
  return `#${one(ar, br)}${one(ag, bg)}${one(ab, bb)}`;
}

t("a warning chip's own text reaches 4.5:1 on the surface it is mixed from", () => {
  // .workspace-status.waiting and .workspace-alert.error are color-mix(in srgb, --danger 10%,
  // --panel) with --danger as the text. Computed here the same way the browser computes it, so a
  // change to the percentage or to --danger is measured rather than eyeballed.
  const css2 = readFileSync("src/app/ui-polish.css", "utf8");
  const m = /color-mix[(]in srgb, var[(]--danger[)] ([0-9]+)%, var[(]--panel[)][)]/.exec(css2);
  assert.ok(m, "the warning surface is no longer mixed from --danger");
  const pct = Number(m![1]) / 100;
  const rows: Row[] = [];
  for (const [theme, tok] of [["light", LIGHT], ["dark", DARK]] as const) {
    const surface = mix(tok["danger"], tok["panel"], pct);
    rows.push({ pair: `${theme}: --danger on ${Number(m![1])}% of it over --panel (${surface})`,
      got: ratio(tok["danger"], surface), want: 4.5 });
  }
  report(rows, "warnings");
});

t("--rule stays the decorative divider it was, and --field-border is the one that carries 3:1", () => {
  // Not a failure to fix: a divider between two rows of a table is not an interface component, and
  // raising it to 3:1 would make every table shout. The check is that the two are different, so a
  // control cannot quietly be given the divider's colour and still look deliberate.
  for (const [theme, tok] of [["light", LIGHT], ["dark", DARK]] as const) {
    const rule = Math.min(...SURFACES.map((bg) => ratio(tok["rule"], tok[bg])));
    const field = Math.min(...SURFACES.map((bg) => ratio(tok["field-border"], tok[bg])));
    console.log(`      ${theme}: --rule ${rule.toFixed(2)} (decorative), --field-border ${field.toFixed(2)}`);
    assert.ok(field >= 3, `${theme}: --field-border is only ${field.toFixed(2)}`);
    assert.notEqual(tok["rule"], tok["field-border"], `${theme}: the two are the same colour`);
  }
});

console.log(`\n${passed} checks passed`);
