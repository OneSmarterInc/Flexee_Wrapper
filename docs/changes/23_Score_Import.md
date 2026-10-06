# 23 — Import scores into a gradebook column from a CSV

Backlog item W18. The spec and the decisions behind it are in
[`docs/specs/23_Score_Import.md`](../specs/23_Score_Import.md).

Some marks are earned outside the Wrapper — the SAD simulation, a studio session, a paper quiz, a
score exported from D2L — and faculty were typing them in one student at a time. A file of thirty
scores now comes in once, with a preview first and nothing written until it is confirmed.

**No migration.** The actions log already took counts, and `line_item_scores` already had the shape.

## A bug found on the way in, and closed first

While reading the gradebook for this spec I reproduced what it does with a bad score. On a column
out of 10:

```
setScore(15)       -> stored 15,       cell 15,       course total 150%
setScore(-4)       -> stored -4,       cell -4,       course total -40%
setScore(NaN)      -> stored NaN,      cell NaN,      course total NaN%
```

There was no validation on that path at all: `setScore` was a bare upsert and `setScoreAction` did
`Number(raw)` behind only a non-empty guard. **The score box was a plain text input**, so typing
`abc` into one cell stored `NaN` — and because a course total is a weighted mean over the cells,
that single keystroke turned the student's **whole course total** into `NaN`, not merely that one
column. Nothing anywhere said so.

It is the first code commit, so it could have shipped on its own. What changed:

- `setScore` refuses anything **not finite** and anything **negative**, and rounds to two decimals
  as `gradeSubmission` already did. It **allows a value above the maximum**, because bonus marks are
  deliberate (decision 2) — but the page now **flags such a cell** with a red border and "over N"
  instead of letting 15/10 pass as if it were ordinary.
- The score box is `type="number"` with `step` and `min`, so a browser refuses `abc` before it
  travels. The server still checks, because a posted form is not the page.
- A refused score comes back as an announced `role="alert"` line by the heading, naming what was
  wrong, instead of being silently stored.

For contrast, `gradeSubmission` had validated `0 ≤ pts ≤ points` and rounded all along. The Wrapper
knew the rule; the manual path never got it.

## Which columns take a typed score, and which do not

A cell is resolved as **stored override first, derived second**, so every column *can* hold a score
row. `handEntryRefusal` is now the one place that says whether it should.

| Column | Typed score | What it says |
|---|---|---|
| a manual column | **yes** | — |
| a simulation on "faculty marks" | **yes** | — |
| a simulation on "completion" | no | *"Calculated from completion. Change the rule to 'faculty marks' to enter scores."* |
| a simulation on "report" | no | "A participation record carries no score." |
| an exam | no | "Calculated from the exam's attempts." |
| an assignment | no | "Comes from the submission's grade." |

**The completion-rule simulation is a change in behaviour.** The page used to let faculty type into
it, silently shadowing the completion record, and the spec classifies it as derived. Decision 1
stops it in both places. The reason is shown **once in the column header**, not in all thirty cells.

**An assignment column deserves its own note.** Its cell is not derived at read time —
`gradeSubmission` writes a real score row — so an import there would appear to work and then be
silently overwritten by the next regrade, disagreeing with the submission's own score in the
meantime. That is why it is excluded, rather than tidiness.

And the check is in the **library**, not in the page declining to render a control: a stored score
on an exam column really does win (99 over an attempt that scored 12), and before this a posted form
could write one.

## The file

`splitCsv` is reused from the D2L importer, so a byte-order mark, CRLF or LF, quoted fields
containing commas *and* newlines, and `""` for a literal quote all read already.

- The **identifier** is found by header, case and spacing ignored: `Email`, `UserName`, `Username`,
  and the spellings a spreadsheet produces like `E-Mail` and `user_name`. Email wins when a file
  carries both. `OrgDefinedId` is listed as read and **ignored, never stored**.
- The **score column** is offered in the order `Score`, `Points`, `Grade` — the spec's order, not
  the file's, so `Score` wins over an earlier `Grade` — and a **D2L gradebook's own header** is
  recognised by its suffix, `Studio session Points Grade <Numeric MaxPoints:10>`, keeping the item
  title it carries and the maximum it declares. Faculty can change the choice in the preview.
- A cell reads the way a spreadsheet writes one: a `%` sign, a `pts` suffix and a thousands
  separator all come off; `.5`, `8.` and `+8` all read; `8/10`, `1e3`, `n/a` and a bare dash are
  "not a number" rather than something surprising. A negative value says "below zero" distinctly,
  because the two want different sentences.
- Matching is the **stored D2L username first, then the email**, as the class import matches.

## The preview — nothing is written

Counts: scores to add, to change, to clear; values rounded; rows for nobody in this class; the same
student twice; not a number; below zero; above the maximum; withdrawn students skipped; the demo
account skipped; blanks left alone; and **students in the class with no row**, named rather than
only counted.

- **How many values were rounded** (decision 4), and only where the value actually moved: 33.333% of
  100 rounds, 50% of 30 does not.
- **The first five scores that would change**, as old → new.
- **Rows with problems are listed and excluded**, named by the identifier as typed so faculty can
  find the line in their own file.
- **Over the maximum is excluded** unless faculty tick *"Allow scores above the maximum (bonus
  marks)"* (decision 2).
