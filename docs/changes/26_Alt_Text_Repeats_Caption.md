# 26 — Warn when a figure's alt text repeats its caption

Backlog item W38. The spec and the decisions behind it are in
[`docs/specs/26_Alt_Text_Repeats_Caption.md`](../specs/26_Alt_Text_Repeats_Caption.md).

A screen-reader user who hears the caption and then hears the same sentence again as the alt text
has learned nothing about the picture. Spec 21 taught the intake to warn on a missing alt text and
on one that only repeats "Figure N.M"; this is the third case. It is a **warning, never a stop**,
and there is **no migration**.

## The headline: the check finds nothing on any book today

Measured on 7 October against the real packages, read-only, under `G:\My Drive\Flexee`:

| Book | Figures | With a separate caption | Alt text repeats the caption |
|---|---|---|---|
| SAD (`fz1001`) | 48 | 48 | **0** |
| MIS 3000 (`mis3000`) | 25 | 0 | 0 |
| MIS 4950 (`fz1003`) | 10 | 10 | **0** |

The spec was written from SAD as it stood on **6 October**, when its alt texts did repeat their
captions word for word. SAD and MIS 4950 were both revised to the convention on the 7th, before
this was built. So the check ships having nothing to report, which is the outcome everyone wanted
and not a reason to doubt it: what the rules are proved against is a set of constructed figures,
one per rule, and the real-book measurement is an anti-regression check that **also refuses to pass
vacuously** — it requires SAD and MIS 4950 to carry captions, so "0 repeated" cannot come from
having compared nothing.

MIS 3000's figures are all old-style, so it has nothing to compare at all. That is reported
differently, on purpose: see below.

## What the Books coordinator will see

Three sentences, one of which appears on every intake, beside the figure-alt gate's own words:

```
| Figure alt text | pass | 48 figures, every one with alt text that says more than its number;
  alt text vs caption: checked 48 figures with captions, none repeated |
```

```
alt text vs caption: checked 48 figures with captions, 3 repeated
```

```
alt text vs caption: no figure has a separate caption yet, so there is nothing to compare
  — see the figure authoring guide
```

The report otherwise prints only the categories that have findings, so a clean book would have said
nothing whatever about this check and there would be no way to tell "checked, nothing repeated" from
"never ran". The third sentence exists because **"0 out of 0" reads as a clean result when in fact
nothing was examined**, which is MIS 3000's position exactly.

The two counts are taken from the same read of the markdown as the comparison itself, so the line
cannot disagree with the warnings printed beside it.

When the check does fire, it reads like the other figure categories — a count and the first few
figures, named by figure number where the file name gives one (`ch4 Figure 4.1`) and by file name
where it does not (`ch7 fig-03.png`), because MIS 3000's naming carries no number and the file name
is then the only handle the coordinator has.

## How the two sides are compared

Lower-case; strip a leading `Figure 4.1` / `Fig. 4.1` / `Table 4.1` label and whatever punctuation
follows it; collapse runs of whitespace; strip trailing `. , ; : ! ? — -`. So all of these are the
same sentence, and a figure whose alt text is any of them while its caption is another warns:

- `Figure 4.1: Context diagram for the course registration system`
- `context diagram for the course   registration system.`
- `Context Diagram for the Course Registration System`

Two consequences are deliberate rather than accidental:

- **A figure with no separate caption is never flagged.** In the old style the caption is *made
  from* the alt text, so the two are equal by construction and nothing is being repeated. This is
  the spec's rule 4, and it falls out of the data — the comparison returns early when there is no
  caption — rather than needing a rule of its own.
- **Either side normalising to empty means no warning.** That is what a number-only alt text does
  once its label is stripped. Spec 21 already reports such a figure under "number only alt text",
  and a naive comparison would call the two empty strings equal and name the same figure twice for
  one fault.

## The deliberate breakage the spec asks for

Two, because the first one halts the suite before the check that is specifically about case.

