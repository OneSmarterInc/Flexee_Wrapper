# Spec 16 — Table captions, and the Library's integrity check

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 3 October 2026 · Save as `docs/specs/16_Captions_And_Integrity.md` (first commit).
Covers backlog items W14 and W15. A contract change (C1): the Books coordinator owns the caption rule
(Chapter Writing Standard v1.1) and `check_tables.py`; you change only the Wrapper.

## Why

1. **Captions are written but not read.** Books from MIS 4950 onward caption every table with a
   paragraph directly after it, `*Table N.M. Title*` (pandoc's `: Table N.M. Title` is also accepted).
   The reader ignores them: tables get no address, no caption and no place in the "Figures and tables"
   list. The intake never checks that a book built to the rule honours it.
2. **The integrity check never fires.** The intake's content-hash check (a package changed but kept its
   version) compares against `intake.lock.json` in its output folder. In the Library job that folder is
   new on every run, so the check always says "first admission". The standards tell authors that editing
   a file without raising its version is not allowed; the Wrapper isn't enforcing it.
3. **Library-built manifests list images only,** so MIS 3000's nine numbered tables (registered in the
   repository's bundled copy) are probably missing from the live manifests.

## Before writing any code

1. Read how tables are rendered today and how the figures list and the in-text linker are built
   (`src/lib/render.ts`: the figures plugin, the anchors plugin, `figureIndex`, the linker; and the
   reader components). Report.
2. Read `check_tables.py`, read-only, through Drive for Desktop
   (`G:\My Drive\Flexee\Flexee_Standards\Tools\check_tables.py`), including its `--selftest`. Report its
   interface and how it defines a table and a caption. **Recommend one:** pin a copy in the repository the
   way the shared validator is pinned, or port its definition into the intake and test it against the
   same cases. I'll decide at go. Either way, "a table" must mean exactly what the tool means.
3. Read the Library job's publish step. Report whether `intake.lock.json` is uploaded to `live/<book>/`
   today, what the lock contains, and which entries the integrity gate compares (I believe chapters only).
4. **MIS 3000's tables.** Report how its nine numbered tables appear inside the chapter packages (the zip
   contents, under `G:\My Drive\Flexee\Flexee-3000\MIS3000_v1_CURRENT\04_Chapters`), and whether the
   intake could register them from the package. Confirm whether the live manifests list them.
5. **Test the caption pattern on real data before building.** From the MIS 4950 packages
   (`G:\My Drive\Flexee\FiveZero-4950\MIS4950_v1_CURRENT\04_Chapters`), report per chapter the number of
   tables, the captions found by the pattern below, and anything unmatched. The Books coordinator says 61
   tables, all captioned.
6. Propose a plan and list open questions. **Wait for my go before building.**

## What to build

### 1. The reader reads captions

- A pipe table followed **directly** by a paragraph that, after trimming and removing a leading `:` and
  any wrapping `*`, `_` or `**`, matches `^Table (\d+)\.(\d+)\. (\S.*)$` renders as
  `<figure id="table-N-M" class="fx-table"><table>…</table><figcaption>Table N.M. Title</figcaption></figure>`.
  The caption paragraph is consumed, not shown twice. The caption sits below the table. A wide table
  scrolls sideways inside the figure while its caption stays in view.
- Captioned tables join the **"Figures and tables" list** (Spec 14) in document order with the figures,
  labelled "Table N.M". The heading reads "Figures and tables" when the chapter has any table entries.
  Jumping works as for figures.
- **In-text mentions** "Table N.M" become links to `#table-N-M` when that table exists in this chapter,
  never in headings or code, as for figures.
- A table without a caption renders as it does today. The existing fallback (match manifest-registered
  tables by order, only when the counts are equal) stays for books that have no captions.

### 2. The intake checks captions (warn, never stop)

- Only for a book whose register's `Built to` line names `Chapter Writing Standard` at **v1.1 or later**,
  compared numerically (v1.10 is later than v1.9). Any other book gets no table warnings.
- Per chapter, warn about: a table with no caption directly after it; a paragraph beginning "Table"
  directly after a table that doesn't match the pattern; N that isn't the chapter's number; M that doesn't
  run 1, 2, 3 in order; a number used twice. Each warning names the chapter, the table's position, and the
  first words of its header row.
- Add a gate **"Table captions"**: pass with counts ("61 tables, 61 captioned") or warn.
- "A table" is exactly what `check_tables.py` says: a separator row of at least three dashes per column;
  not inside fenced or indented code; a row of empty cells is not a separator.

### 3. The integrity check works in the Library

- Before the check, the Library job downloads `live/<book>/intake.lock.json` from storage, if it exists,
  into the output folder where the gate looks for it. A first run has none: "first admission", as now.
- Publishing writes the lock and uploads it to `live/<book>/` (confirm it does, per report 3; if not, add it).
- The gate **stops** when a chapter package or the front matter has the same version as in the lock but a
  different hash ("content changed but version still vX — bump the version"). Nothing changed: "no content
  changed under an unchanged version".
- Question-bank files carry no version in their names, so for them it only **warns**: a file's hash
  changed while the register version did not.
- A check run never writes to storage. Only publishing updates the lock. An unreadable lock warns and is
  treated as a first admission; it never stops the job.

### 4. MIS 3000's tables

Depends on your report 4. Don't build anything for it until I've decided.

## Rules (tests must prove each)

1. Italic, bold, underscore and colon caption forms each render a figure with id `table-N-M` and a
   figcaption, and the caption paragraph is not shown twice.
2. A paragraph not directly after a table is not a caption; a table without one renders as before.
3. Captioned tables appear in the list in document order with the figures, labelled "Table N.M", and the
   heading becomes "Figures and tables" when the chapter has any.
