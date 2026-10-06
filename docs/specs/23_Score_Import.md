# Spec 23 — Import scores into a gradebook column from a CSV

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 6 October 2026 · Save as `docs/specs/23_Score_Import.md` (first commit).
Covers backlog item W18.

## Why

The gradebook lives in the Wrapper, and some marks are earned outside it: the SAD simulation's results (it stands
alone this term), a studio session, a paper quiz, a score exported from D2L. Today faculty type each score by hand, one
student at a time. For a class of thirty, a file with one score per student should come in once, safely, with a
preview first.

## Before writing any code

1. Read the gradebook: the line items, how a manual score is stored and edited, which kinds of column accept hand-entered
   scores (a manual column, a simulation column on the "faculty marks" rule) and which are derived and must not be
   imported into (exams, assignments, a simulation on the report or completion rules). **Report the list.**
2. Read the D2L importer's parser (`src/lib/d2l.ts`) and the actions log (`class_actions`). Say what you can reuse.
3. Report how scores are stored (points or percentages) and how a score above the column's maximum behaves today.
4. Propose a plan and any open questions. **Wait for my go before building.**

## What to build

### 1. Where it lives

- On the gradebook page, for a column that accepts hand-entered scores: **Import scores from a CSV.** Faculty of the class and
  admins only.
- Also on the "add a column" form: **create a new column from this file** (title, maximum points, category), so a file of
  marks can become a column in one step.

### 2. The file

- Accept a byte-order mark, CRLF, quoted fields and extra columns. Find the **identifier** column by header, ignoring
  case: `Email`, `UserName` or `Username` (the D2L username). Let faculty choose the **score** column in the preview
  (default: `Score`, `Points` or `Grade`). `OrgDefinedId` is read and ignored, never stored.
- A student is matched by **stored D2L username first, then by email**, as the class import does.
- A blank score means "no change". Faculty can choose to clear scores for blank rows, as a separate, explicit option.
- A toggle: **values are percentages of the maximum points.** The default is points.

### 3. The preview (nothing is written)

- Counts: matched students, unmatched rows (named by their identifier as typed), duplicates (the same student twice),
  non-numeric values, values below zero or above the maximum, students in the class with no row, and rows for withdrawn
  students (skipped) and the demo account (skipped).
- **How many existing scores would change**, with the first few shown as old to new. If any would, applying needs an
  explicit tick: "Replace the N scores already entered."
- Rows with problems are listed and excluded. Faculty apply the valid rows, or fix the file and upload again.

### 4. Applying

- **All or nothing, in one transaction.** Never overwrite an existing score without the tick above.
- Recorded in the class actions log: the column, the counts matched, replaced, skipped and unmatched. **No names, emails or
  scores in the log or in server logs.**
- The uploaded file is processed in memory and never stored.

## Rules (tests must prove each)

1. The parser reads a BOM, CRLF, quoted fields and extra columns, and finds the identifier and score columns by header.
2. Matching is by stored D2L username first, then by email. Unmatched and duplicate rows are listed and excluded.
3. The preview writes nothing, proved by a table census.
4. A score outside zero and the maximum, or non-numeric, is excluded and listed. The percentage toggle converts correctly.
5. Replacing existing scores needs the explicit tick, and the count shown matches what changes.
6. Withdrawn students and the demo account are skipped and reported.
7. Applying is all or nothing: a failure part-way leaves nothing written.
8. Only the class's faculty and admins can import. Another class's faculty and students are refused. A derived column (an exam,
   an assignment, a simulation on the report or completion rule) cannot be imported into.
9. Creating a column from a file creates it with the title, maximum and category, and fills the matched scores.
10. The actions log holds counts only. A captured log of the whole flow contains no name, email or score.
11. The page passes the automated accessibility check used in Spec 14: labelled file input and score-column picker, an
    accessible preview table, and keyboard-operable confirmation.

## Process

As before: `docs/changes/23_Score_Import.md`; a migration only if needed (the next number); every suite passes; commits
authored as me; **show me the summary and ask before pushing**; `git pull --rebase` first. Put no real student data in the
repository: the sample files are invented. Don't run anything against the live database.

## After it ships (not part of this build)

I try it on a test class of invented students: a file with some unmatched and out-of-range rows, then a replace.

## Decisions (6 October 2026)

Settled after the three reports below.

### Report 1 — which columns accept hand-entered scores