1. **`normalise_for_compare` made case-sensitive** (drop the `.lower()`). The normalisation check
   fails first: `AssertionError: ('Figure 4.1: Context diagram for the course registration system',
   'Context diagram for the course registration system')` — the label was still stripped, so what
   the message shows is the case surviving.
2. **The comparison made to use the raw strings** instead of the normalised ones. Normalisation and
   rule 1 still pass, and **rule 2 fails**: `AssertionError: ('case', [])` — the suite names which
   of the six differences it planted, and `[]` is the warning that should have been there.

Both were reverted; the working tree is clean of them.

## The other two things in this branch, neither of them Spec 26

### SAD is re-keyed to `fz1001`

Found when the suites that read SAD's real packages started failing. SAD's Drive folder was renamed
`MIS3250_v2_CURRENT` to **`FZ1001_v2_CURRENT`**, its register v6.21 now carries
`| Catalog number | **FZ1001** |`, and the question bank is re-keyed from `sad` to `fz1001`. Eleven
files in the repository named the old folder and are updated; three keep it on purpose, because they
record what was true when they were written: `docs/changes/07_Library_Upload.md`,
`docs/changes/15_Book_Titles.md`, `docs/specs/15_Book_Titles.md`.

Three suites had hard-coded a fact about SAD that is no longer true. **All three were corrected to
the new ground truth rather than loosened**, which is worth stating because the lazy fix in each
case was to assert less:

| Suite | Was asserting | Now |
|---|---|---|
| `test:catalog` | SAD and MIS 3000 are the two registers with **no** catalog row | narrowed to MIS 3000, and SAD gets a **stronger** check: an upload as `fz1001` passes, one as `sad` stops with both ids named. The gate is now pinned against two real registers, not one |
| `test:reports` | the closing line names the empty-table-header gate; the intake runs as `sad` | runs as `fz1001` (the catalog gate now stops `sad`), and reads the warning gates **out of the report**, requiring the closing line to agree with them — and, when there are none, requiring the warnings clause to be **absent** |
| `test:spelling` | exactly one warning across the three books: `practising` in SAD ch08 | **nothing** in any book, which is the property that matters (these patterns must not flag correct American prose) — paired with a new check that every book contributed at least ten chapters and that the patterns still fire on a planted sentence, so "nothing found" cannot be "nothing read" |

The empty table header cells listed for the Books coordinator in Spec 21's note are fixed too: SAD's
clean shelf now reports **no warning gates at all**.

### A crash in the intake, as old as the repository

Running the real intake on all three books to check the new line, **MIS 3000 died with a
`UnicodeDecodeError`** before printing its report. `questions.json` was read with `read_text()` and
no encoding, so Python used the platform default — cp1252 on Windows — and the first smart quote in
the question text ended the run. `objectives.json` and `intake.lock.json` were read the same way,
while every *writer* in that file already passes `encoding="utf-8"` explicitly.

It needs two things to coincide: a non-UTF-8 default encoding and a staged file containing
non-ASCII text. The hosted runner is Linux, where the default is UTF-8, so **the live intake was
never affected**, and SAD and MIS 4950 are pure ASCII in those two files. With the three reads given
an encoding, MIS 3000 completes and reports READY TO APPROVE — and since it is the only book whose
figures are all old-style, it is the only one that exercises Spec 26's third sentence at all, which
is why it was worth fixing here rather than filing.

## What the tests do not judge

- **Nothing was run against the live database**, and nothing on Drive was written. The real-book
  figures above come from read-only reads of the chapter packages.
- The check is **advice to an author**, not a measure of quality. Alt text that differs from the
  caption by one word is not flagged and may still be useless; alt text that genuinely describes
  the picture in the caption's own words would be flagged and a human should overrule it. It is a
  warning for that reason.
- `test:sims` needs `RAPIDSIMS_REPO` pointed at a checkout of `OneSmarterInc/Disaster_New`; its
  default `/tmp/rs` does not exist on Windows. On this machine that is
  `RAPIDSIMS_REPO=D:/Code/Wrapper/Disaster_New`. Unrelated to this work, and it passes once set.
