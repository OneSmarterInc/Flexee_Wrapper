# Spec 22 — Library polish: retire a book, dismiss uploads, catalog numbers, clearer reports

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 6 October 2026 · Save as `docs/specs/22_Library_Polish.md` (first commit).
Covers backlog items W2, W29 (the Wrapper's side) and W16, plus two requests from the Books coordinator.
**It must land by early November**, before SAD's revision is uploaded under its catalog number.

## Why

Library ids are becoming catalog numbers (`fz1001` for SAD, `fz1003` for MIS 4950, `fz1002` for MIS 3000 after Spring),
because course codes mean nothing outside Wright State. That leaves old entries (`sad`, the test book `cyber123`, stale
upload records) that nothing can remove. The reports also have rough edges the Books coordinator has hit: a nested duplicate
folder made by Drive was reported as a list of unregistered files, and a GitHub 503 told the user to check settings that
were fine. And the spelling gate misses prefixed words such as "reorganise" and "unauthorised".

## Before writing any code

1. Read the Library pages, actions and the book picker (the class-creation form, the upload form, the faculty lists). Report
   where a retired book must be filtered out, how classes reference a book, and what happens to a class whose book is retired.
2. Reproduce the nested-folder case with a fixture: a folder named `00_Front_Matter` inside the `00_Front_Matter` lane, holding
   a file. Show the report today.
3. Read the spelling patterns and the phrasing scan. Report the British forms they miss, and run the widened patterns
   (below) read-only over the real packages of all three books (SAD and MIS 4950 under `G:\My Drive\Flexee`, MIS 3000 as well).
   **Report the new warning counts per book.**
4. Propose a plan and open questions. **Wait for my go before building.**

## What to build

### 1. Retire a book (admins only)

- An action on the Library's book list. A retired book disappears from the class-creation form, the upload form's dropdown and
  every faculty list. **Classes already using it keep working, unchanged.** A "Retired" section shows it with **Restore**.
- It is soft and reversible. Nothing in storage or the database is deleted.
- Retiring a book that classes use shows the count first ("2 classes use this book; they will keep working").

### 2. Dismiss an upload record

- **Dismiss** on a failed or not-added upload hides it from the list. Records for books already added stay as history.
  A **Dismiss all not added** action shows its count first. Nothing in storage is touched.

### 3. Catalog numbers

- Read the register's optional **Catalog number** imprint row (the form is two letters and four digits, `FZ1003`).
- If present, **the upload id must equal it, lower-cased.** A mismatch **stops** the intake, saying plainly what the id should
  be. A malformed number **warns**.
- Store it in the book manifest as `catalogNumber`.
- **Display** catalog-shaped ids in capitals (`FZ1003`) in the Library list, the upload form and the book pickers. The stored id
  stays lower-case. Other ids display unchanged.

### 4. Clearer reports

- **Nested duplicate folders:** when a subfolder inside a lane has the lane's own name, say once, "a folder named
  `00_Front_Matter` sits inside the lane `00_Front_Matter`; remove or move it", instead of listing its files as unregistered.
  It still stops where it stopped before.
- **A closing line** on every report: what happens next ("Ready to add: click Add to library" or "Stopped: fix the lines marked
  STOP and upload again").
- **Warnings that repeat** are summarised per category, with counts and the first few examples.

### 5. The Library page

- A clear finished state: **"Done: in the library"** with the date and a **Back to library** button, and no leftover
  "Adding the book to the library" line.
- The book list shows the **real title**, the (capitalised) id and the register version.
- A soft warning on the upload form when a file name ends `.zip.zip`.

### 6. GitHub errors

- Starting the intake **retries automatically** (three attempts, with a short wait) on a 5xx answer from GitHub.
- A failed start shows a **Retry** button.
- The message **distinguishes a temporary GitHub problem** (5xx: "GitHub was briefly unavailable; try again") **from a settings problem**
  (401, 403, 404, 422: "ask a developer to check the runner settings"). Never log a token.

### 7. The spelling gate and the phrasing scan

- Allow prefixes (re-, un-, dis-, mis-, over-, under-) so "reorganise" and "unauthorised" are flagged.
- Add the forms the MIS 3000 scan found: fulfil, travelled, totalling, practise, harbour, labour, neighbour, fibre, theatre, cheque.
- The phrasing scan **skips image and figure-caption lines**.
- Warnings only. Report the new counts per book in the change note, and say which books newly warn.

## Rules (tests must prove each)

1. A retired book is absent from every picker, a class using it keeps working, Restore reverses it, and only admins can do it.
2. Dismiss hides failed and not-added records, never an added one, never touches storage, and shows the count for bulk.
3. A register with a Catalog number: a matching upload id passes; a mismatch stops with the right id named; a malformed number warns;
   `catalogNumber` reaches the manifest. A register without the row behaves as today.
4. Catalog-shaped ids display in capitals in the list, form and pickers; the stored id is unchanged; other ids are unchanged.
5. The nested-folder fixture produces one clear message naming the folder and lane, and no per-file "not in the register" lines for
   its contents.
6. Every report ends with the next-step line, and repeated warnings are summarised with counts.
7. A 5xx on starting the intake is retried three times and then shows Retry; a 401, 403, 404 or 422 shows the settings message;
   no token appears in any log.
8. The prefixed and added forms are flagged, caption lines are not scanned for phrasing, and the existing books' results are
   reported.
9. The Library page passes the automated accessibility check used in Spec 14, and the new buttons are keyboard-operable with
   named controls.

## Process

As before: `docs/changes/22_Library_Polish.md`; a migration only if retire needs one (the next number); every suite passes; commits
authored as me; **show me the summary and ask before pushing**; `git pull --rebase` first. Don't run anything against the live
database.

## After it ships (not part of this build)

I retire the old `sad` entry and the test book `cyber123`, and dismiss the stale MIS 4950 upload records. The Books coordinator
uploads SAD's revision as `fz1001`.

## Decisions (5 October 2026)

Settled after the three reports below.

### Report 1 — the Library, the pickers, and what "retired" has to mean

**There is no books table.** `listBooks()` walks the content store and reads each
`book.manifest.json`. Retirement cannot be a column on a book, and it must not be a field in the
manifest either: **the intake overwrites `book.manifest.json` on every re-upload**, so a flag
written there would be silently wiped the next time the book was uploaded. It needs a database row.

**`listBooks()` has two kinds of caller, and they want opposite things.**

| Where | Purpose | A retired book must be |
|---|---|---|
| `admin/page.tsx` — the class-creation `<select name="bookId">` | picker | **absent** |
| `library/page.tsx` — `UploadForm books={…}` | picker | **absent** |
| `lti/select/page.tsx` — "Add this book" | picker | **absent** |
| `ClassBookPanel.tsx` — change a class's book | picker | **absent** |
| `admin/page.tsx`, `faculty/page.tsx`, `student/page.tsx` — `titles.get(c.bookId) ?? c.bookId` | title lookup | **still found** |

Filtering `listBooks()` itself would make every class that uses a retired book show a raw id
instead of its title. So `listBooks()` stays as it is and a second function serves the pickers.

**A class whose book is retired keeps working, and nothing is needed to make that true.**
`sections.book_id` is a plain text column with **no foreign key**, and the reading path never
consults the list — it goes through `getBook(bookId)` and `enrolmentForBook`. Retirement is a
visibility change and nothing else.

### Report 2 — the nested-folder case, reproduced

A copy of SAD's real shelf with `00_Front_Matter/00_Front_Matter/Book_Front_Matter_v1.7.md` added:

```
| Register ↔ Drive, every entry | **STOP** | 00_Front_Matter:
  `00_Front_Matter/Book_Front_Matter_v1.7.md` is in Drive but not in the register |
```

`list_lane` recurses and keys every file by its path relative to the lane, so the nested copy
arrives as `00_Front_Matter/Book_Front_Matter_v1.7.md`, is not among the register's bare file names,
lands in `extra`, and because the lane is in `INTAKE_LANES` becomes a STOP. It is **one line per
file**: duplicating the 13-package chapter lane the same way gives **14 STOP lines**. Nothing in the
message says a folder is duplicated, which is why it reads as missing register entries.

### Report 3 — the spelling patterns and the phrasing scan

**The defect is the leading `\b`.** `BRITISH_RE = \b(?:…)\b` needs a word boundary immediately
before the stem, and there is none inside "reorganise". With a prefix group allowed,
`reorganise, unauthorised, disorganised, misbehaviour, overemphasised, underutilised, reanalyse`
and `relabelled` are all caught, while `research, undercover, misread, disclose` and `overdue` are
correctly left alone.

**One bug in the spec's own list:** `fulfil(?!l)` does not catch **`fulfilment`**, because the
trailing `\b` fails on the following `m`. It needs `fulfil(?!l)\w*`, which catches `fulfil`,
`fulfilment` and `fulfils` and still skips every `fulfill*` form.

**New counts per book, in what the gate actually scans (chapter markdown):**

| Book | Chapters | Today | Widened | What is new |
|---|---|---|---|---|
| SAD (fz1001) | 12 | 0 | **1** | `practising` ×1 — ch08, "worth practising deliberately" |
| MIS 3000 (fz1002) | 14 | 0 | **0** | — |
| MIS 4950 (fz1003) | 12 | 0 | **0** | — |

The widening is nearly a no-op today because the chapters are clean. The forms the spec names are
real but live in lanes the gate never reads — question banks, speaker notes, tooling, and the
register itself: SAD's banks hold `practising` ×2, `practise` ×2, `practises` ×2, `travelled` ×2 and
`neighbouring` ×2; MIS 3000's hold `relabelling` ×6 and `mislabelling` ×2; MIS 4950's hold none.

**Caption lines:** 36 in MIS 3000 and 65 in MIS 4950, 0 in SAD — and **none of them currently trips
the phrasing scan**. Skipping them guards against a future false positive rather than fixing a
present one. Phrasing counts are unchanged at 5 / 18 / 0.

### Report 3a — two findings that change the build

**MIS 4950's register already carries the catalog row**, and it is the only one that does:
`| Catalog number | **FZ1003** |`. `clean()` strips the bold to `FZ1003`, and the book is already
live as `fz1003`, so rule 3's happy path is provable against a real register.

**But that register has a second "Catalog number" row further down**, holding prose:
`FZ1003; Wrapper book id ` + "`fz1003`" + `. Short title *Managing IT Projects*`. `cell()` takes the
first regex match anywhere in the file, so the imprint row wins today by document order rather than
by design.

### The decisions

1. **Two migrations: 0023 for retired books, 0024 for dismissed uploads**, so retire can ship alone.
2. **The spelling gate's scope stays chapter markdown.** The change note says why: today's pattern
   already matches the bank text 300 / 242 / 150 times, and 212 / 231 / 150 of that is the question
   bank schema's own Bloom difficulty value `"analyse"`.
3. **Use `fulfil(?!l)\w*`.**
4. **`practising` in SAD ch08 stays a warning**; Vikram tells the Books coordinator.
5. **Retire and the Retired section are admin-only. Dismiss is allowed to the uploader or any
   admin, on any record not yet added** — failed, stopped and ready-to-add — **and never on an
   added one.**
6. **Retired books are hidden from the LTI picker too; existing links keep working.** The change
   note says so.
7. **`validBookId` stays permissive**, but an upload under a retired id is refused with
   "this book is retired; restore it first".
8. **The Catalog number lookup is scoped to the imprint table**, not first-match-in-file, and proven
   against MIS 4950's real register, which has a second prose row.
