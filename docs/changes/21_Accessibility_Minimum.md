# 21 — The accessibility minimum, and figure descriptions

Backlog item W28. The spec and the decisions behind it are in
[`docs/specs/21_Accessibility_Minimum.md`](../specs/21_Accessibility_Minimum.md).

A public university's learning platform has to be usable by a student with a screen reader, a
student who cannot use a mouse, and a student who cannot tell red from green. Four things were
wrong, found by survey rather than by reading: **24 of 38 chapters skipped a heading level**, the
colour palette had **54 hand-written literals that were never defined for dark mode**, the Wrapper's
own pages had **eleven unnamed form controls and eight empty table headers**, and **MIS 3000's
sixteen figures describe themselves only as "Figure N.M"**.

Nothing here changes what the Wrapper does. Everything here changes who can use it.

## What the survey found, before anything was built

Six commits, in the order they landed. The figures below are from the four reports in the spec's
Decisions section, except where this file says a report was wrong.

| | Before | After |
|---|---|---|
| Chapters skipping a heading level | 24 of 38 | **0** |
| Colour pairs failing in either theme | 12 | **0**, over 86 computed pairs |
| Pages with a serious or critical axe violation | 7 of 44 | **0** — and 44/44 have no finding at any impact |
| Hand-written colour literals in `src` | 54 in 29 files | **0** |
| Table header cells without `scope` | 320 | **0** |

## Headings

SAD and MIS 4950 write their numbered teaching sections as `###` and their two unnumbered ones —
"Case Study", "Review Questions" — as `##`, which arrive *after* all the `###` ones. So sections that
are siblings in the manifest were two different levels on the page, and a reader moving by heading
was told a level was missing 24 times.

`outlinePlugin` in [`src/lib/render.ts`](../../src/lib/render.ts) looks at the headings before the
first `h2`; if the shallowest of them is `h3` or deeper it lifts every heading at or below that level
by the same amount, floored at `h2`. It runs **after** the anchors plugin, so every id is already
attached and nothing a link points at can move.

It is a pure function of the shape, which is what makes it safe to run over books nobody has read
yet: MIS 3000, already written with `h2` sections, comes out byte for byte as it was, and MIS 4950's
`h4` subsections stay one level below their section rather than being flattened into it.

`test:headings` runs over the **real chapters of all three books** — 38 of them — and checks the
outline, that every manifest section renders at `h2` and still carries its own id, and that the "In
this chapter" list is unchanged and in order.

## Colour

Two commits, so the move and the new colours can be read separately.

**First**, 23 buttons across 17 files that wrote `background: var(--navy); color: #fff` inline.
That is 2.6:1 in light mode, and in dark mode `--navy` is the near-white heading colour, so a white
label on it measured **1.19:1** — invisible. The project already had the answer:
`.nav-button.primary`, on `--link`, with its label colour declared for both schemes. No new colour,
just the existing one applied.

**Then** four tokens. `#b4451f` appeared 43 times in 29 files and `#2a7d3f` eleven times, neither
redefined for dark mode, so the red sat at **2.79:1** on a dark panel and the green at **3.01:1** —
and because they were literals there was nowhere to fix them.

| Token | Light | Dark | What it is for |
|---|---|---|---|
| `--danger` | `#b4451f` (unchanged — it already passed) | `#f2a28a` | an error, a warning, a destructive button |
| `--ok` | `#26713a` (was `#2a7d3f` at 4.39:1, which failed) | `#7fc98f` | a success, a weight that adds up |
| `--field-border` | `#767f91` | `#717f98` | the edge of a control, at 3:1 (decision 3) |
| `--focus` | `#12233f` | `#e3ebff` | the one focus ring |

`--rule` stays the decorative divider at 1.11:1, which is right for a line between two table rows
and was never right for the edge of a text field. The twenty `field` objects and the three control
rules in CSS moved onto `--field-border`; the `cell`, `tag` and `box` objects did not.

