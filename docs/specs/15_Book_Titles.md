# Spec 15 — Book titles from the register

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 2 October 2026 · Save as `docs/specs/15_Book_Titles.md` (first commit).
Backlog item W13. A contract change (C1): the Books coordinator updates the register standard and the
registers; you change only the Wrapper.

## Why

Live book titles are wrong. The Library list and the course sidebar show book ids ("SAD", "MIS3000",
"CYBER123"). The cause, found in `tools/flexee_intake.py`: when it writes `book.manifest.json`, `title`
is the previous manifest's title, or else the book id in capitals, and `subtitle` the same. It never
reads a title from anywhere. In the Library job the working folder is fresh, so there is never a
previous manifest, and every book gets its id. The course header (Spec 14) shows the manifest's title,
so it needs a real source: the register.

## Before writing any code

1. Read `tools/flexee_intake.py` where `book.manifest.json` is written, how the register is parsed (both
   layouts), and the "Imprint on the pages" check, including how it normalises text. **Report which
   manifest fields are carried forward from a previous manifest, and why.**
2. Find every place the manifest's title or subtitle is shown or used: the Library list, the upload form,
   the course header, the sidebar, the course home heading, anything else.
3. Read the three registers, read-only, through Drive for Desktop, and **report what each has today for
   Title, Subtitle and Series** (a table row, text under the table, or nothing):
   - `G:\My Drive\Flexee\Flexee-SAD\MIS3250_v2_CURRENT\STATE_OF_RECORD.md`
   - `G:\My Drive\Flexee\Flexee-3000\MIS3000_v1_CURRENT\STATE_OF_RECORD.md`
   - `G:\My Drive\Flexee\FiveZero-4950\MIS4950_v1_CURRENT\STATE_OF_RECORD.md`
4. Propose a plan and list open questions. **Wait for my go before building.**

## What to build

### 1. The register carries the title

