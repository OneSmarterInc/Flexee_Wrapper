# Spec 26 — Warn when a figure's alt text repeats its caption

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 7 October 2026 · Save as `docs/specs/26_Alt_Text_Repeats_Caption.md` (first commit). Covers backlog item W38.

## Why

SAD's figure alt texts repeated their captions word for word, and the intake passed them, because they were real words. A
screen-reader user then hears the same sentence twice, and learns nothing about what the picture shows. Spec 21 already warns on
a missing alt text and on one that only repeats "Figure N.M". This adds the missing case.

## What to build

In the intake's figure checks, next to the Spec 21 warnings: **warn when a figure's alt text is the same as its caption text**,
after normalising both by lower-casing, removing a leading "Figure N.M" label and the punctuation after it, removing trailing
punctuation, and collapsing runs of spaces.

- It applies only to figures that **have a separate caption** (a markdown title string). In the old style the caption comes
  from the alt text itself, so the two are always equal and nothing is repeated; those figures are not flagged by this check.
- It is a **warning, never a stop.** Report it in the same style as the other figure warnings: a count, and the first few
  figure numbers.

## Before you build

This is small. Send me a **one-paragraph plan** and any surprise (for example, if the figure parsing differs from what is
described here) and then build. Stop and ask only if something doesn't match.

## Rules (tests must prove each)

1. Identical alt text and caption warn.
2. A difference in case, trailing punctuation, spacing, or a leading "Figure 4.2:" on one side still warns.
3. Alt text that genuinely differs from the caption does not warn.
4. An old-style figure (no separate caption) is not flagged by this check.
5. The check never stops an intake, and its lines appear in the report with a count.
6. Every existing suite passes, including the Spec 21 figure checks. Run one deliberate breakage (for example, make the
   comparison case-sensitive) and show the suite catches it.

## Process

`docs/changes/26_Alt_Text_Repeats_Caption.md`; no migration; commits authored as me; **show me the summary and ask before
pushing**; `git pull --rebase` first. Don't run anything against the live database.

---

## Decisions (7 October 2026)

Settled from the one-paragraph plan, plus one addition and one surprise found while measuring.

### 1. The addition: the check prints a line even when it finds nothing

The report only prints categories that have findings, so a clean book would have said nothing at all
about this check and there would be no way to tell "checked, nothing repeated" from "never ran". A
single line is printed on every intake, beside the figure-alt gate's own line:

- `alt text vs caption: checked 48 figures with captions, none repeated`
- `alt text vs caption: checked 48 figures with captions, 3 repeated`
- `alt text vs caption: no figure carries a separate caption, so there was nothing to compare`

The third sentence exists because "0 repeated out of 0" reads as a clean result when in fact nothing
was examined. MIS 3000, whose figures are all old-style, gets that line.

### 2. Normalising, exactly

Lower-case, then strip a leading `Figure 4.1` / `Fig. 4.1` / `Table 4.1` label and whatever
punctuation follows it, then collapse runs of whitespace, then strip trailing `. , ; : ! ? — -`.
Either side normalising to **empty** means no warning: that is what a number-only alt text reduces
to, and Spec 21 already reports it under "number only alt text". Without the rule, such a figure
would warn twice for one fault.

### 3. The surprise: both books had already adopted the convention

The spec's premise is SAD as it stood on 6 October. Measured on 7 October against the real packages
(read-only, under `G:\My Drive\Flexee`):

| Book | Figures | With a separate caption | Alt repeats the caption |
|---|---|---|---|
| SAD (`fz1001`) | 48 | 48 | **0** |
| MIS 3000 (`fz1002`) | 25 | 0 | 0 |
| MIS 4950 (`fz1003`) | 10 | 10 | **0** |

So the check finds nothing on any book today. That is the right outcome and not a reason to weaken
the test: what the rules are pinned against is a set of constructed figures, one per rule, and the
real-book measurement is an anti-regression check that also asserts the comparison is not vacuous
(SAD and MIS 4950 must have captions to compare).

### 4. SAD has been re-keyed to its catalog number

Found while running the suites that read SAD's real packages, and not part of this spec's subject:
the Drive folder is now `Flexee-SAD\FZ1001_v2_CURRENT` (was `MIS3250_v2_CURRENT`), register v6.21
carries `| Catalog number | **FZ1001** |`, and the question bank is re-keyed from `sad` to `fz1001`.
Eleven files in the repository named the old folder; all are updated. Three are deliberately left
alone because they are a record of what happened at the time: `docs/changes/07_Library_Upload.md`,
`docs/changes/15_Book_Titles.md`, `docs/specs/15_Book_Titles.md`.

Three suites were reporting the changed ground truth correctly, and were corrected rather than
loosened — the detail is in the change note.

### 5. No stop, no migration

The warning cannot stop an intake, and the gate it joins was already a warning gate. Nothing in the
database changes.