**Two more pairs the survey missed**, found by the new source scan rather than by reading:
`.workspace-status.waiting` and `.workspace-alert.error` were a fixed brown on a fixed cream, which
in dark mode is a bright cream chip sitting in a dark page. Both are now
`color-mix(in srgb, var(--danger) 10%, var(--panel))` with `--danger` as the text, so they follow the
theme — 4.77:1 light, 7.03:1 dark.

**One focus ring**, declared once in `globals.css` for `:focus-visible`, with `outline-offset` so it
lands on the page rather than on a filled button whose own colour is close to the ring's. Keyboard
focus only, so a mouse click leaves nothing behind.

**Targets reach 44px.** `.nav-button` gains a `min-width` and goes to `2.75rem` — it was `2.55rem`,
and the narrow-screen rule shrank it further to `2.7rem`. The figure list's toggle and the
catalogue's search box go with it. The roster's checkboxes keep a checkbox's size inside a 44px
label that toggles them; the name stays on the input's `aria-label`, so nothing new is announced.

**Reduced motion** becomes one catch-all over everything, rather than three rules that each had to be
remembered.

## The Wrapper's own 44 pages

- **A skip link** in the root layout, off screen until it has focus. Every page that renders anything
  already had a `<main>`; all 38 of them now carry `id="main"`.
- **Titles.** The root layout holds the template `%s — Flexee`; each page supplies the part in front
  of it through [`src/lib/page-title.ts`](../../src/lib/page-title.ts).

  | | |
  |---|---|
  | a course page | `Gradebook — Spring Section A — Flexee` |
  | a reader page | `Systems Planning — Analysis and Design of Information Systems — Flexee` |
  | anywhere else | `Sign in — Flexee` |

  The class's **own name, never a course code** (decision 6): two sections of MIS 3250 are two
  different classes, and a tab saying "MIS 3250" tells a person with eleven tabs open nothing. The
  suite fails if any title matches a course code.
- **The five axe faults, all eleven instances.** The roster import's file input and the gradebook's
  three score boxes were nameless; the score and weight boxes get an `aria-label` naming the student
  and the column, because a visible label per cell in a grid is absurd and the column heading alone
  is not read on entry. The two `kind` selects and the five number and datetime boxes that had only
  a `title` get a real label. The eight empty `<th>` cells get visually-hidden text (decision 5).
- **The auth forms**, beyond what axe asks: placeholders were doing the work of labels, and a
  placeholder vanishes as soon as you type. Each box gets a visible label and an `autocomplete`
  value — `username`, `current-password`, `new-password`, `name`, `email` — so a password manager
  offers the right thing and never offers a new password where the current one goes.
- **Errors** get an id, `role="alert"`, and `aria-describedby` from each field they concern, so the
  message is read on reaching the box rather than only at the top of the page.

## Figures and tables

The convention the Books chat follows from here on.

- **The number comes from the file name.** `fig4_2_level0.png` is Figure 4.2 whatever the alt text
  says. A name with one number in it — MIS 3000's `fig-01.png` — gives nothing, because there is no
  chapter in the name to make "N.M" from and guessing one would mint an address a link could not be
  trusted to reach; the alt text is read as before.
- **The caption comes from the title attribute** where the author wrote one:
  `![a description of the picture](fig3_1_name.png "Figure 3.1: The caption")`. That frees the alt to
  describe the image instead of repeating the caption. With no title, nothing changes.
- **A blockquote starting `Long description:`** directly after an image becomes a collapsible
  `<details>` under that figure. `details` and `summary` are keyboard-operable and announced as
  expanded or collapsed with no script at all, which is the whole reason for choosing them.
- **Tables** get `scope` on every header cell — `col` in a `thead`, `row` on a `th` that starts a
  body row. Without it a screen reader reading a cell in the middle of a wide table has nothing to
  say the cell is *of*.

