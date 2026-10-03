# 16 — Table captions, and the Library's integrity check

Backlog items W14 and W15. A contract change (C1): the Books coordinator owns the caption rule
(Chapter Writing Standard v1.1) and `check_tables.py`; only the Wrapper changed here.

The spec and the decisions behind it are in [`docs/specs/16_Captions_And_Integrity.md`](../specs/16_Captions_And_Integrity.md).
**The exact wording changes the coordinator makes afterwards are at the end of this file.**

## What changed

### The reader reads captions

A pipe table followed directly by a caption paragraph now renders as an addressable figure:

```html
<figure id="table-3-1" class="fx-table" tabindex="-1">
  <div class="fx-table-scroll"><table>…</table></div>
  <figcaption>Table 3.1. Title</figcaption>
</figure>
```

Exactly **two caption forms** are accepted, the two the Chapter Writing Standard defines and
`check_tables.py` accepts:

```
*Table N.M. Title*        the recommended italic form
: Table N.M. Title        pandoc's colon form
```

A **bold or underscore wrapper is not a caption**. That paragraph stays as ordinary text, the table
renders as it always did, and the intake warns. This is narrower than the spec first proposed, so
that the reader and the gate agree on what a caption is rather than disagreeing by design. No book
is affected: all 61 MIS 4950 captions use the italic form.

Matching is done against the paragraph's **raw markdown**, not its rendered text, because `*italic*`
and `_underscore_` both become `<em>` once parsed and only the source tells them apart.

"Directly after" means the next element, skipping the whitespace text nodes rehype puts between
blocks — not literally the next node. The caption paragraph is consumed, so it is never shown twice.

Captioned tables join the **"Figures and tables" list** in document order with the figures, labelled
"Table N.M", and jumping works as it does for figures. In-text "Table N.M" becomes a link to
`#table-N-M` when that table is in the chapter, never inside a heading or code.

A chapter that captions its own tables **ignores the Spec 14 manifest fallback** entirely, so a
manifest claim can never contradict a caption. Books with no captions keep the fallback.

### The intake checks captions, and never stops for them

A new gate, **"Table captions"**, warning only. It applies **only** to a book whose register's
`Built to` line names the **Chapter Writing Standard at v1.1 or later**, compared numerically so
v1.0 is earlier than v1.1 and v1.10 is later than v1.9. Any other book gets no table warnings at all.

Per chapter it warns about: a table with no caption directly after it; a paragraph beginning "Table"
that is not a caption; a bold or underscore wrapper; N that is not the chapter's number; M out of
sequence; a number used twice; a caption with no table; and an empty header cell. Each warning names
the chapter, the table's position and the first words of its header row.

A chapter with no `# CHAPTER N: Title` heading gets **one** warning for the chapter — "cannot check
captions: no chapter heading" — not one per table, since without the heading no table can be numbered.

On the three live books: **MIS 4950 reports 61 tables, 61 captioned, no warnings**; MIS 3000 and SAD
get no table warnings, because neither register asks for the check.

### The definition is ported, not pinned

`tools/table_captions.py` is a port of the coordinator's `check_tables.py`. Ported because the intake
already holds each chapter's markdown in memory and needs the findings as separate warnings rather
than as a printed report and an exit code.

Two things guard the port against drift:

- **The tool's own 27 self-test cases** are reproduced in `scripts/it_tables.py` and run against the
  port. A change to the standard makes our copy fail its own tests.
- **A parity run** executes the real `check_tables.py` over the MIS 4950 packages and asserts the
  counts and exit codes agree. It is **optional, behind `MIS4950_PACKAGES`**, and skips with a
  message naming the variable when it is unset, so the suite still runs on a machine with no Drive.

### The integrity check works in the Library

The gate reads `<out>/<book>/intake.lock.json`, and the Library job builds in a fresh temp directory,
so **every run reported "first admission" and the check never fired**. The job now downloads
`live/<book>/intake.lock.json` into that folder before the check.

Publishing already uploaded the lock — confirmed by logging the live keys during a real publish, not
read off the code — so nothing was needed there.

- A chapter package or the front matter with the **same version and a different hash stops** the job.
- A **question-bank file** whose hash moved while the register version did not **warns**: bank file
  names carry no version, so the previous lock's top-level `registerVersion` is what is compared.
- No lock is a genuine first admission. An **unreadable** lock warns, is reported on the upload, and
  is treated as a first admission; it never stops the job.
