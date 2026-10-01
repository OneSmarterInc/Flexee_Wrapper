# Spec 12 — Simulation results in the gradebook

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 1 October 2026 · Save as `docs/specs/12_Sims_In_Gradebook.md` (first commit).
Builds on change 10 (RapidSims handoff) and Spec 11 (grading categories).

## Why

A RapidSim completion is recorded (`sim_completions`) but never reaches the gradebook, so the
**Simulations** category from Spec 11 stays empty unless faculty type scores by hand. Faculty need a
sim in their class to have its own gradebook column that fills itself when students finish.

## Before writing any code

1. Read `src/lib/sims.ts`, `src/lib/gradebook.ts`, `src/lib/grading.ts`, the line-item and score
   tables, and how Spec 11 assigns columns to categories.
2. In the RapidSims repository (`D:\Code\Wrapper\Disaster_New`), find every `reportCompletion` call and
   **report what each sim sends**: `duration`, `summary`, `metrics` — their keys and value types, and
   whether any sim reports a **numeric score or outcome** that could grade the run.
3. Propose a plan and list open questions. **Wait for my go before building.**

## What to build

### 1. A column per sim in a class

- When faculty **add a sim to a class**, create its gradebook column: kind `sim`, linked to the sim,
  titled with the sim's title, **10 points** by default (faculty can change it), placed in the class's
  **Simulations** category if it has one.
- Adding a sim that students have already completed in this class fills their cells straightaway.
- **Removing a sim from a class keeps its column and scores** (grades are never lost by removing a
  sim); faculty may delete the column themselves only if it has no scores, as with other columns.

### 2. How a completion becomes a score — a rule per sim, per class

> Superseded in part by **Decisions** below: the default is `report`, a participation record with
> no points and no category, and "From the sim's result" is dropped.

| Rule | Score |
|---|---|
| **Completion** | Full points when the student completes the sim, otherwise blank |
| **Manual** | Completions are shown to faculty, but faculty enter the score |
| **From the sim's result** | Only if step 2 above finds sims reporting a usable number; otherwise leave this rule out and say so |

- Only **student** completions count. Faculty and preview launches never create scores.
- A student completing a sim more than once: the **first** completion earns completion credit; later
  ones do not change it. (For "from the sim's result", propose highest or latest in the plan.)
- A score **faculty typed into a sim column is never overwritten** by a later completion.
- Changing the rule recomputes the column from stored completions, without touching faculty-entered
  scores.

### 3. Pages

- **Faculty, class Simulations page:** for each sim, its points, its rule, and a link to its gradebook
  column. "Who has played" stays as it is.
- **Gradebook:** sim columns appear like any other and count in their category; the faculty view can
  show each completion's time and duration beside the score.
- **Students, My grades:** sim columns appear automatically through the gradebook.

## Rules (tests must prove each)

1. Adding a sim to a class creates exactly one column, in Simulations when that category exists.
2. A student completion fills the cell under the completion rule; a faculty or preview launch's
   completion does not.