**The golden test.** `npm run golden:figures` was run from the commit before the figure work, and
[`scripts/fixtures/figures-golden.json`](../../scripts/fixtures/figures-golden.json) holds a hash of
every image figure's markup and of the figures list, for all 38 chapters: **74 figures, frozen**.
None of the books uses a title attribute yet, so all 74 must render byte for byte as before — and
they do. Running `golden:figures` again would rewrite the baseline and prove nothing, which is why
there is no `--update` flag.

### What the intake warns about now

Two new gates, both **warnings that can never stop an intake**. A book held back for a missing
description leaves the chapter nobody can read at all unreadable by everyone.

- **Figure alt text** — no alt, or alt that only repeats "Figure N.M". Summarised per category with
  counts and the first three (decision 2), never one line per figure.
- **Table header cells** — an empty one, for **every book** whatever standard it was built to,
  because it is an accessibility fault rather than a house-style one.

Run read-only against SAD's and MIS 4950's real packages: every gate passes, and all 58 figure
entries plus every `content.md` come out byte-identical to what the live trees hold, so no anchor
moves and no caption changes.

### For the Books coordinator (decision 7)

**SAD has seven empty table header cells**, across four chapters. Each is a comparison table whose
top-left corner cell is empty, or a header row with blanks in it. The fix is in the chapter's
markdown — give the cell a word, or make it a data cell.

| Chapter | Line | The header row as written |
|---|---|---|
| ch04 | 63 | `| | Physical DFD | Logical DFD |` |
| ch05 | 143 | `| | ERD | Normalization |` |
| ch06 | 84 | `| MIS 3250 — Section 001 | | | |` (three blanks) |
| ch06 | 141 | `| | User interface | Report |` |
| ch07 | 21 | `| | Custom build | Commercial package | Outsource |` |

**MIS 3000's sixteen figures** all describe themselves only as "Figure N.M". A screen reader user
hears the number they can already see and nothing about the picture. The alt text should say what is
*in* the figure; the caption beside it already carries the number and the point. The convention above
is how to write both.

MIS 4950 and SAD are clean on alt text.

## The real-browser run

`npm run a11y:browser -- --yes` — opt-in and local, never in CI. It is the only way to reach contrast
as composited, whether a focus ring is visible, target size, the dialog's focus trap and
`prefers-reduced-motion`. It runs axe with `color-contrast` **enabled**, in both themes and with the
motion preference both ways, and adds in-page checks jsdom cannot make.

**It has not been executed yet.** There is no Postgres and no Chromium on the machine it was written
on, and it is opt-in by design, so what is proven is its two guards —
`npm run test:a11y-guards`, 11 checks — and what it reports the first time somebody runs it is new
information. Playwright is deliberately **not** a dependency: it is a large download, only this
script needs it, and Vercel installs devDependencies to build. The script says how to install it.

### The two guards (decision 1)

1. **A database of its own, named explicitly.** It reads `A11Y_DATABASE_URL`, refuses if that is
   unset or equal to `DATABASE_URL`, prints the host it is about to write to with the credentials
   stripped, and does nothing without `--yes`.
2. **Nothing in it belongs to anybody.** Before it writes, it counts the accounts that it did not
   create itself — everything it makes is named `a11y-browser …` at `@a11y-browser.invalid` — and
   stops if there are any. This is what catches a **branch of the live database**, which guard 1
   cannot: a branch's connection string is a perfectly good one, but a branch copies every real
   account, so the count is never zero. The refusal gives the **count only**; printing a name from a
   database that turned out to be the live one is the very thing the guard exists to prevent.

### How to create the empty database

Either, on Neon — **Create database**, never **Create branch**:

1. Neon console → the Flexee project → **Databases** → **New Database**, named `flexee_a11y`.
2. Copy its connection string. Check the database name at the end of it is `flexee_a11y` and not
   `flexee`.
