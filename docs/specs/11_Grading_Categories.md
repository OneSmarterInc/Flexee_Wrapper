# Spec 11 — Grading categories and retake rules

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 1 October 2026 · Save this file as `docs/specs/11_Grading_Categories.md` in the repository.

## Why

Spring syllabi grade by **weighted categories** — for example quizzes 15%, exams 35%, assignments 30%,
simulations 20% — and say **which attempt counts** when a quiz can be retaken. The gradebook today gives
each column a simple weight. Faculty need to set up their syllabus's grading once per class and have the
Wrapper compute the course grade the same way the syllabus says.

## Before writing any code

1. Read the current gradebook code and tests (`src/lib/gradebook.ts`, the gradebook pages, the line-item
   and score tables in `src/db/schema.ts`, `scripts/it-gradebook.ts`, `scripts/it-gb-starter.ts`), and how
   exams, quizzes and attempts are stored and scored.
2. **Report to me:** what a column's `weight` does today; how many attempts a quiz or exam allows today
   and **which attempt's score reaches the gradebook now**; whether the code distinguishes a quiz from an
   exam; and every place the course total is computed or exported.
3. Propose a plan (tables, functions, pages) and list any question this spec leaves open. **Wait for my
   go before building.**

## What to build

### 1. Categories, per class

- A class can have **grading categories**: name, **weight** (a percentage), and optionally **drop the
  lowest N** scores in that category.
- Weights must total **100%** to save. Show the running total while editing.
- **Starter set** offered when a class has none (faculty edit or delete freely):
  Quizzes 15 · Exams 35 · Assignments 30 · Simulations 20.
- Every gradebook column belongs to **one** category. New columns are assigned by kind (quiz → Quizzes,
  exam → Exams, assignment or case study → Assignments, simulation → Simulations, manual → none until
  faculty choose); faculty can move any column to another category.
- **A class with no categories keeps today's behaviour exactly.** Nothing changes for existing classes
  until their faculty set up categories.

### 2. How the course grade is computed

- **Within a category:** a **weighted mean of the columns' percentages**, using each column's existing
  `weight` (default 1), over the columns that have a score for that student — today's method, applied
  within the category rather than across the whole gradebook. If "drop lowest N" is set, drop that
  student's N lowest columns **by percentage** first (never dropping a category to nothing); a dropped
  column is excluded together with its weight.
- **Across categories:** weighted average of the category percentages.
- **Ungraded work** (no score entered) is left out, so the grade shown is the **current grade** — what
  the student has earned on what has been graded. Faculty give missing work a 0 by entering 0.
- If a category has **no graded columns yet**, leave it out and **re-scale** the other weights to 100%,
  so early-term grades are not dragged down by categories that have not started.
- Round only for display (one decimal place); never round intermediate values.

### 3. Letter grades

- Each class has a **letter scale**. Default: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below. Faculty can edit
  the thresholds (and add +/− bands if they want them).
- The gradebook shows each student's **course percentage and letter**.

### 4. Retake rules, per quiz or exam

- Each quiz or exam has **attempts allowed** (keep the current setting if one exists) and **which attempt
  counts**: **highest**, **latest**, **average of attempts**, or **first**.
- Defaults: **quizzes — highest**; **exams — one attempt** (so "first").
- The gradebook cell uses the rule. Changing the rule recomputes the cell from the stored attempts; no
  attempt is ever deleted.
- The faculty view of a student's attempts shows every attempt and marks the one that counts.

### 5. Pages

- **Faculty, gradebook:** a **Grading setup** panel (categories, weights with running total, drop-lowest,
  column-to-category assignment, letter scale). The gradebook shows, per student, each category's
  percentage, the course percentage and the letter.
- **Faculty, a quiz or exam's settings:** attempts allowed and which attempt counts.
- **Students, their course:** a **My grades** view — each graded column with its score, each category
  with its percentage and weight, the current course percentage and letter, and a note that ungraded
  work is not yet counted.
- **CSV export** gains the category columns, the course percentage and the letter.

## Rules (tests must prove each)

1. Weights not totalling 100% cannot be saved.
2. A class without categories computes exactly as before (the existing gradebook tests still pass,
   unchanged).
3. The weighted average and the drop-lowest rule, on a worked example with known answers.
4. Re-scaling when a category has no graded work yet.
5. Ungraded columns are excluded; an entered 0 counts.
6. Each retake rule — highest, latest, average, first — on the same set of attempts gives the expected
   score; changing the rule changes the cell without losing attempts.
7. Letter boundaries: 89.99 → B, 90 → A (with the default scale).
8. Only the class's faculty can change its grading setup or a quiz's retake rule; a student sees only
   their own grades.
9. The CSV export includes the new columns.

## Process

- Migrations as usual (the next number after the last one in `drizzle/`), applied by `auto-init` on deploy.
- Add `npm run test:grading` for the new tests. Run every existing suite too; all must still pass.
- Write `docs/changes/11_Grading_Categories.md`: what changed, how to use it, the tests.
- Commits authored as me. **Show me the summary and ask before pushing.**
- Do not change anything outside the gradebook, quizzes/exams scoring and their pages without asking.

## Decisions (1 October 2026)

Answers to the questions raised after reading the code, recorded here so the build has one source of
truth. Where these differ from the sections above, these win; section 2 has been updated in place.

1. **Retake defaults.** Existing exams keep today's behaviour: `latest`. New quizzes default to
   `highest`, new exams to `first`. Both editable on the new exam settings page. No existing grade
   changes when this ships.
2. **Quiz vs exam.** Every existing row is `kind = exam`. Faculty choose the kind for new ones.
3. **Simulations.** Stays in the starter set, and stays empty: simulations create no gradebook columns
   today. Wiring sim completions into the gradebook is **out of scope** for Spec 11.
4. **D2L export.** Stays per-item only. No category, course-percentage or letter columns, since
   Brightspace computes its own total. The other four formats gain them.
5. **Within a category.** A weighted mean of the columns' percentages using each column's `weight`
   (default 1) - today's method, applied within the category. **Not** points / points possible. This
   keeps a class's numbers stable when it adopts categories.
6. **Drop lowest N.** A dropped column is excluded together with its weight.
7. **Letter scale.** An editable list of letter + minimum rows, default A/B/C/D/F, plus an
   "add +/- bands" preset that expands the list to A/A-/B+/B/... for faculty who want them.

### Also agreed

- Fix two latent bugs found while reading: `openExamsForSection`'s `lastScore` uses unordered row
  order rather than `submittedAt`, and `examResults` returns one row per attempt instead of per
  student (so retakes list a student repeatedly and skew its average).
- Correct the stale `line_items.kind` comment: the column carries `exam`, `manual` and `assignment`.
- Keep values **unrounded in data**. Round at display and at CSV export, one decimal place.
- Block negative column weights.
- Lowering `attemptLimit` below a student's existing attempt count never removes attempts; it only
  stops new ones.

### Process for this spec

- Step 0 first: the existing gradebook tests are not wired to any npm script, reimplement the logic
  they claim to test instead of importing it, and cannot fail (they print `*** FAIL ***` and exit 0).
  They are rewritten to import the real functions and assert, and wired up as `test:gradebook` and
  `test:gb-starter`, before any computation changes - so rule 2 has a real regression lock.
- Then the build, then every suite.
