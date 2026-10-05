# 22 — Library polish: retire a book, dismiss uploads, catalog numbers, clearer reports

Backlog items W2, W29 (the Wrapper's side) and W16, plus two requests from the Books coordinator.
The spec and the decisions behind it are in [`docs/specs/22_Library_Polish.md`](../specs/22_Library_Polish.md).

Library ids are becoming catalog numbers, because a course code means nothing outside Wright State.
That left old entries nothing could remove, reports with edges the Books coordinator had hit, and a
spelling gate that could not see "reorganise".

## Retire a book

**Admin-only**, soft, reversible. A retired book disappears from the four pickers — the
class-creation form, the upload form, the LTI "add this book" list and the panel that changes a
class's book — and from nothing else.

**Classes already using it keep working, unchanged.** Nothing is needed to make that true:
`sections.book_id` is a plain text column with no foreign key, and the reading path resolves a book
by id through `getBook` and never consults a list. Retirement is a visibility change and nothing
else. Students on a retired book carry on reading it, sitting its exams and asking the assistant.

The shape worth knowing about, because it is the thing a later change could break:

> `listBooks()` has two kinds of caller. Four **pickers**, which must not offer a retired book, and
> three **title lookups** of the form `titles.get(c.bookId) ?? c.bookId`, which must still find it —
> or every class on that book shows a raw id where its title belongs. So `listBooks()` is untouched
> and `listBooksForPicker()` is new. `test:retire` fails if the two are ever collapsed into one.

The panel that changes a class's book takes `keep`: the class's current book stays in its list even
when retired, because the select has to offer it as the selected option and the panel names the book
from that same list.

**Retiring shows the count first** — "2 classes use this book; they will keep working" — through a
`?retire=<id>` step that renders the sentence and a pair of buttons. No script, keyboard-operable by
construction. The sentence says the classes keep working, because a bare count reads like a warning
that something is about to break.

An **upload under a retired id is refused** with "this book is retired; restore it first"
(decision 7). `validBookId` stays permissive, so nothing else about ids changed.

**Migration 0023**, `retired_books`, keyed by book id. A row rather than a field in
`book.manifest.json` because the intake rewrites that manifest on every re-upload and a flag there
would be silently wiped; and there is no books table to add a column to, because `listBooks()` walks
the content store.

### The LTI picker (decision 6)

A retired book is **not offered** in the deep-linking picker an LMS opens. **Links already placed in
a course keep working** — they carry the book id and resolve it directly, the same way a class does.
So retiring a book mid-term does not break a link a student has in D2L; it only stops new ones being
made.

## Dismiss an upload record

An upload record is a receipt. **Failed, stopped and ready-to-add** records may be dismissed;
a record whose book is **in the library never can** — it is the receipt for a book students may be
reading right now, and it says "that book is in the library, so its record is kept as history".
A record the intake is still working on is also left alone, with a different message, because the
job is about to write to that row.

Allowed to **the uploader or any admin** (decision 5), checked in the library rather than by hiding
the button. **Nothing in Blob storage is touched** — the row keeps its blob path, file name, size
and status, and `test:dismiss` asserts all four after a dismissal.

**Dismiss all not added** shows its count first, and that count comes from the same function that
produces the ids the bulk act will hide, so the sentence and the act cannot disagree. A person who
is not an admin sees only their own records in it.

**Migration 0024**, `dismissed_at` and `dismissed_by`. The row stays, so who dismissed what and when
is answerable.

## Catalog numbers

The register's optional **Catalog number** imprint row, in the form `FZ1003`.

| What the register says | What happens |
|---|---|
| no Catalog number row | nothing changes; the book behaves exactly as before |
| `FZ1003`, uploaded as `fz1003` | passes, and `"catalogNumber": "FZ1003"` goes into the book manifest |
| `FZ1003`, uploaded as `mis4950` | **stops**: "the register's catalog number is FZ1003, so this book must be admitted as `fz1003`, not `mis4950`" |
| `FZ103`, or anything malformed | **warns** and is ignored; the book still goes in |

A mismatch stops rather than warns because admitting a book under the wrong id means renaming it
later, and that moves every class's `book_id` and every question id with it.

**The lookup is scoped to the imprint table** (decision 8), found by the Publisher row it carries —
not by first match in the file and not by a heading's wording. MIS 4950's register carries the row
twice: once in the imprint table, and once further down in prose reading
``FZ1003; Wrapper book id `fz1003`. Short title *Managing IT Projects*``. A first-match lookup gets
the right answer there by document order alone, which is luck. `test:catalog` proves the scoping on
a fixture that puts the prose row **first**, which is the case document order would get wrong.

Run read-only against the real packages: `fz1003` passes and stages the number; the same packages
under `mis4950` stop with the message above; SAD and MIS 3000 pass with "the register names no
catalog number" and stage no `catalogNumber` field at all.

### Ids shown in capitals

A **catalog-shaped** id — two letters, four digits — is displayed in capitals in the library list,
the upload form, the upload page's heading and the record list, because that is how the catalog, the
register and the printed book all write it. **The stored id never changes**: `content/fz1003/`,
`sections.book_id`, every question id and every form value stay lower-case, and `test:book-id`
renders the real page to check both at once.

Every other id is shown exactly as stored. Capitalising "sad" invents an acronym the book does not
use, and "MIS3000" is a course code — the thing catalog numbers exist to stop using.

## Clearer reports

**The nested duplicate folder.** Drive for Desktop sometimes leaves a folder inside a lane with the
lane's own name, holding a copy of it. `list_lane` recurses and keys every file by its path relative
to the lane, so each copy arrived as `<lane>/<file>`, none of which is in the register, and the
report listed them one by one as unregistered files — which reads as missing register entries rather
than as one duplicated folder.

Reproduced against a copy of SAD's real shelf. A duplicated front-matter folder and a duplicated
chapter lane gave **fourteen STOP lines**. Now it is two:

```
a folder named `00_Front_Matter` sits inside the lane `00_Front_Matter`; remove or move it (1 file inside it);
a folder named `04_Chapters` sits inside the lane `04_Chapters`; remove or move it (12 files inside it)
```

It still stops where it stopped before.

**A closing line on every report.** "**Ready to add: click Add to library.**", with the warnings
named when there are any and the words "none of which blocks the book"; or "**Stopped: fix the lines
marked STOP above and upload again.** Nothing was admitted." The gate table is a wall of rows and
the one thing a reader needs from it is whether to act.

**Repeated warnings are summarised.** Six or more lines sharing a leading category — `chN:`,
`<lane>:`, the alt-text categories — collapse to a count and the first three. A list of *distinct*
categories is left in full, because collapsing it would say "1 in ch1 · 1 in ch2" and lose the
information; `test:reports` checks that case explicitly.

## The library page

- **A finished state that reads as finished.** The upload page kept showing the redirect's "Adding
  the book to the library" while the status had already moved past it, kept its ten-second refresh
  meta, and offered no way back. Once published it says **"Done: in the library"** with the date and
  a **Back to library** button, and the stale line is not shown at all. An unfinished upload is
  untouched: it still names the status and still refreshes.
- **The book's real title** as the heading, with the id beside it, falling back to the id while
  there is no book to read a title from. The book list gains the **register version**, which the
  manifest has carried since Spec 15 and nothing displayed.
- **A soft warning on `.zip.zip`** — it happens when the browser unzipped the download and the
  folder was zipped again, which usually means the archive holds one folder where the intake expects
  the lanes. It warns and lets the file through, because often it is still the right one.

## GitHub errors

Every non-204 answer produced the same sentence, so a **503 told the reader to check settings that
were fine**. A 404 from a wrong repository name and a 503 from a bad ten minutes are different
events: one never passes, the other usually does on the next try.

| Answer | What happens |
|---|---|
| 5xx, 429, or a thrown network error | tried **three times** with a short growing wait, then "GitHub was briefly unavailable (503); try again." |
| 401, 403, 404, 422 | tried **once** — it will be the same three times over — then "Ask a developer to check the runner settings." |

A failed record gets a **Retry** button, because "try again" with nothing to click is advice rather
than a remedy. It starts the check again on the file already uploaded, clears the stale message, and
puts the record back to failed with the new one if the start fails again. Only a failed record: a
**stopped** one has a report to fix, and retrying would produce the same report, which the message
says. Refused on a retired book.

**No token appears anywhere.** A dispatch token with Actions: write is the most dangerous string in
the application, and the easy mistake is to put a response body into an error message — so the fake
GitHub in `test:github-errors` answers with the token inside its body, and every path is checked:
the result, the URL, and the message written onto the record.

## The spelling gate and the phrasing scan

**The defect was the leading `\b`.** It sat immediately before the stem, and there is no word
boundary inside "reorganise", so every prefixed form was invisible. A prefix group — re-, un-, dis-,
mis-, over-, under- — now sits in front, and because it can only match where a British stem follows
immediately it leaves "research", "undercover", "misread", "disclose" and "overdue" alone.

The six prefixes are named rather than written `\w*` because a bounded list is one somebody can read
and check. Measured over the three books it makes no difference today: no stem in the list appears
inside a longer word, so `\w*` finds the same single warning and leaves the same lookalikes alone.
That is a property of the stems in the list now rather than a guarantee about the next one added —
which is what the lookalike check in `test:spelling` is really guarding.

Ten forms added: `fulfil`, `travelled`, `totalling`, `practise`, `harbour`, `labour`, `neighbour`,
`fibre`, `theatre`, `cheque`. **One correction to the spec's own list** (decision 3): `fulfil(?!l)`
does not catch **`fulfilment`**, because the trailing `\b` fails on the following `m`. It is
`fulfil(?!l)\w*`, which catches `fulfil`, `fulfilment` and `fulfils` and still skips every `fulfill*`
form — all of which are correct American English. Every added form is checked against the American
spelling of the same word, pair by pair, because a pattern that flags both is worse than no pattern:
it teaches the Books coordinator to ignore the gate.

### The new counts, per book

| Book | Chapters | Spelling warnings | Phrasing notes |
|---|---|---|---|
| SAD (fz1001) | 12 | **1** — `practising`, ch08 | 5 |
| MIS 3000 (fz1002) | 14 | 0 | 18 |
| MIS 4950 (fz1003) | 12 | 0 | 0 |

**Only SAD newly warns**, on one word: "four properties make critique usable, and they are worth
*practising* deliberately" in chapter 8. American English is "practicing". It stays a warning and
the Books coordinator has been told (decision 4). MIS 3000 and MIS 4950 were clean and still are,
which is the check that the widening has not started flagging correct prose.

### Why the gate's scope stays chapter markdown (decision 2)

The forms the spec names are real, but they are mostly in lanes the gate never reads — question
banks, speaker notes, tooling, and the register itself. SAD's banks hold `practising` ×2, `practise`
×2, `practises` ×2, `travelled` ×2 and `neighbouring` ×2; MIS 3000's hold `relabelling` ×6 and
`mislabelling` ×2.

Widening the scope to the banks would be a mistake as things stand. **Today's pattern already
matches the bank text 300, 242 and 150 times** for the three books — and 212, 231 and 150 of that is
the question bank schema's own Bloom difficulty value `"analyse"`, which is spelled that way on
purpose and is not prose at all. The gate would be buried in the schema's own vocabulary. Scanning
the banks would need that vocabulary allow-listed first, and that is not this spec.

### The phrasing scan

It skips figure and table caption lines and long descriptions now. A caption is written to be read
beside a picture, where the shape the scan looks for is often the right way to say it. **None of the
three books trips the scan on a caption today** — 36 caption lines in MIS 3000 and 65 in MIS 4950,
none matching — so this guards against a future false positive rather than removing a present one.
The counts above are unchanged by it.

## Tests

| Suite | Checks | What it holds |
|---|---|---|
| `test:retire` | 10 | the pickers, the title lookups, a student still reading a retired book, the count, the upload refusal |
| `test:dismiss` | 11 | the status rule, who may, storage untouched, the bulk count per person |
| `test:catalog` | 9 | the imprint-table scoping on a fixture ordered the wrong way, then all three real registers |
| `test:book-id` | 10 | capitals in the markup, lower-case in every form value and row, the finished state, `.zip.zip` |
| `test:reports` | 8 | the nested folder on a copy of the real shelf, the closing line, the summary |
| `test:github-errors` | 14 | the retry counts per status family, the Retry library, and the token in nothing |
| `test:spelling` | 8 | every added form against its American spelling, the prefixes, the real counts |

Fourteen sabotages, each run and undone. The ones worth naming: collapsing the two book lists fails
`test:retire`'s `keep` check; adding "published" to the dismissible set fails by name; removing the
nested-folder branch restores the fourteen lines and fails; retrying a 404 fails; and **appending the
token to a message, or putting it in the URL, both fail with the leak named**.

`test:a11y-pages` renders `/library` and `/library/[id]` and still reports no finding at any impact,
which is rule 9 — the new buttons are keyboard-operable, and the ones whose label is just "Retire"
or "Dismiss" carry visually-hidden text naming what they act on.

### What the tests do not judge

- **A real GitHub.** The dispatch is driven by a fake that answers with the statuses the suite
  chooses. Whether GitHub actually returns 503 under load, and whether three attempts with a short
  wait is enough, is something only a live failure will say.
- **Blob storage.** Dismissing is proved not to change the row. That the uploaded zip is still in
  Blob follows from nothing touching it, not from a test that looks.
- **The LTI picker in an LMS.** A retired book is proved absent from the list the page renders.
  Whether D2L keeps an existing link working is the same mechanism as a class resolving its book by
  id, and is not separately exercised.

## After it ships

Retire the old `sad` entry and the test book `cyber123`, and dismiss the stale MIS 4950 upload
records. The Books coordinator uploads SAD's revision as `fz1001` — its register will need the
Catalog number row adding first, or the gate simply says nothing and the book goes in under whatever
id it is uploaded with.
