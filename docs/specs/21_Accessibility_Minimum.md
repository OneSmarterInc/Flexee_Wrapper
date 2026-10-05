# Spec 21 — The accessibility minimum, and figure descriptions

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 5 October 2026 · Save as `docs/specs/21_Accessibility_Minimum.md` (first commit).
Covers backlog items W6 and W30.

## Why

A public university will expect course materials that a screen-reader user, a keyboard-only user and a low-vision
user can use. What we know from the checks so far: SAD's chapters jump from a first-level heading to a third-level one;
MIS 3000's figure alt text is only "Figure 1.1"; some tables have an empty header cell; and colour contrast, visible
focus and touch-target size have never been checked in a real browser. The books will also gain proper figure
descriptions. This spec makes the Wrapper's own pages sound and lets the books carry real descriptions.

## Before writing any code

1. **Survey.** With the axe harness from Spec 14, run over a broad set of rendered pages: a chapter of each book (SAD and
   MIS 3000 from the library or the packages, MIS 4950 from `G:\My Drive\Flexee\FiveZero-4950`), the course home, exams,
   an exam in progress, assignments, grades, the class list, the import page, sign-in, set-password and the faculty
   pages. **Report the violations by rule and page type.** Say what jsdom cannot judge.
2. **Headings.** Report the heading levels each book's chapters actually produce when rendered, and propose a transform
   that gives every chapter a valid outline (no skipped levels, sibling sections at the same level). Test it on the real
   chapters of all three books. The section ids and the "In this chapter" list must not change.
3. **Contrast.** Read the theme tokens (light and dark) and **report every text and component colour pair that fails**
   4.5:1 for text or 3:1 for interface components, with the ratio.
4. **Real browser.** Report whether a headless-browser run (for example Playwright with axe) is practical here:
   what it adds, what it costs to install and run, and whether it can run against a local production build with
   invented data. **Recommend; I decide.**
5. Propose a plan and any open questions. **Wait for my go before building.**

## What to build

### 1. Heading outlines, in the renderer

- Apply your transform at render time. **No book content changes.** The standard lets a book write teaching sections as
  `###` under a `#` title, and others write `##`. The reader's outline must be valid for both.

### 2. Figure descriptions (the convention the Books chat will follow)

- The **figure number** comes from the file name (`figN_M_…`, already the standard), not from the alt text.
- The **visible caption** comes from the markdown **title attribute** when present, as
  `![description](fig3_1_name.png "Caption text")`. When there is no title attribute, it comes from the alt text as
  today, so every existing book renders exactly as before. **Add a golden test that proves this.**
- A **blockquote that starts "Long description:"** directly after the image becomes a collapsible "Description"
  (a `details` element) under the figure. It is keyboard-operable and read by screen readers.
- The manifest's figure entries carry `alt` and, when present, `description`. The assistant's citations keep working.
- The intake **warns, never stops,** for a figure with no alt text, or with alt text that only repeats "Figure N.M".

### 3. Tables

- Rendered tables use real header cells with `scope`. The intake **warns on an empty header cell for every book**, not only
  those built to Chapter Writing Standard v1.1, because that is an accessibility fault whatever the book's age.

### 4. The Wrapper's own pages

- A **skip link** to the main text, landmarks on every page (header, navigation, main), exactly one `h1` per page, a
  language on the document, and a distinct page title per page ("Exams — <book> — Flexee").
- Visible focus on every interactive element, at least 3:1 against its surroundings. Touch targets at least 44 by 44
  pixels for the page arrows, the fixed Previous and Next bar, buttons and checkboxes.
- Fix every colour pair your survey reports as failing, in both themes.
- **Forms** (sign-in, set-password, import, the class list): every field labelled, errors tied to their fields and
  announced, and the right `autocomplete` values (`username`, `current-password`, `new-password`).
- Respect `prefers-reduced-motion` everywhere you animate.