- **A check run never writes to storage.** Only publishing updates the lock.

### Two Spec 14 defects fixed here

- **A number collision in the in-text linker.** Its map was keyed by number alone, but a chapter can
  hold both a Figure 1.1 and a Table 1.1 — **MIS 4950's chapter 1 does, and its prose mentions
  both** — so one would have linked to the other. Now keyed by word and number, with the linker
  choosing by the word the prose used. This could not bite until captions were parsed, which is why
  it lands here.
- **Wide tables.** The table sits in its own `fx-table-scroll` div, so a wide one scrolls sideways
  while the caption below stays in view. Overflow on the figure would have carried the caption off
  with it.

## MIS 3000's tables — nothing was built

The intake has **never been able to register a table**: a chapter's `figures[]` is built only from
image references, with `"kind": "image"` hardcoded. The nine `kind: "table"` entries in the
repository's bundled MIS 3000 manifests were not produced by it — they carry `"src": null`, which the
intake never writes, and lack `sourceVersion`, which it always writes. So the **live manifests list
images only**, and no Wrapper change would alter that.

**A correction for the register.** `check_tables.py` counts **10** tables in MIS 3000's packages, not
the nine its register states. The nine matches the bundled manifest's entries, not the book. When the
coordinator captions the tables in the book's combined revision, the register's "9" becomes **10**.

Once those 10 tables carry captions, they come in through the path built here, with no further
Wrapper work.

## Migration

**None.** Nothing is persisted that changes shape: manifests and rendering are recomputed by each
intake, and the lock already existed and already shipped.

## Tests

- `npm run test:tables` — **38 cases**. All 27 of `check_tables.py`'s own self-test cases against the
  port; each intake warning firing with the right kind; the no-heading warning firing once per
  chapter rather than once per table; a warning naming the position and header; the numeric version
  comparison including v1.10 against v1.9; the three live books' real `Built to` lines; and the
  optional parity run, which reports "61 tables, 61 captioned — the port agrees with the tool".
- `npm run test:reader-frame` — **27**, five of them new: the two caption forms rendering and bold
  and underscore not; a paragraph one step away not being a caption; captioned tables interleaving
  with figures in numeric order; in-text links going to the right one of a Figure 1.1 and a Table
  1.1; and a caption overriding a manifest claim.
- `npm run test:library` — **22**, nine of them new: the lock's contents; the gate actually comparing
  rather than reporting a first admission; changed chapter content under an unchanged version
  stopping and publishing nothing; a raised version passing; changed front matter stopping; a changed
  bank file warning and admitting; no lock meaning a first admission; an unreadable lock warning; and
  a check run leaving storage untouched.

All sixteen suites pass. The scripts typecheck added in Spec 14 earned its keep here: changing
`FigureEntry` broke two test literals and `npm run typecheck` caught both before anything ran.

## What the Books coordinator changes next

Not part of this build. The Wrapper now does what these say.

**1. `Book_Folder_Standard` — restore the original wording.** The paragraph on editing a file without
raising its version currently hedges, because the Wrapper was not enforcing it. It now is, so restore:

> If a file changes without its version being raised, the Wrapper detects it and stops the intake.

**2. `Wrapper_Intake_Runbook` — move two paragraphs out of "Planned" and "Known gap" into "Checks".**

The caption paragraph, currently under **Planned**, becomes a check:

> **Table captions.** For a book built to the Chapter Writing Standard v1.1 or later, the intake
> reports every table whose caption is missing, malformed, misnumbered or out of sequence. These are
> warnings: they never stop an intake. The gate reads "N tables, M captioned".

The integrity paragraph, currently under **Known gap**, becomes a check:

> **Version integrity.** The intake compares every chapter package and the front matter against the
> hashes recorded at the last admission. A file that changed while its version stayed the same stops
> the intake. A question-bank file that changed while the register version stayed the same warns,
> since bank file names carry no version.

**3. MIS 3000's register — the table count.** When the 10 tables are captioned in the combined
revision, change the Totals row from **9** to **10**. The nine was the bundled manifest's figure, not
the book's.

**4. MIS 4950 can go into the library.** Its register already carries Title and Series rows (Spec 15),
its `Built to` line already names Chapter Writing Standard v1.1, and its 61 tables are all captioned.
Its `00_Front_Matter` lane is still empty, so the title-page check is skipped until an edition is
built.
