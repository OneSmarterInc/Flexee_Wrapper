# 11 — Grading categories and retake rules

Spring syllabi grade by weighted categories and say which attempt counts when a quiz can be retaken.
Before this change a class could only weight each gradebook column, and every exam's cell silently used
the latest submitted attempt. Faculty can now set their syllabus's grading up once per class and have
the Wrapper compute the course grade the way the syllabus says.

The spec and the decisions behind it are in [`docs/specs/11_Grading_Categories.md`](../specs/11_Grading_Categories.md).

## What changed

### Grading categories, per class

A class can have grading categories: a name, a weight as a percentage, and optionally "drop the lowest
N". Weights must total 100% to save, and the setup panel shows the running total while you edit, in
green when it reaches 100 and red when it does not.

A class with no categories **grades exactly as it did before**. Nothing changes for an existing class
until its faculty choose to set categories up — there is no migration of anyone's grades.

The starter set is Quizzes 15 · Exams 35 · Assignments 30 · Simulations 20, and existing columns are
sorted into it by kind: quizzes to Quizzes, exams to Exams, assignments and case studies to
Assignments. Simulations is created but stays empty, because simulations do not produce gradebook
columns yet. Manual columns stay uncategorised until you place them. Faculty edit, delete and
reassign freely; clearing every category name returns the class to grading by column weight.

### How the course grade is computed

- **Within a category** — a weighted mean of its columns' percentages, using each column's existing
  weight. This is the method the gradebook already used, now applied inside the category rather than
  across the whole gradebook, so a class's numbers do not jump when it adopts categories.
- **Drop lowest N** — the student's N weakest columns in that category go, by percentage, together
  with their weight. A category is never dropped to nothing.
- **Across categories** — a weighted average of the category percentages.
- **Ungraded work is left out**, so what you see is the current grade: what the student has earned on
  what has been marked. An entered 0 is real work worth nothing and does count.
- **A category with nothing graded yet is left out and the remaining weights rescale to 100%**, so a
  grade is not dragged down in week three by an exam category that has not started.
- Values are kept **unrounded** in the data. Rounding to one decimal happens at the page and at the
  CSV export, never in an intermediate figure.

### Letter grades

Each class has a letter scale: an editable list of letter and minimum rows, defaulting to
A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 60 · F. An **Add +/− bands** button expands it to A/A−/B+/B/B−/… for
faculty who want them. The gradebook shows each student's course percentage and letter. Clearing every
letter restores the default.

### Retake rules, per quiz or exam

A quiz or exam now has a kind and a rule for **which attempt counts**: highest, latest, average of
attempts, or first.

- **New quizzes default to highest, new exams to first.**
- **Every existing exam keeps `latest`**, which is what the gradebook has always used — so no grade
  moves when this ships.
- Both the kind and the rule are editable after creation, on the quiz or exam's own page. Attempts
  allowed is editable there too; it never was before.
- Changing the rule recomputes the cell from the attempts already stored. **No attempt is ever
  deleted.** Lowering attempts allowed below what a student has already used keeps their attempts and
  only stops new ones.
- `highest` compares by percentage, so a retake served out of a different total compares fairly.

### Pages

- **Faculty, gradebook** — a Grading setup panel: categories with weights and a running total,
  drop-lowest, which category each column counts in, and the letter scale. The table gains a column
  per category plus Course % and Letter.
- **Faculty, a quiz or exam** — kind, attempts allowed and which attempt counts. The scores table now
  shows **one row per student** with the score that counts; where a student has retaken, opening their
  row lists every attempt with the counted one marked.
- **Students, their course** — a **My grades** view at `/<book>/grades`: each graded item with its
  score and percentage, each category with its percentage and weight, the course percentage and
  letter, the letter scale, and a note that ungraded work is not yet counted. Linked from the course
  home strip and from the My courses card on `/student`.
- **CSV export** — the four LMS-shaped formats and the generic one gain a column per category and a
  Letter column; each format's existing total column carries the course percentage. **Brightspace/D2L
  stays per-item only**, since it computes its own total.

### Two bugs fixed along the way

- `openExamsForSection` reported a student's last score using raw database row order, which carries no
  ordering guarantee, so it could disagree with the gradebook about which attempt was latest. It now
  sorts by submission time, and also reports the score that actually counts.
- `examResults` returned one row per submitted attempt rather than per student, so a class with
  retakes listed the same student repeatedly and its average was an average of attempts rather than of
  students.

Also: the stale `line_items.kind` comment now names all three values in use (`exam`, `manual`,
`assignment`), and a column's weight can no longer be set negative.

## How to use it

1. Open a class's **Gradebook** and press **Set up grading categories**. Edit the starter weights to
   match your syllabus; the running total must read 100%.
2. Under **Which category each column counts in**, place anything that landed in none — manual columns
   especially. A column in no category does not count towards the course grade.
3. Set **drop lowest** on any category that allows it, for example dropping one quiz.
4. Adjust the **letter scale** if your syllabus differs, or add +/− bands.
5. For each quiz, open it and set **attempts allowed** and **which attempt counts**.

Students see their own grade under **My grades** on their course home.

## Migration

`drizzle/0016_grading_categories.sql`, applied by `auto-init` on deploy. Everything is additive and
defaulted:

- `grading_categories` — one row per category per class.
- `letter_scales` — one row per class; absent means the default scale.
- `line_items.category_id` — nullable, `ON DELETE SET NULL`. Every existing row is NULL, which is the
  before behaviour.
- `exams.kind` — defaults to `exam`, so every existing row is an exam.
- `exams.counted_attempt` — defaults to `latest`, so every existing exam grades as it did.

## Tests

`npm run test:grading` — 26 assertions covering each of the spec's nine rules: weights refused unless
they total 100; a class without categories computing exactly as before; the weighted average and
drop-lowest on worked examples with known answers; rescaling when a category has not started;
ungraded excluded and an entered 0 counted; all four retake rules over one set of attempts, and
changing the rule without losing an attempt; the 89.99 → B / 90 → A boundary; faculty-only access to
the grading setup and a student seeing only their own grades; and the export's new columns.

`npm run test:gradebook` (12) and `npm run test:gb-starter` (7) were rewritten first, in their own
commit, because they were not wired to any npm script, reimplemented the logic they claimed to cover
instead of importing it, and could not fail — they printed `*** FAIL ***` and exited 0. They now import
the real functions and assert, which is what makes "a class without categories computes exactly as
before" a claim with something behind it.