### 5. A manual check script

- Write `docs/accessibility/manual-checks.md`: a 30-minute script a person runs with a free screen reader (NVDA) and the
  keyboard only. It covers sign-in, set-password, a chapter with a figure and a table, an exam, an assignment and the
  class list. It lists what to listen for, and where to record a failure.

## Rules (tests must prove each)

1. For every chapter of the three books, the rendered heading sequence has no skipped level, and the "In this chapter"
   list and the section ids are unchanged.
2. A figure's number comes from its file name; its caption from the title attribute when present, else the alt text; a
   book with no title attributes renders identically to today (golden test); a long description renders as a
   collapsible under the right figure and is operable by keyboard.
3. The intake warns, and never stops, on missing alt text, on alt text that is only "Figure N.M", and on an empty table
   header cell, for books of any age.
4. Every text and component colour pair in both themes meets the ratio, tested from the tokens.
5. Every page has a skip link that works, landmarks, one `h1`, a language, and a distinct title.
6. The forms have labelled fields, errors tied to fields and announced, and the right `autocomplete` values.
7. The axe run over the page set from the survey reports **no serious or critical violations**. State what it cannot judge.
8. If a real-browser run is approved, it passes on the same set. If not, say so plainly and list what remains for the
   manual script.

## Process

As before: `docs/changes/21_Accessibility_Minimum.md`; every suite passes; commits authored as me; **show me the summary and
ask before pushing**; `git pull --rebase` first. Don't run anything against the live database. No real student data in
the repository.

## After it ships (not part of this build)

I (or a colleague) run the manual script with NVDA. The Books coordinator authors figure descriptions to the convention
and re-uploads. Descriptions are not added to any book until this has landed.

## Decisions (5 October 2026)

Settled after the four reports. MIS 4950 was measured by running the real intake read-only from
`FZ1003_v1_CURRENT` into a temp tree — every gate passed (61 tables all captioned, 10 figures, 323
questions, register 0.62) — so the survey used true manifests rather than guesses.

### Report 1 — the axe survey: 30 pages, 21 violations, 5 rules

| Impact | Rule | Nodes | Where |
|---|---|---|---|
| **critical** | `label` | 4 | faculty gradebook (score inputs), CSV import (`<input type="file">`) |
| **critical** | `select-name` | 2 | faculty assignments, assignment detail (`<select name="kind">`) |
| **serious** | `label-title-only` | 4 | faculty gradebook, faculty exams (`title` is not a label) |
| moderate | `heading-order` | 2 | sad/ch06, fz1003/ch05 |
| minor | `empty-table-header` | 9 | sad/ch06, and four Wrapper tables' actions column |

**That last row under-counts the books — see the correction at the end of this section.** axe ran
over one rendered chapter per book, so SAD's share of those nine nodes is ch06's alone.

Nineteen of thirty pages are clean, including **every student page** — course home, exams, an exam
in progress, assignments, grades, simulations, my classes — and **every auth form**, with and
without an error. MIS 3000's chapter is clean. The faults cluster in the faculty pages, which have
never had an axe pass: Spec 14 covered the reader and Spec 20 the assistant panel.

**What jsdom cannot judge**, and so what the survey says nothing about: colour contrast as
composited, whether focus is visible, touch-target size, focus order in practice, whether a
dialog's focus trap holds, `prefers-reduced-motion`, and anything needing scroll or a real event
loop.

### Report 2 — headings

| Book | Chapters | Rendered sequence | Chapters with a skipped level |
|---|---|---|---|
| SAD | 12 | `1 3 3 3 3 … 2 2` | **12 of 12** |
| MIS 3000 | 14 | `1 2 2 2 …` | 0 — already valid |
| fz1003 | 12 | `1 3 3 4 3 4 … 2 2` | **12 of 12** |