4. In-text "Table N.M" links only when its target exists, never in headings or code.
5. What counts as a table: pipes inside fenced or indented code are not tables; the separator needs at
   least three dashes per column; a row of empty cells is not a table; escaped pipes and tables with no
   outer pipes are read. If you port the definition, port the tool's self-test cases too.
6. Each of the five intake warnings fires and never stops the intake; none fires for a book not built to
   v1.1 or later; the version comparison is numeric.
7. On the real MIS 4950 packages: every table captioned, no warnings, all in the list. On SAD and
   MIS 3000: no table warnings.
8. Integrity, with a fake storage holding a previous lock: changed chapter content under the same version
   stops the job and publishes nothing; unchanged content passes; changed content with a raised version
   passes; the lock written by a publish is read by the next run; no lock means first admission; an
   unreadable lock warns; changed front matter under the same version stops; a changed bank file under an
   unchanged register version warns.
9. A check run leaves storage unchanged.

## Process

As before: no migration is expected; `docs/changes/16_Captions_And_Integrity.md`, which must list the
exact wording changes the Books coordinator makes afterwards; every suite passes; commits authored as me;
**show me the summary and ask before pushing**; `git pull --rebase` first. Don't edit `Flexee_Standards`
or any book.

## After it ships (not part of this build)

The Books coordinator restores the original "the Wrapper detects it and stops" wording in
`Book_Folder_Standard`, moves the caption and integrity paragraphs in the runbook from "Planned" and
"Known gap" to "Checks", and the author can add MIS 4950 to the library.

## Decisions (3 October 2026)

Answers settled after reading the render pipeline, `check_tables.py`, the Library job, and the real
packages of all three books. Where these differ from the sections above, these win. One of this
spec's own rules is narrowed, and two findings from the reading change what gets built.

### What the reading found

- **MIS 4950: 61 tables, 61 captioned, every one in the italic form.** `check_tables.py --selftest`
  passes 27 of 27, and the per-chapter counts are 3, 4, 4, 6, 6, 5, 6, 6, 5, 5, 6, 5 — exactly the
  Books coordinator's figure, with nothing unmatched. No book uses the colon, bold or underscore
  form anywhere today.
- **`Built to` gates correctly** for all three: SAD does not name the Chapter Writing Standard,
  MIS 3000 names **v1.0**, MIS 4950 names **v1.1**. Only MIS 4950 gets table warnings, and the
  comparison has to be numeric for v1.0 < v1.1 to hold.
- **`live/<book>/intake.lock.json` is already uploaded** by a publish — confirmed by logging the live
  keys during a real publish, not by reading the code alone. Only the download side is missing.
- **The lock holds three kinds of entry**: `chNN` (package, version, sha256), `front-matter` (file,
  version, sha256) and `bank:<file>` (file, sha256, **no version**). The gate named "Version
  integrity (content hash)" compares **chapters only**; the front matter has its own separate gate;
  **bank entries are recorded and never compared**.
- **The intake has never been able to register a table.** A chapter's `figures[]` is built only from
  image references with `"kind": "image"` hardcoded; `"kind": "table"` appears nowhere in the tool.
  MIS 3000's nine entries in the repository's bundled manifests were not produced by it — they carry
  `"src": null`, which the intake never writes, and lack `sourceVersion`, which it always writes.

### 1. Two caption forms, not four

The reader is narrowed to exactly the two forms the standard and `check_tables.py` define:

```
*Table N.M. Title*        the recommended italic form
: Table N.M. Title        pandoc's colon form
```

A **bold or underscore wrapper is not a caption**. The paragraph stays as ordinary text and the
intake warns about it. **Rule 1 and its tests change to match**, so the reader and the gate agree
rather than disagreeing by design. No real book is affected: all 61 captions use the italic form.

### 2. Port the definition, do not pin the tool

Port `check_tables.py`'s table and caption definitions into the intake, together with **all 27 of
its self-test cases**, so a change to the standard makes our copy fail its own tests.

A **parity test** runs the real tool over the MIS 4950 packages and asserts the counts agree. It is
**optional, behind an environment variable** naming those packages, and **skips with a clear message**
when the variable is unset, so the suite still runs on a machine with no Drive.

### 3. Nothing is built for MIS 3000's tables

The Books coordinator will caption its **10** tables in the book's combined revision, and the
register's "9" is corrected then. Until that happens the live book lists images only, which is what
it does today. **The 9-versus-10 correction is recorded in the change note.**

### 4. SAD's empty header cell stays silent

SAD is not built to the Chapter Writing Standard, so no table warning fires for it, including the
empty first header cell in chapter 4 that `check_tables.py` reports.

### 5. A missing chapter heading warns once

`check_tables.py` needs a `# CHAPTER N: Title` heading to number tables. A v1.1-or-later chapter
without one gets **one warning for the chapter** — "cannot check captions: no chapter heading" — not
one warning per table.

### 6. Bank files compare register versions

"A file's hash changed while the register version did not" compares the **previous lock's top-level
`registerVersion`** with the current one. Bank file names carry no version of their own, so there is
nothing else to compare, and it stays a warning.

### 7. Two Spec 14 defects are fixed here

- **The number collision.** `present`, the map the in-text linker consults, is keyed by number
  alone, but a chapter can hold both a Figure 1.1 and a Table 1.1 — MIS 4950's chapter 1 does, and
  its prose mentions all five of its figures and tables. One key overwrites the other, so "see
  Figure 1.1" could link to `#table-1-1`. It cannot bite until captions are parsed, which is why it
  lands here: keyed by kind and number, with the linker choosing by the word it matched.
- **Wide tables.** A table wider than the column needs an **inner scroller**, so the table scrolls
  sideways while its caption stays in view. Overflow on the figure itself would scroll the caption
  away with it.