The imprint table in §0 gains rows: **Title** (the book's own title), **Subtitle** (optional) and
**Series** (optional). For example, MIS 3000: Title "Technology and the Organization", Subtitle "An
Introduction to Management Information Systems", Series "Five Zero Books". Never split a title at a colon
automatically.

### 2. The intake writes the manifest from it

- `title`, `subtitle` and `series` in `book.manifest.json` come from those rows. The register is the only
  source: **remove the carry-forward of title and subtitle from a previous manifest.** It never worked in
  the Library job, and it would let an old value outlive the register.
- No Title row: a **warning**, never a stop ("the register has no Title row; the book will show its
  id"). Fall back to the id in capitals, as now.
- Read the rows from both register layouts and from Drive-escaped text. Rows the intake doesn't know
  about stay ignored.

### 3. The title must match the title page

Extend the "Imprint on the pages" check: the title-page front matter must contain the register's Title
(and Subtitle, when given), compared after the same normalisation the imprint check uses (whitespace,
case, emphasis marks, curly quotes). Missing means **stop**, as for a wrong publisher. Skip the check when
the register has no Title row, since that case already warns.

### 4. Where it shows

Nothing new to build: the Library list, the course header, the sidebar and the course home read the
manifest. Confirm each shows "Title: Subtitle" when there is a subtitle and the title alone when there is
not. The Library list showing ids (backlog W2) should disappear; tell me if it doesn't.

## Rules (tests must prove each)

1. A register with Title, Subtitle and Series rows produces a manifest holding exactly those values.
2. The register's Title replaces any title in a previous manifest.
3. No Title row: a warning, the manifest title is the id in capitals, and the intake never stops for it.
4. Title absent from the title page stops the intake; the same title with different emphasis, case or
   spacing passes.
5. Subtitle is optional: none given gives a null subtitle, and the header shows the title alone.
6. The Library job, end to end: a zipped shelf whose register has the rows publishes a manifest with
   those values.
7. Both register layouts and the Drive-escaped form read the rows.

## Process

As before: no migration is expected; `docs/changes/15_Book_Titles.md`, including the exact rows the
registers need; every suite passes; commits authored as me; **show me the summary and ask before
pushing**; `git pull --rebase` first. Do not edit anything in `Flexee_Standards` or in the books.

## After it ships (not part of this build)

The Books coordinator adds Title, Subtitle and Series rows to SAD's register (v6.20) and MIS 3000's
(v1.8) and to the register template. Both books are then re-uploaded through the Library, and the real
titles go live. Spec 13's drafted announcements read the manifest, so they will use the real titles too.

## Decisions (2 October 2026)

Answers settled after reading the intake, the places a title is shown, and the three registers.
Where these differ from the sections above, these win. Two of this spec's own premises were wrong
and are corrected here.

### The three registers, as they stood when this was written

None was ready, and all three differed:

| Register | Title | Subtitle | Series |
|---|---|---|---|
| SAD `MIS3250_v2_CURRENT` v6.19 | **nothing** - no row, no prose; the title phrase appears nowhere in the file | nothing | **nothing** |
| MIS 3000 `MIS3000_v1_CURRENT` v1.1 | **prose under the table, wrapped across two lines**, not a row | - (the one string holds both halves) | row: `Five Zero Books` |
| MIS 4950 `MIS4950_v1_CURRENT` v0 | **row already present**: `Managing Information Technology Projects` | nothing | row: `Five Zero Books` |

MIS 4950 already has the row in the right place and format, so it shows the intended shape.
MIS 3000's title is prose, so `cell("Title")` will not see it; the coordinator types rows regardless.

### 1. SAD's title

**"Analysis and Design of Information Systems"**, no subtitle, Series **"Five Zero Books"** (SAD is
the series' first title). It matches the front matter's H1, so the title-page check will pass.

### 2. Legacy registers return no title

The rows are read in the **modern parser only**. The legacy parser has no imprint table at all - it
scrapes prose - so it returns no title, which falls into the documented warning path. All three live
registers use the modern parser, so nothing in use is affected.

### 3. A new `fold()`, scoped to the title check

**Correction to this spec's premise:** it said to compare "after the same normalisation the imprint
check uses". No such normalisation exists. The imprint check is a raw substring test against the
undecorated front matter, and the only normaliser in the file, `clean()`, is applied to the
*register* text when parsing and strips just backslashes and `**`.

So a `fold()` is written: case, whitespace, `*` and `_` emphasis marks, backslashes, and curly quotes
folded to straight. It is used by the **new title check only**. Publisher, author, editor and year
keep matching exactly as they do today, so this spec cannot change whether an existing book passes.

### 4. No front matter means no title-page check

Skip the title-page check when the shelf has no front matter, using the existing warn path, so a book
with no edition built yet - MIS 4950 today, whose `00_Front_Matter` lane is empty - is not blocked.
The title is **still written into the manifest** from the register in that case.

### 5. MIS 3000 is split by hand, into two rows

Title **"Technology and the Organization"**, Subtitle **"An Introduction to Management Information
Systems"**, typed as two rows by the coordinator. Nothing splits a title at a colon automatically.
The title page keeping them joined in one H1 is fine: both are found as substrings after folding.
The **header supplies the colon** between them.

### 6. Series is stored, not shown

`series` goes into `book.manifest.json` and is displayed nowhere yet.

### 7. The bracketed id stays

The Library list and the upload form print the id in brackets after the title deliberately -
uploaders type ids for new books, so it still earns its place. Real titles end the "SAD (sad)"
reading, which is what W2 was about; redesigning that list is later work.

### Also recorded: what the intake carries forward, and why

**Exactly two fields** come from a previous manifest: `title` and `subtitle`. Everything else is
recomputed each run - `meta` and `copyright` from the register's imprint, `defaultEntry` and `spine`
from the shelf, `admittedFromRegister` from the register version.

The carry-forward existed because nothing else supplied a title. **It never worked in the Library
job**, because that job builds in a fresh `mkdtemp` directory, so no previous manifest is ever found
and every book fell back to `book.upper()`. It is **removed**: the register is the only source, and
an old value must not outlive it. `book.upper()` stays as the no-Title fallback, with a warning.