3. `A11Y_DATABASE_URL="postgresql://…/flexee_a11y" npm run a11y:browser -- --yes`

A **branch** is the wrong thing and guard 2 will stop it: branching copies the live data, including
every student account.

Or locally, with Docker:

```bash
docker run -d --name flexee-a11y -e POSTGRES_PASSWORD=local -p 5433:5432 postgres:16
A11Y_DATABASE_URL="postgresql://postgres:local@localhost:5433/postgres" npm run a11y:browser -- --yes
```

The script applies the migrations itself, with the same `scripts/migrate.ts` Vercel's build runs, so
an empty database is all it needs.

## The manual script

[`docs/accessibility/manual-checks.md`](../accessibility/manual-checks.md): thirty minutes, one
person, a keyboard and NVDA, over sign-in, a set-password invitation, a chapter with a figure and a
table, an exam, an assignment and the class list — then again in dark mode and with reduced motion
on. It says what to listen for and where to write down what was wrong.

Everything in it is something no suite can judge. The suites prove the markup is right; this is the
only thing that asks whether any of it is actually usable.

## Tests

| Suite | Checks | What it holds |
|---|---|---|
| `test:headings` | 8 | the outline over 38 real chapters, plus seven shapes the books do not have |
| `test:a11y-colour` | 10 | 86 pairs computed from the tokens, both themes, including the `color-mix` surfaces |
| `test:a11y-source` | 7 | no literal, no `--navy` background, the ring, the catch-all, a 44px floor, over 158 files |
| `test:a11y-pages` | 10 | axe plus nine things it has no rule for, over all 44 rendered pages |
| `test:figures` | 10 | the golden's 74 figures, the caption order, the collapsible, 320 header cells |
| `test:figure-alt` | 7 | the intake's side: the number, the title attribute, both warnings, the summary |
| `test:a11y-guards` | 11 | the browser run's two guards, including a simulated branch of the live database |

`test:reader-frame`'s axe baseline loses `heading-order`; its one remaining finding is the empty
table header in `sad/ch06` listed above.

Seven sabotages, each run and undone: the old green fails by name and figure; one digit changed in
one dark block fails "the toggle and the system preference disagree"; `outline: none` fails the ring;
putting one button's inline navy pair back fails the source scan by file; deleting the skip link
fails by page name; putting one `title`-only input back fails with the axe rule and the element;
preferring the alt over the manifest caption again fails the golden on eleven chapters.

### What the tests do not judge

- **Anything that needs paint or layout.** jsdom computes neither, so contrast as composited, whether
  a focus ring is visible, target size, focus order in practice, whether the dialog's focus trap
  holds, and `prefers-reduced-motion` are all outside every suite above. The browser run reaches
  them; it has not been run.
- **What a screen reader says.** The markup is checked against what a screen reader *should* be able
  to compute. Whether NVDA and Firefox together actually say something a person can follow is the
  manual script's business.
- **The books' own alt text.** The intake warns; nothing rewrites a book. MIS 3000's sixteen figures
  are still "Figure N.M" until the Books coordinator describes them.
- **A figure's alt that duplicates its caption.** SAD's alt text is the caption word for word, so a
  screen reader reads it twice. That is what the title-attribute convention is for; rewriting SAD's
  markdown is the Books chat's work, not the renderer's.

## Two corrections to my own survey

Both found by the new suites rather than by reading, and both reported here because the spec's
Decisions section records the wrong numbers:

- **SAD has seven empty header cells, not one.** The survey ran axe over a single rendered chapter;
  `test:figure-alt` scans every chapter's markdown. Decision 7 says "SAD's empty table header",
  singular; all seven are listed above.
- **MIS 3000 has sixteen figures with number-only alt and none with empty alt.** The survey said
  "25 figures — 16 alt that is only Figure N.M, 9 empty". The nine were its nine **table** entries in
  the manifest, which have no image and so no alt at all.
