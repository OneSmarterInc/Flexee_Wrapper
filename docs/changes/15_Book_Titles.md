# 15 — Book titles from the register

Backlog item W13. Live book titles were wrong: the Library list and the course sidebar showed book ids
("SAD", "MIS3000", "CYBER123"). The register is now the only source of a book's title, and the intake
writes it into `book.manifest.json`.

A contract change (C1): the Wrapper side is done here, and the Books coordinator updates the register
standard and the registers. **The exact rows each register needs are at the end of this file.**

The spec and the decisions behind it are in [`docs/specs/15_Book_Titles.md`](../specs/15_Book_Titles.md).

## Why the titles were wrong

`tools/flexee_intake.py` never read a title from anywhere. Where it writes `book.manifest.json` it
read the **previous manifest at the output path** and carried `title` and `subtitle` forward, falling
back to the book id in capitals:

```python
base = json.loads(prev_book.read_text()) if prev_book.exists() else {}
bm = {..., "title": base.get("title", book.upper()), "subtitle": base.get("subtitle"), ...}
```

Exactly those two fields were carried forward; everything else was recomputed each run. The hack
existed because nothing supplied a title.

**It could never work in the Library job.** That job builds in a fresh `mkdtemp` directory, so no
previous manifest was ever found and every book fell back to `book.upper()`. The bundled copies in
`content/` still read "Introduction to MIS" only because a local run with `--out content` did find one
and copied it forward.

## What changed

### The register carries the title

`parse_register` reads three more rows from the §0 imprint table, by the same `cell()` helper that
already reads Publisher, Author, Editor and Edition:

- **Title** — the book's own title
- **Subtitle** — optional
- **Series** — optional

Nothing splits a title at a colon. A subtitle is its own row or it is absent. Rows the intake does not
know about stay ignored, as before.

The rows are read in the **modern parser only**. The legacy parser has no imprint table at all — it
scrapes prose — so a legacy register yields no title and falls into the warning below. All three live
registers use the modern parser.

### The intake writes the manifest from it

`title`, `subtitle` and `series` come from the register. **The carry-forward is removed**: an old value
must not outlive the register, and it never worked where it mattered. `book.upper()` stays as the
fallback when there is no Title row.

### No Title row warns, and never stops

A new gate, "Title recorded in the register". With a Title it passes and reports the title, subtitle
and series. Without one it **warns**: *"the register has no Title row; the book will show its id
(SAD)"*. The book still goes in.

### The title must match the title page

"Title on the pages" is a new stop, alongside the existing "Imprint on the pages": the register's
Title, and its Subtitle when given, must appear in the front matter.

Both sides are compared after a new `fold()` — case, whitespace, `*` and `_` emphasis marks,
backslashes, and curly quotes folded to straight — because the two are written differently on purpose:
the register bolds its values and the title page sets the title as a heading.

Two deliberate limits:

- **`fold()` is used by this check only.** Publisher, author, editor and year keep matching exactly as
  they always have, so this change cannot alter whether a book that passed before passes now. The
  spec's premise that a shared normaliser already existed was wrong — the imprint check is a raw
  substring test, and the only existing normaliser, `clean()`, applies to register text.
- **The check is skipped when the shelf has no front matter**, using the existing warn path, so a book
  with no edition built yet is not blocked. MIS 4950 is in exactly that state today: a correct Title
  row and an empty `00_Front_Matter` lane. Its title is still written into the manifest.

It is also skipped when the register has no Title row, since that case already warns.

### Where it shows

No new display was needed — every site reads the manifest. Checked, with what each does now:

| Where | Shows |
|---|---|
| **Course header** | `Title: Subtitle`, the colon supplied by the header; the title alone when there is no subtitle |
| **Library list** | `Title: Subtitle` in bold, then the id in brackets |
| **Upload form** | `Title (id) — a new version` |
| **Sidebar** | title and subtitle on their own lines, as that panel is designed |
| **Course home** | title as the `h1`, subtitle beneath it |
| **Faculty section home** | the title |
| **LTI deep-link picker** | title and subtitle on separate lines |
| **`listBooks`** | sorts by title, so ordering follows the real titles |

The colon is used where a title renders on **one line** — the header and the Library list. Where the
design already stacks them on separate lines, they stay stacked; a colon there would be wrong.

**The bracketed id stays** in the Library list and the upload form. Uploaders type ids for new books,
so it still earns its place. Real titles end the "SAD (sad)" reading, which is what W2 was about.

`series` is stored in the manifest and **shown nowhere yet**.

## Migration

**None.** Nothing is persisted: manifests are rewritten by every intake, so the real titles appear as
soon as each book is re-uploaded through the Library.

## Tests

`npm run test:book-titles` — 9 cases over rules 1–5 and 7, each running the real intake against a real
shelf and reading the manifest it stages: the three rows becoming exactly those manifest values; the
register's Title replacing a stale title planted in a previous manifest at the output path; a missing
Title warning, falling back to the id and not stopping; a Title absent from the title page stopping,
and the same title in different case, spacing or emphasis passing; a Subtitle absent from the page also
stopping; Subtitle optional and absent meaning null; and both artifact-table layouts plus the
Drive-escaped form reading the rows. Plus a unit check of `fold()` — that it ignores case, spacing,
emphasis and curly quotes, and that it does **not** fold away a real difference.

`npm run test:library` gains rule 6: the published manifest at `live/sad/book.manifest.json` carries
the register's title and series, not the book id. That is the job that used to produce "SAD" every
time.

The fixture takes an `imprint_rows` argument so a register can be built with any combination of the
three rows, or none.

## The rows each register needs

For the Books coordinator. Add these to the **§0 imprint table**, beside Publisher, Author, Editor and
Edition. Nothing else in the registers changes.

**SAD — `Flexee-SAD/MIS3250_v2_CURRENT/STATE_OF_RECORD.md`** (today: no Title, no Subtitle, no Series)

```
| Title | **Analysis and Design of Information Systems** |
| Series | **Five Zero Books** |
```

No Subtitle row: the book has none. The title matches the front matter's H1, so the new check passes.

**MIS 3000 — `Flexee-3000/MIS3000_v1_CURRENT/STATE_OF_RECORD.md`** (today: Series is a row; the title
is prose under the table, wrapped across two lines, which `cell()` cannot read)

```
| Title | **Technology and the Organization** |
| Subtitle | **An Introduction to Management Information Systems** |
```

The Series row is already there and correct. The prose sentence can stay as a note; it is not read.
The front matter's H1 joins the two with a colon, and both are found as substrings after folding.

**MIS 4950 — `FiveZero-4950/MIS4950_v1_CURRENT/STATE_OF_RECORD.md`** (today: Title and Series rows are
already present and correct)

```
nothing to add
```

Its `00_Front_Matter` lane is empty, so the title-page check is skipped until an edition is built.

Then re-upload each book through the Library and the real titles go live. Spec 13's drafted
announcements read the manifest, so they will use the real titles too.