3. Earlier completions are backfilled when a sim is added after students played it.
4. A second completion does not change completion credit.
5. A faculty-typed score is never overwritten by a completion.
6. Manual rule: completions do not create scores.
7. Removing the sim from the class keeps the column and its scores.
8. The column counts in the Simulations category and in the course grade (Spec 11's computation).
9. Only the class's faculty can change a sim's points or rule.

## Process

Same as Spec 11: migration with the next number, applied by `auto-init`; `npm run test:sims` extended
or a new `test:sim-grades`; every existing suite still passes (they now fail loudly, so a green run
means something); `docs/changes/12_Sims_In_Gradebook.md`; commits authored as me; **show me the
summary and ask before pushing**; `git pull --rebase` before pushing. Do not change the RapidSims repository.

## Decisions (1 October 2026)

Answers settled after reading the RapidSims repository and the gradebook code. Where these differ
from the sections above, these win.

### Participation is the default; grading is the faculty's choice

A sim column is **first a participation record, not a grade**. The rule on `line_items` takes three
values:

| Rule | What the column is |
|---|---|
| **`report`** (the default) | A participation record. The cell reads "Completed" with the date, or blank. It has **no points**, belongs to **no category**, and is **excluded from every total** - the category percentages, the course percentage and the graded tally. |
| **`completion`** | Faculty-set points, awarded in full on completion, blank otherwise. |
| **`manual`** | Faculty enter the marks themselves; the completion date shows beside them. |

- A sim added to a class starts as `report`. Nothing about the class's grades changes by adding a sim.
- **Only when faculty switch to `completion` or `manual`** does the column take points (default 10)
  and move into the **Simulations** category, if the class has one. If the class has no Simulations
  category the column stays uncategorised, and the Simulations page says plainly that it will not
  count until it is moved, with a link to the grading setup.
- **Switching back to `report`** takes the column out of the totals again and **never deletes typed
  marks** - they are kept, and reappear if faculty switch back to `manual`.
- **My grades** shows participation columns as "Completed" or "Not yet", clearly apart from graded
  work. The **CSV export** carries them as `Completed` or blank. **Brightspace/D2L stays per-item**,
  as in Spec 11.

### "From the sim's result" is dropped

Step 2 of "Before writing any code" asked whether any sim reports a number that could grade the run.
**None does**, so the third rule from the table above is left out. The evidence:

- No sim's completion payload contains a key named score, points, grade, mark, correct, percent, pass
  or fail. Checked across all 13 production sims.
- The numbers that are sent are **counts of behaviour** (`Went off the bridge`,
  `Tripwires not acted on`, `evidenceHeld`, `groupsSettled`, `companies`, `verdicts`) - not
  normalised to any maximum, and several are negative indicators where lower is better; or
  **scenario quantities** (`year1Connect`, `cumulativeUptime`, `freezeMonths`, `atReport`) in domain
  units; or a **self-rating** (`confidence`, 1-5, which would reward confidence rather than accuracy).
- The most score-like value, sim 09's `fund`, is **not a number**: `sim09/lib/room.js:66` passes it
  through `E.display()`, which returns "$12.34M", "$120K" or "$0".
- The two ordinal outcomes do not rank. Sim 03's `year3Band` is
  `strong | data_no_room | pilot | weak`, where `data_no_room` and `pilot` are different kinds of
  partial outcome rather than better and worse. Sim 08's tier is disclaimed in its own engine, at
  `sim08/lib/engine.js:87`: "The eighteen-month report for one run. No score, no tier label."
- `sim-plus-01/data/simmeta.js:56` does define a real 0-5 quality ordinal, `SEVERITY_RANK`, but it is
  used only to sort the worst outcome for display and is **never transmitted**.
- This is deliberate. Sims 01 and 02 state it at the call site: "The metrics are this sim's own
  choosing - the platform stores them without interpreting them." The Wrapper agrees: `sim_completions`
  has no score column.

Grading from metrics would mean the Wrapper inventing a scheme per sim out of values the sims
decline to grade, and it would break whenever a sim changed its metrics, which it is free to do.

### The rest

- **Only student completions count**, and only those recorded in **that class**. A faculty or preview
  launch's completion never scores; completions with no section never score.
- **Live-session completions count.** In team mode sim 03 reports one completion per team member, and
  sims 04-10 have session modes; each student has their own launch, so each scores.
- **Time and duration show on the Simulations page only**, in "Who has played", not in the gradebook
  cell. Sim 04 never sends a duration, so that column is blank for it.
- The rule lives on `line_items`, not on `class_sims`: rule 7 keeps the column and its scores when a
  sim is removed from a class, and a rule on the membership row would die with it.
- Points reuse the existing `line_items.maxPoints`. A `report` column carries 0, which is also what
  excludes it from Spec 11's arithmetic.
