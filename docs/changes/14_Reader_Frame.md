# 14 — Reader frame: course header, page navigation, figures and tables list

Three gaps seen on the live site, covering backlog items W1, W10 and W11. Book content and the intake
are not touched.

The spec and the decisions behind it are in [`docs/specs/14_Reader_Frame.md`](../specs/14_Reader_Frame.md).

## What changed

### A course header on every page inside a course

One compact line — **book title · class and term · role**, with the title linking to course home.
Rendered by two new layouts, `src/app/[book]/layout.tsx` and `src/app/teach/[section]/layout.tsx`, so
**every page inside a course gets it without being changed, and a page added later gets it too**.
None of the 26 existing course pages was edited to receive it.

Before this, nothing showed the class term or your role anywhere, and the student Exams page showed a
heading and two buttons with no indication of which book or class it belonged to.

On a phone the title truncates and the subtitle is hidden; the full title stays available as the
link's tooltip and accessible name. It is a `<header>` element, so its content sits inside a banner
landmark.

The header renders nothing when there is no course to name — not signed in, not enrolled, book or
class gone — so each page's own redirects still decide what happens.

### Moving between pages without scrolling

On the reading page only:

- **Side arrows** fixed in the left and right margins, always in view, with the target page's title
  on hover and focus and an accessible name like "Next: Chapter 3, Emerging Technologies".
- **Left and right arrow keys** turn the page. They are ignored while focus is in an input,
  textarea, select or editable area, and while Alt, Ctrl, Meta or Shift is held, so Alt+Left stays
  browser Back.
- **A horizontal swipe** on touch screens, with guards so it does not fire on ordinary scrolling
  (mostly-vertical movement), while zoomed, on multi-touch, or inside a figure or table that scrolls
  sideways of its own.
- **A fixed Previous/Next bar** at the bottom below 1100px, where there is no margin room for the
  arrows. The reading column gains bottom padding so the bar never covers the text.
- **Previous and Next at the top**, beside the existing Back and Course home buttons.
- **The links at the bottom are unchanged**, now with accessible names naming their target.

Every one of these is a real link, so it works without JavaScript; the key and swipe handlers are
conveniences on top. Reduced motion is respected.

### The chapter's figures and tables

A list inside the "In this chapter" panel, or on its own where a chapter has too few sections for
that panel to appear. Each entry shows its number and caption, for example "Figure 4.2: Level-0
diagram for the course registration system".

- The **heading follows what the chapter holds**: "Figures" when it registers no tables, "Figures and
  tables" when it registers any.
- Each figure and table gets a **stable address built from its number** — `#fig-4-2`, `#table-6-1` —
  so a link can be shared and survives a reload. `scroll-margin-top` keeps a fixed header from
  covering the target, and focus moves to it so a screen reader announces where it landed.
- Clicking an entry **briefly highlights** the target. Under reduced motion the highlight is shown
  and left in place rather than animated, so it is still visible.
- **In-text mentions** like "see Figure 4.2" become links to the same target, but only for numbers
  the chapter actually has, and never inside a heading, a link, inline code, a code block or a
  caption.
- On a phone the list collapses behind a **"Figures and tables"** button.
- Nothing is shown when a chapter has neither.

### How tables are numbered — and why no "Table N.M"

**There is no "Table N.M" convention in either book**: the string does not appear once in SAD or
MIS 3000. The numbering lives in each chapter's `manifest.json`, in the `figures[]` registry, whose
entries carry `kind` (`image` or `table`), `number` and `caption`.

So the list shows **whatever a chapter registers as numbered**, whichever kind, labelled as the book
labels it ("Figure 6.1"), with a small **table** tag on table entries. Unregistered tables are
ignored and no number is invented for them.

| | Rendered tables | Registered and numbered | Numbered figures |
|---|---|---|---|
| SAD | 32 | **0** | 48 |
| MIS 3000 | 10 | **9** | 16 |

MIS 3000 numbers its tables in the Figure sequence and its prose calls them "Figure 6.1"; SAD
registers no tables at all. Both are content matters for the Books coordinator, not for this change.

Nothing in the markdown says which `<table>` belongs to which registry entry, so they are matched by
**document order, and only when a chapter's rendered table count equals its registered count**. Where
they differ, none of that chapter's tables is captioned, rather than risk captioning one with
another's number. No chapter trips that today; it is tested with a constructed chapter.

## Accessibility

`npm run test:reader-frame` runs **axe-core in jsdom** over a rendered chapter page, twice: the book's
own HTML alone as a baseline, then the whole page with the header, the "In this chapter" panel and the
figures list around it. Comparing the two attributes every finding.

**The frame adds no violation.** Both runs report the same two, which are the book's own content:

- `heading-order` (moderate) — `<h3 id="c4s1">1. Four Symbols, Used Precisely</h3>`. SAD uses `###`
  for sections directly under the chapter title, so a level is skipped.
- `empty-table-header` (minor) — `<th align="left"></th>`, an empty header cell in a SAD ch04 table.

One finding **was** ours and is fixed: the header's content sat outside any landmark (`region`), so it
is now a `<header>` element.

**What jsdom cannot judge, and so what this does not prove:** it computes no layout and paints
nothing. Colour contrast is explicitly disabled because there is nothing to measure; whether a focus
outline is actually visible, and whether touch targets are big enough, are equally outside its reach;
and live behaviour — focus and scrolling after a jump, the swipe guards, the fixed bar not covering
content — is not exercised at all. Those remain checks by eye in a browser.

## Migration

**None.** Nothing here is persisted: the header is resolved per request from the class and book
already in the database and manifests, and the figure list and addresses are computed at render from
the manifests. No schema change.

## Tests

`npm run test:reader-frame` — 20 assertions over the spec's seven rules: the header's contents for
both roles and with no term; a layout covering every page under both course trees with no route group
escaping it, and a probe page added to the tree needing nothing of its own; previous and next across
every step of both books' spines, including the first and last pages and chapter boundaries, checked
against the plain spine walk; the arrow-key rules, including every modifier and every kind of text
field; a chapter's list being exactly its registered figures in numeric order with each target
present once; addresses derived from numbers; registered tables captioned and unregistered ones left
alone; the counts-disagree guard; in-text links appearing only for figures present and never in
headings or code, checked on constructed markdown and then across six real chapters; a chapter with
nothing showing no list; and the axe pass above.

Two devDependencies were added for this: **axe-core** and **jsdom**. A third, **esbuild**, makes the
suite able to import the real `.tsx` components: Node's type stripping removes TypeScript annotations
but does not transform JSX, so `scripts/test-support/jsx.mjs` compiles components in memory and stubs
`next/link` and `next/navigation`. It is registered only by `register-tsx.mjs`, which only this suite
uses, so the other thirteen suites' loader is unchanged. The pure page-turn rules live in
`src/lib/page-turn.ts` precisely so they can be tested without any of that.

All thirteen existing suites pass unchanged.
