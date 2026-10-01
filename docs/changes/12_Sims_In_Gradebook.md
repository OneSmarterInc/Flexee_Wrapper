# 12 — Simulation results in the gradebook

A RapidSim completion was recorded in `sim_completions` but never reached the gradebook, so the
**Simulations** category from Spec 11 stayed empty unless faculty typed scores by hand. A sim in a
class now has its own gradebook column that fills itself when students finish.

The spec and the decisions behind it are in [`docs/specs/12_Sims_In_Gradebook.md`](../specs/12_Sims_In_Gradebook.md).

## What changed

### A sim column starts as a participation record

Adding a sim to a class creates one gradebook column — kind `sim`, titled with the sim's title,
linked to it — and that column starts as a **participation record**:

- The cell reads **Completed** with the date, or a dash.
- It has **no points**, belongs to **no category**, and is **out of every total**: the category
  percentages, the course percentage, the graded tally and the letter.

So adding a sim never changes anyone's grade. Grading it is the faculty's choice, made afterwards.

### Three rules, chosen per sim per class

| Rule | What the column is |
|---|---|
| **Participation record** (`report`, the default) | Who finished it, and nothing else. Counts towards nothing. |
| **Points for completing it** (`completion`) | Full points on completion, blank otherwise. Points default to 10 and faculty can change them. |
| **Faculty enter the marks** (`manual`) | Faculty type the marks; the completion date shows beside them. |

Switching to `completion` or `manual` gives the column points and moves it into the class's
**Simulations** category when there is one. If the class has no Simulations category the column stays
uncategorised, and the Simulations page says plainly that it **will not count towards the course
grade until it is moved**, with a link to the grading setup.

Switching back to `report` takes it out of the totals again and **never deletes a mark faculty
typed** — those are kept and reappear if the column is graded again.

### How a completion becomes a score

The cell is **derived from the stored completions**, in the way an exam cell is derived from its
attempts, rather than written into the scores table. That is what makes the rest fall out:

- **Only student completions count**, and only those recorded in **that class**. A faculty or preview
  launch's completion never grades: the derivation joins to the class's student enrolments, so there
  is no row for it to land in. A completion with no section belongs to no class and never scores.
- **A sim added after students played it is already filled** — there is no backfill step, because
  the column reads the completions rather than storing them.
- **The first completion is the one that counts.** A second never changes the credit, and both stay
  on record.
- **A score faculty typed is never overwritten.** A typed score wins over any derived value, so a
  later completion cannot displace it.
- **Changing the rule recomputes the column** from the completions already stored, without touching
  typed marks.
- **Live-session completions count.** In team mode sim 03 reports one completion per team member, and
  sims 04–10 have session modes; each student has their own launch, so each scores.

### Removing a sim from a class

**Keeps the column and its scores.** Grades are never lost by removing a sim. That is why the rule
lives on `line_items` rather than on `class_sims`: a rule on the membership row would be deleted with
it, the derivation would stop and the grades would vanish. Faculty may delete the column themselves,
as with any other, only when it has no scores.

### Pages

- **Faculty, class Simulations** — each sim shows its gradebook rule, its points once it is graded,
  a link to its gradebook column, and a line saying what the current rule means. "Who has played"
  is unchanged and remains the only place showing each completion's time and duration.
- **Faculty, gradebook** — sim columns appear like any other. A participation column shows
  "Completed" with the date and no weight input; a graded one takes a typed score like a manual
  column, which is how a faculty override is entered.
- **Students, My grades** — graded sims appear under Graded work. Participation columns appear in
  their own **Participation** section, as "Completed" with the date or "Not yet", under a line saying
  they carry no marks and do not count towards the grade.
- **CSV export** — participation columns export as `Completed` or blank, with the header marked
  `(participation)` and no points possible. The four LMS-shaped formats and the generic one carry
  them; **Brightspace/D2L stays per-item**, as in Spec 11.

### "From the sim's result" was dropped

The spec asked whether any sim reports a number that could grade the run. **None does**, so the rule
was left out. Across all 13 production sims, no completion payload contains a key named score,
points, grade, mark, correct, percent, pass or fail. What arrives is counts of behaviour (several of
them negative indicators, none normalised to a maximum), scenario quantities in domain units, and one
self-rating. The most score-like value, sim 09's `fund`, is not even a number — it is passed through
`E.display()` and arrives as "$12.34M". Sim 08's tier is disclaimed in its own engine: "No score, no
tier label." The full evidence is in the spec's Decisions section.

## Migration

`drizzle/0017_sim_columns.sql`, applied by `auto-init` on deploy. One additive, nullable column:

- `line_items.score_rule` — `report | completion | manual` for sim columns, NULL on every other kind,
  which is what every existing row is.

## Tests

`npm run test:sim-grades` — 16 assertions covering each of the spec's nine rules: one column per sim,
in Simulations when that category exists; a student completion fills the cell while faculty and
preview launches do not; earlier completions already present when a sim is added later; a second
completion changing nothing; a typed score surviving a completion; manual creating no scores;
removing the sim keeping the column and its scores; the column counting in Simulations and in the
course grade; and faculty-only access to the points and the rule. Plus the participation default
being out of every total, switching back to `report` keeping typed marks, the student view separating
participation from graded work, the export's `Completed` cells, and a class with no Simulations
category leaving the column uncategorised.

Spec 11's `test:gradebook` (12), `test:gb-starter` (7) and `test:grading` (26) pass unchanged, which
is the evidence that none of this moved an existing grade.
