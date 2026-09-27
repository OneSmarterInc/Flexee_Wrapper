import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getToc, getEntry } from "../src/lib/content.ts";
import { renderEntry } from "../src/lib/render.ts";

const css = readFileSync("src/app/globals.css", "utf8");
const CONTENT = process.env.CONTENT_DIR || path.join(process.cwd(), "content");

function page(inner: string, theme = "light") {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
  body{min-height:100vh} .theme-toggle,.progress{display:none}</style></head><body>${inner}</body></html>`;
}

// ---- Reading view: the real render pipeline ----
const { book, items } = await getToc("mis3000");
const { manifest, markdown } = await getEntry("mis3000", "ch05");
let article = await renderEntry(markdown, manifest, "/api/asset/mis3000/ch05");
// inline the real figure so the preview is self-contained
const png = readFileSync("content/mis3000/ch05/figures/fig-01.png").toString("base64");
article = article.replace(/\/api\/asset\/mis3000\/ch05\/figures\/fig-01\.png/g, `data:image/png;base64,${png}`);

const spine = `<nav class="spine ui" aria-label="Contents"><p class="book-title">${book.title}</p><p class="book-sub">${book.subtitle ?? ""}</p><ol>${
  items.map((it) => `<li><a href="#" ${it.ref === "ch05" ? 'aria-current="page"' : ""}>${it.kind === "chapter" && it.number != null ? `<span class="num">${it.number}</span>` : ""}${it.title}</a></li>`).join("")
}</ol></nav>`;
const sectionList = `<nav class="sections" aria-label="In this chapter"><h2>In this chapter</h2><ol>${manifest.sections.map((s: any) => `<li><a href="#${s.id}">${s.title}</a></li>`).join("")}</ol></nav>`;
const reading = `<div class="shell">${spine}<main class="reading"><div class="reading-inner"><article>${sectionList}${article}</article><nav class="entry-nav ui"><a class="prev"><span class="dir">Previous</span><span class="t">Back</span></a><a class="next"><span class="dir">Next</span><span class="t">Continue</span></a></nav></div></main></div>`;

// ---- Catalog ----
const catalog = `<main class="catalog"><h1>Flexee Reader</h1><p class="ui" style="color:var(--muted)">Signed in as Ada Student · <a href="#">Teaching</a></p>
<form class="ui" style="display:flex;gap:.5rem;margin:1rem 0 2rem"><input placeholder="Join a section with a code" style="padding:.45rem .6rem;border:1px solid var(--rule);border-radius:6px;background:var(--panel);color:var(--ink)"><button style="padding:.45rem .6rem;border:1px solid var(--link);border-radius:6px;background:transparent;color:var(--link)">Join</button></form>
<div class="book-card"><div class="t">Analysis and Design of Information Systems</div><div class="s">MIS 3250</div><div class="ui" style="margin-top:.8rem"><a href="#">Open →</a></div></div>
<div class="book-card"><div class="t">Introduction to MIS</div><div class="s">MIS 3000</div><div class="ui" style="margin-top:.8rem"><button style="padding:.35rem .8rem;border:1px solid var(--link);border-radius:6px;background:transparent;color:var(--link)">Enroll</button></div></div></main>`;

// ---- Login ----
const login = `<main class="catalog" style="max-width:24rem"><h1>Sign in</h1><form class="ui" style="display:grid;gap:.7rem">
<input placeholder="Email" style="padding:.6rem .7rem;border:1px solid var(--rule);border-radius:6px;background:var(--panel);color:var(--ink)">
<input placeholder="Password" type="password" style="padding:.6rem .7rem;border:1px solid var(--rule);border-radius:6px;background:var(--panel);color:var(--ink)">
<button style="padding:.6rem;border:none;border-radius:6px;background:var(--navy);color:#fff">Sign in</button></form>
<p class="ui" style="color:var(--muted);margin-top:1rem">New here? <a href="#">Create an account</a></p></main>`;

// ---- Teaching dashboard ----
const cell = "border:1px solid var(--rule);padding:.45rem .7rem;text-align:left";
const dashboard = `<main class="catalog"><p class="ui"><a href="#">← Teaching</a></p><h1>Fall 2027, Section A</h1><p class="ui" style="color:var(--muted)">Introduction to MIS</p>
<div class="book-card ui"><div class="s">Join code — share with students, or import a roster</div><div style="display:flex;align-items:center;gap:1rem;margin-top:.4rem"><span style="font-size:1.5rem;letter-spacing:.08em;color:var(--navy)">MIS3000-QK7P</span><button style="padding:.3rem .7rem;border:1px solid var(--rule);border-radius:6px;background:transparent;color:var(--muted)">Regenerate</button><a href="#">Import roster (CSV) →</a></div></div>
<div class="book-card ui" style="display:flex;justify-content:space-between;align-items:center"><div><div class="t" style="font-size:1rem">Content</div><div class="s">1 update available to review</div></div><a href="#">Manage →</a></div>
<h2 style="color:var(--navy);margin-top:1.6rem">Roster</h2><p class="ui" style="color:var(--muted)">3 students · 1 instructor · 1 invited</p>
<table class="ui" style="width:100%;border-collapse:collapse;font-size:.9rem"><thead><tr><th style="${cell}">Name</th><th style="${cell}">Email</th><th style="${cell}">Role</th><th style="${cell}"></th></tr></thead><tbody>
<tr><td style="${cell}">Prof. Grace Okoro</td><td style="${cell}">grace@uni.edu</td><td style="${cell}">instructor</td><td style="${cell}"></td></tr>
<tr><td style="${cell}">Bob Ramirez</td><td style="${cell}">bob@uni.edu</td><td style="${cell}">student</td><td style="${cell}"><a style="color:#b4451f">Remove</a></td></tr>
<tr><td style="${cell}">Chen Wei</td><td style="${cell}">chen@uni.edu</td><td style="${cell}">student</td><td style="${cell}"><a style="color:#b4451f">Remove</a></td></tr>
<tr style="color:var(--muted)"><td style="${cell}">Dana Fox</td><td style="${cell}">dana@uni.edu</td><td style="${cell}">invited</td><td style="${cell}">enrols on sign-in</td></tr>
</tbody></table></main>`;

// ---- Content status ----
const contentRow = (t: string, r: string, l: string, up: boolean) => `<tr style="${up ? "background:var(--mark)" : ""}"><td style="${cell}">${t}</td><td style="${cell}">${r}</td><td style="${cell}">${l}</td><td style="${cell}">${up ? '<a href="#">Review &amp; publish →</a>' : '<span style="color:var(--muted)">current</span>'}</td></tr>`;
const content = `<main class="catalog"><p class="ui"><a href="#">← Fall 2027, Section A</a></p><h1>Content</h1><p class="ui" style="color:var(--muted)">This section reads a pinned version of each entry. 1 update available.</p>
<table class="ui" style="width:100%;border-collapse:collapse;font-size:.9rem"><thead><tr><th style="${cell}">Entry</th><th style="${cell}">Reading</th><th style="${cell}">Latest</th><th style="${cell}"></th></tr></thead><tbody>
${contentRow("Preface", "v1", "v1", false)}
${contentRow("What does technology actually change?", "v1", "v1", false)}
${contentRow("What did you inherit?", "v1", "v2", true)}
${contentRow("Reading the money", "v2", "v2 (errata)", false)}
</tbody></table><p class="ui" style="color:var(--muted);margin-top:1rem;font-size:.85rem">Errata are pushed automatically. Feature upgrades wait here for your review.</p></main>`;

// ---- Diff / review ----
const dl = (type: string, v: string) => `<div style="background:${type === "add" ? "rgba(46,160,67,.12)" : type === "del" ? "rgba(180,69,31,.12)" : "transparent"};color:${type === "ctx" ? "var(--muted)" : "var(--ink)"};white-space:pre-wrap"><span style="user-select:none;opacity:.6">${type === "add" ? "+ " : type === "del" ? "- " : "  "}</span>${v}</div>`;
const diff = `<main class="catalog" style="max-width:52rem"><p class="ui"><a href="#">← Content</a></p><h1>What did you inherit?</h1><p class="ui" style="color:var(--muted)">Section reads v1 · latest is v2</p>
<pre class="ui" style="overflow-x:auto;border:1px solid var(--rule);border-radius:8px;padding:1rem;font-size:.82rem;line-height:1.5;background:var(--panel)">${
[["ctx","## The boring thing becomes the business"],["ctx",""],["del","Somewhere in that sequence something quietly changes."],["add","Somewhere in that sequence something quietly changes: the supplier's"],["add","ordering system becomes part of the hospital's purchasing system, and"],["add","that dependence is the point of this chapter."],["ctx",""],["ctx","Take one small example. In an imaginary hospital, the ward requests G17."]].map(([t,v]) => dl(t, v)).join("")
}</pre>
<form style="margin-top:1.2rem"><button class="ui" style="padding:.6rem 1rem;border:none;border-radius:6px;background:var(--navy);color:#fff">Publish v2 to this section</button></form></main>`;

// ---- Roster importer ----
const impCell = "border:1px solid var(--rule);padding:.4rem .6rem;text-align:left";
const sel = (label: string, val: string) => `<label style="display:grid;gap:.2rem;font-size:.82rem;color:var(--muted)">${label}<select style="padding:.35rem;border:1px solid var(--rule);border-radius:6px;background:var(--panel);color:var(--ink)"><option>${val}</option></select></label>`;
const importer = `<main class="catalog"><p class="ui"><a href="#">← Fall 2027, Section A</a></p><h1>Import roster</h1><p class="ui" style="color:var(--muted)">Upload a class-list CSV. Extra columns and blank rows are ignored; correct the column mapping if the guesses are wrong, then review before adding.</p>
<div class="ui" style="display:grid;gap:1rem"><input type="file">
<div style="display:flex;gap:1rem;flex-wrap:wrap">${sel("Email column", "Email Address")}${sel("Name column", "—")}${sel("First name", "First")}${sel("Last name", "Last")}</div>
<p style="color:var(--muted);font-size:.85rem">28 rows parsed · 26 with a valid email will be added.</p>
<div style="max-height:16rem;overflow:auto;border:1px solid var(--rule);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:.85rem"><thead><tr><th style="${impCell}">Email</th><th style="${impCell}">Name</th></tr></thead><tbody>
<tr><td style="${impCell}">bob@uni.edu</td><td style="${impCell}">Bob Ramirez</td></tr>
<tr><td style="${impCell}">chen@uni.edu</td><td style="${impCell}">Chen Wei</td></tr>
<tr><td style="${impCell}">dana@uni.edu</td><td style="${impCell}">Dana Fox</td></tr>
<tr><td style="${impCell}">erin@uni.edu</td><td style="${impCell}">Erin Blake</td></tr></tbody></table></div>
<button style="padding:.55rem 1rem;border:none;border-radius:6px;background:var(--navy);color:#fff;width:fit-content">Add 26 to the roster</button></div></main>`;

const screens: [string, string, number][] = [
  ["Sign in", login, 460],
  ["Catalog — a student's books", catalog, 560],
  ["Reading view — real render: sidebar, section list, figure, table", reading, 760],
  ["Teaching dashboard — join code, roster, content status", dashboard, 720],
  ["Content — per-section version pinning (one update to review)", content, 520],
  ["Chapter diff & publish — review a version before it reaches students", diff, 620],
  ["Roster CSV import — column mapping and preview before commit", importer, 640],
];

const frames = screens.map(([title, inner, h], i) => {
  const doc = page(inner).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  return `<section><h2 class="cap">${i + 1}. ${title}</h2><div class="frame"><iframe loading="lazy" style="height:${h}px" srcdoc='${doc}'></iframe></div></section>`;
}).join("\n");

const gallery = `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flexee Reader — screens</title>
<style>
:root{--pg:#0f1522;--fg:#e7ecf3;--mut:#9aa7bc}
*{box-sizing:border-box} body{margin:0;background:var(--pg);color:var(--fg);font-family:"IBM Plex Sans",system-ui,sans-serif}
header{padding:2.5rem 1.5rem 1rem;max-width:1180px;margin:0 auto}
header h1{font-family:Georgia,serif;font-size:1.9rem;margin:0 0 .3rem}
header p{color:var(--mut);margin:.2rem 0}
.toggle{margin-top:1rem;background:transparent;color:var(--fg);border:1px solid #33405a;border-radius:7px;padding:.4rem .8rem;cursor:pointer;font:inherit}
main{max-width:1180px;margin:0 auto;padding:1rem 1.5rem 5rem}
section{margin:2.2rem 0}
.cap{font-size:.95rem;font-weight:600;color:var(--fg);margin:0 0 .6rem}
.frame{border:1px solid #2a3750;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.35)}
iframe{width:100%;border:0;display:block;background:#fff}
</style></head>
<body><header><h1>Flexee Reader — the screens</h1>
<p>Rendered with the app's real stylesheet and content. The reading view is the actual output of the render pipeline, with a real embedded figure. Interactive behaviour (bookmark resume, live CSV parsing, dark mode) only runs in the running app.</p>
<button class="toggle" id="t">Preview in dark mode</button></header>
<main>${frames}</main>
<script>
let dark=false;
document.getElementById('t').onclick=()=>{dark=!dark;
  document.getElementById('t').textContent = dark ? 'Preview in light mode' : 'Preview in dark mode';
  document.querySelectorAll('iframe').forEach(f=>{try{f.contentDocument.documentElement.dataset.theme = dark?'dark':'light'}catch(e){}});
};
</script></body></html>`;

writeFileSync("/mnt/user-data/outputs/flexee-reader-screens.html", gallery);
console.log("wrote gallery,", (gallery.length/1024|0), "KB");