A cell is resolved as **stored override first, derived second** (`gradebook.ts`, "A score faculty
typed always wins"). Every column's cell can hold a `line_item_scores` row; what differs is whether
something else owns that value.

| `kind` | `scoreRule` | Editable on the page before this spec | Where the value really comes from |
|---|---|---|---|
| `manual` | — | yes | nothing else; the row *is* the value |
| `sim` | `manual` | yes | faculty marks it |
| `sim` | `completion` | **yes — and that is the discrepancy** | `max_points` if a completion exists, else blank |
| `sim` | `report` | no — "Completed" / "—" | participation only; `isParticipation` forces the cell to null |
| `exam` | — | no | `examScores()` under the exam's counted-attempt rule |
| `assignment` | — | no | `gradeSubmission()` writes the row from the submission |

The page's condition was `kind === "manual" || kind === "sim"` after the participation check, so a
simulation column on the **completion** rule was hand-editable while this spec calls it derived. The
spec is right and the page was loose: a typed score there silently shadows the completion and
nothing says so.

**Assignment columns are a specific trap.** Their cell is *not* derived at read time —
`gradeSubmission` writes a real `line_item_scores` row. An import into one would appear to work and
then be silently overwritten by the next regrade, disagreeing with the submission's own `score` in
the meantime. That is the reason to exclude them, rather than tidiness.

A stored score on an exam column really does win: writing 99 onto a column whose attempt scored 12
makes the gradebook read 99. Nothing in the library stopped a derived column being written to — only
the page declining to render an input — so rule 8 is enforced in the library.

### Report 2 — how scores are stored, and over-maximum behaviour

**Points, always.** `line_item_scores.points` is a `real`, unique on `(line_item_id, enrolment_id)`.
A percentage exists only as a derived figure, `(points / maxPoints) * 100`. The spec's percentage
toggle is therefore a parse-time conversion and nothing about storage changes.

Reproduced on a manual column with `maxPoints = 10`:

```
setScore(15)       -> stored 15,       cell 15,       course total 150%
setScore(-4)       -> stored -4,       cell -4,       course total -40%
setScore(10.5551)  -> stored 10.5551,  cell 10.5551,  course total 105.551%
setScore(NaN)      -> stored NaN,      cell NaN,      course total NaN%
setScore(Infinity) -> stored Infinity, cell Infinity, course total Infinity%
```

There was no validation anywhere on this path. `setScore` was a bare upsert and `setScoreAction`
did `Number(raw)` behind only a `raw !== ""` guard.

**The NaN finding — a live bug, reachable from the UI.** The score box was a plain text input, not
`type="number"`. Typing `abc` into a gradebook cell stored `NaN`, and that student's **whole course
total became `NaN`**, not merely that column. One unparseable keystroke in one cell destroyed the
course grade shown for that student. Found by reproduction while reading for this spec, fixed in its
first code commit so it can ship on its own.

For contrast `gradeSubmission` already validated `0 ≤ pts ≤ a.points` and rounded to two decimals.
The Wrapper knew the rule; the manual path never got it.

### Report 3 — what is reused

**`src/lib/d2l.ts`, and it is already pure (no `server-only`), so the preview can import it.**
`splitCsv()` handles the byte-order mark, CRLF or LF, quoted fields containing commas *and*
newlines, and `""` for a literal quote — rule 1 almost entirely, already covered by `test:d2l`.
`key()` normalises a header (lower-case, strip spaces, underscores, hyphens). `Problem { line,
reason, detail }` is the shape the excluded-rows list needs. Spec 18's `confirmLabel` /
`nothingToWrite` set the precedent that the wording and the enabling live beside the parser as pure
functions, which is where rule 5's tick belongs.

**The gradebook.** `gradebook(sectionId, { includeWithdrawn: true })` already returns, per student,
`enrolmentId, name, email, d2lUsername, isDemo, withdrawnAt` — every field matching and rule 6 need,
in one call. No new roster query.

**`class_actions`. No migration.** `logAction(sectionId, actorId, action, count, detail)` types
`detail` as `Record<string, number>`, so **rule 10 is enforced by the type**: there is nowhere to put
a name. One `ActionName` and one `describeAction` case.

**Patterns.** `CopyGradingSetup.tsx` is the closest analogue — GET a preview, render counts, require
an explicit confirmation, POST to apply. `d2l-import.ts` and `grading-copy.ts` both wrap their apply
in `db().transaction()`, which is rule 7.

**What was missing.** `ownedSection()` is faculty-of-this-class only and does not admit an admin,
and `copyableClasses` did that check inline; `addManualItem` took no `categoryId`.

### The decisions

1. **Hand-entry stops on a completion-rule simulation column**, on the page and in the import,
   showing *"Calculated from completion. Change the rule to 'faculty marks' to enter scores."*
2. **`setScore` refuses non-finite and negative values and allows over-maximum.** An over-maximum
   cell is **flagged visibly** on the page. The import **excludes** over-maximum rows unless faculty
   tick **"Allow scores above the maximum (bonus marks)"**.
3. **No read-only report script** for existing out-of-range scores.
4. **Round to two decimals**, and the preview says **how many values were rounded**.
5. **Default score column order: `Score`, `Points`, `Grade`**, and also recognise a D2L-style header
   ending `Points Grade <Numeric MaxPoints:N>`. Faculty can change the choice in the preview.
6. **Clearing scores for blank rows counts as a replacement** for the explicit tick.
7. The score box becomes a **numeric input with a labelled, announced error**; **`canGradeSection`**
   admits faculty of the class and admins; **`addManualItem` takes an optional category**, needed for
   creating a column from a file.