SAD and fz1003 write numbered teaching sections as `###` and their two unnumbered ones ("Case
Study", "Review Questions") as `##`, which arrive **after** all the `###` ones — so those are the
same level written two ways. A blanket shift would be wrong, and so would treating the `h3`s as
subsections.

**The transform:** look at the headings before the first `h2`; if the shallowest is `h3` or deeper,
shift every heading at or below that level up to close the gap, leaving shallower ones alone.
Tested on the real chapters of all three books: **38 chapters, 24 skips before, 0 after**, MIS 3000
untouched, and the section ids present on their headings in all 38 — they attach by title, not by
level.

### Report 3 — the colour pairs that fail

**Light:** success `#2a7d3f` on `--mark` at **4.39:1** (needs 4.5); `--rule` as a *control* border
at 1.11–1.29:1 (needs 3).

**Dark, 11 pairs, one of them serious:** white on `--navy` in the 23 inline
`background: var(--navy), color: #fff` buttons — in dark mode `--navy` is `#e3ebff`, giving
**1.19:1**. Then danger `#b4451f` at 2.79–3.31:1 and success `#2a7d3f` at 3.01–3.57:1 on every
surface, because both are light-theme literals used unchanged in dark mode: 43 and 11 call sites
across 29 files. `--rule` as a control border is 1.21–1.44:1.

The CSS class `.nav-button.primary` is already correct — it uses `--link` and flips its text to
`#08111f` in dark mode. Only the inline styles are broken.

### Report 4 — a real browser

It is the only way to reach contrast as composited, visible focus, target size, the focus trap,
focus order and reduced motion. The obstacle is the database: the app talks to Postgres through
`postgres-js`, `next start` cannot be served by PGlite, and this machine has neither Docker nor
`psql`. Recommended and approved as an **opt-in local script**, not in CI.

### The decisions

1. **`npm run a11y:browser` is approved, opt-in and local, with two guards.** It must point at a
   **separate empty database, never a branch of the live one** — a branch copies real accounts. It
   **refuses to run if the database holds any account it did not create itself**. It prints the host
   and requires `--yes`. The change note says how to create the empty database.
2. **The intake's figure-alt warnings are summarised per category**, with counts and the first few
   figures, not one line per figure.
3. **A separate `--field-border` token at 3:1 for controls**; `--rule` stays the decorative divider.
4. **The colour work is two commits.** First the 23 white-on-navy buttons move onto the existing
   class. Then `--danger` and `--ok` arrive and the literals go. **A test fails if those literals
   reappear in `src`.**
5. **Empty `<th>` cells get visually-hidden text.**
6. **Page titles:** `<Page> — <class name> — Flexee` on course pages, using the class's name and
   **never a course code**; `<Chapter title> — <Book title> — Flexee` on reader pages;
   `Sign in — Flexee` and the like elsewhere.
7. **SAD's empty table header cells are listed for the Books coordinator** in the change note.
   There are **seven, across four chapters** — ch04, ch05, ch06 (two places) and ch07 — not the one
   the survey saw. Each is listed with its chapter, its line and the header row as written.

### Corrected after the build

Two figures above were wrong. Both were caught by the suites this spec asked for, which is the
argument for them; both are restated here so the spec is not a record of the mistake.

- **SAD has seven empty table header cells, across four chapters**, not one. Report 1 ran axe over
  one rendered chapter per book; `test:figure-alt` scans every chapter's markdown of every book.
  They are ch04 line 63, ch05 line 143, ch06 lines 84 (three blanks in one row) and 141, and ch07
  line 21 — all of them a comparison table whose corner cell is empty.
- **MIS 3000 has sixteen figures whose alt text is only "Figure N.M", and none with empty alt
  text.** The survey reported "25 figures — 16 number-only, 9 empty". The nine were its nine
  **table** entries in the manifest, which have no image and therefore no alt text at all. The
  book has sixteen images, and every one of them warns. SAD's 48 and MIS 4950's 10 are clean.