- **A blank means no change**, unless they tick *"Clear the score where a row is blank"* — and
  **clearing counts as a replacement** for the tick below (decision 6), because removing a mark is
  as consequential as changing one.
- Replacing anything needs *"Replace the N scores already entered."* A score that is **already
  exactly right is not counted as a change**, so the tick is never demanded for a no-op.

Withdrawn students and the demo account are skipped **before the value is read**, so a withdrawn
student with a bad number is reported as withdrawn — the thing faculty need to know — rather than as
a bad number. They are also kept out of "students with no row", where they would read as an
oversight rather than a deliberate exclusion.

## Applying

**All or nothing, in one transaction.** The apply rebuilds the preview from the file rather than
trusting one computed in a browser, and because the class may have changed while the preview was on
screen; it then writes exactly that plan's changes, so the counts the log records are the counts
that happened. A refused apply writes nothing **and logs nothing**.

The file is read in the browser and sent as text. It is **never uploaded and never stored** — which
is why there is no upload route and no blob path.

**The log holds counts only.** `logAction`'s detail is typed `Record<string, number>`, so there is
nowhere to put a name even by accident. It reads back as *"Imported scores into a column: 3 new
scores, 1 changed, 2 unmatched"*.

## A column made from a file

"Create a new column from a file" takes a title, a maximum and a category, and fills the matched
scores in one step (rule 9). A D2L header's own item title and declared maximum pre-fill that form,
since the file already says both.

This needed the preview split, because a column that does not exist cannot be looked up and a score
needs a maximum to be judged over. `previewForNewColumn` describes the column instead; a new column
has no scores, so nothing can be replaced and the tick is never owed. `createColumnFromFile` creates
it, imports, and **removes the column again if the import does not go through** — somebody who
mistyped the file should not be left with an empty column they never asked for.

## Sample files

Invented students, reserved `.invalid` addresses, no real student data in the repository. They are
**load-bearing**: `test:score-parse` asserts each one parses as this note says, and that the bytes
survive (`.gitattributes` already keeps `scripts/fixtures/*.csv` byte-exact).

| File | What it is for |
|---|---|
| [`scores_simple.csv`](../../scripts/fixtures/scores_simple.csv) | four students by email, CRLF, no BOM — the ordinary case |
| [`scores_d2l_messy.csv`](../../scripts/fixtures/scores_d2l_messy.csv) | BOM, CRLF, a D2L score header, and one of every problem: blank, non-numeric, negative, over the maximum, unmatched, duplicated |
| [`scores_percentages.csv`](../../scripts/fixtures/scores_percentages.csv) | 80, 95, 70 — 8, 9.5 and 7 on a ten-point column under the toggle, and all three over the maximum without it |

## Tests

| Suite | Checks | What it holds |
|---|---|---|
| `test:score-guard` | 13 | what a score may be, which columns take one, who may grade, the optional category |
| `test:score-parse` | 19 | the file, one cell at a time, and the three sample files |
| `test:score-import` | 22 | matching, the preview's census, the tick, applying, the log, the panel's markup |

Thirteen sabotages, each run and undone. The ones worth naming: removing the finite check fails with
`NaN !== null`; refusing over-maximum as well fails the bonus-marks check; letting the completion
rule be typed into fails by name; swapping the matching order fails *"rule 2 asks for the D2L
username first"*; dropping the derived-column refusal fails; and not requiring the tick fails with
Maria's 8 still in place.

**Two checks cost more to make honest than to write:**

- The **census over fifteen tables** proves the preview writes nothing — and also asserts the plan
  is non-empty, because a census over a preview that produced nothing would prove nothing at all.
- The **log capture** records every console channel over a whole flow, and then **proves the
  recorder works** before reading it. An empty transcript looks identical to a broken capture, and
  without that probe "nothing leaked" would pass either way. This is the same mistake as Spec 20's
  first relevance measurement, caught earlier this time.

### What the tests do not judge

- **The filled-in preview's markup.** The panel is rendered and read by axe — zero findings, a
  labelled file input, a labelled score-column picker, a real named `<dialog>` — but the options
  fieldset, the three tables and the replace tick only exist after a file has been read, which is
  client state a static render cannot produce. My first version asserted they were there and failed
  with "0 checkboxes", which was the honest answer to a question asked wrongly. The markup rules are
  held on the source instead (every table a caption, every `th` a scope, every checkbox inside a
  `checkbox-label`), and the gradebook is now one of the routes `npm run a11y:browser` visits.
- **A genuine part-way failure of the apply.** It cannot be reached from a file, because the preview
  and the gradebook's guard agree on every value the preview emits — which is the property you want
  rather than a gap. So the suite asserts the structure from the source and proves the rollback on
  the mechanism, and says which is which.
- **A real browser.** Whether the file picker, the dialog's focus trap and the tick behave together
  for somebody using a keyboard only is the manual script's business and the opt-in browser run's.
- **Existing out-of-range scores.** Tightening `setScore` does not remove one already stored
  (decision 3: no report script). If a class has a 15/10 from before, the gradebook will now flag it
  rather than hide it — which is the point.

## After it ships

Try it on a test class of invented students: a file with some unmatched and out-of-range rows, then
a replace. The three sample files above are enough to see every count move.
