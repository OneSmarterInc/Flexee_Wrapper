# 19 — Select and act on the class list, copy a grading setup, a CSV of invitation links

Backlog items W26 and W27, and the January fallback for invitations if email is not ready.

The spec and the decisions behind it are in [`docs/specs/19_Select_And_Act.md`](../specs/19_Select_And_Act.md).
**How to run the January fallback is at the end of this file.**

## What Remove used to do

Reproduced rather than inferred, before anything was built. One student with an exam attempt and
two responses, a graded submission with a file, a gradebook score, a reading position, a simulation
completion and an assistant thread:

```
removeEnrolment(sectionId, enrolmentId)       ← exactly what the button called

enrolments 4→3 · bookmarks 1→0 · submissions 1→0 · submission_files 1→0
exam_attempts 1→0 · exam_responses 2→0 · line_item_scores 2→1
assistant_threads 1→0 · assistant_messages 1→0
```

The gradebook went from one row to none and the export stopped naming the student. **There was no
warning of any kind** — five lines behind a plain submit button, and a second one-click Remove on
the admin class page. The Wrapper is the grade record now, so that is the first thing this changes,
and it is its own commit so it could ship alone.

The reproduction also found an asymmetry. Attempts, submissions, scores, bookmarks and threads hang
off the **enrolment**; simulation completions, launches, transcripts and invitation tokens hang off
the **user**. Remove-then-re-add used to leave a student's completions while every grade was gone —
the record half-returned, which is worse than either outcome.

## What changed

### Remove states what it will delete

The server counts what a removal would reach, from the same tables the delete will touch, so the
dialog's numbers and the deletion's effect come from one place and cannot drift. The dialog says
them — "This will delete 1 exam attempt, 1 submission, 1 grade, 1 reading position…" — and when any
**attempt, submission or score** exists, the phrase `delete records` must be typed. That is checked
on the server, not in the browser.

- A student with no records keeps the one-click path behind a plain confirmation, and so does a
  member of staff (decision 8).
- Simulation records for **that class** go too, and the counts say so (decision 7). Invitation
  tokens stay with the account, because they are how a person signs in rather than work they did.
- Both Remove buttons go through it. The two old actions remain as refusals, so an old form post
  cannot quietly delete a student's work.

### Withdrawal: the records stay, access and the counts go

`enrolments.withdrawn_at`, with `withdrawn_by`. Null means active.

The report before the build counted where this has to hold, and [`src/lib/withdraw.ts`](../../src/lib/withdraw.ts)
is the one predicate all of them use:

- **Access.** `enrolmentForBook` excludes a withdrawn enrolment, which shuts the nine student pages
  that share it in one place — and a page added later gets the safe answer without having to
  remember. The assistant, the simulation launch and the invitation lookup do the same.
- **Counts.** The gradebook roster, `examResults`, `sectionResponses` and `classMastery`, the AoL
  report, the assignment counts and the submission list, the sim completions behind a gradebook
  cell, and the head counts on the faculty and admin pages.
- **Exports.** All five CSV formats, through the gradebook, and the **LTI push**, which now says
  "and N withdrawn student(s) were left out" rather than silently pushing fewer grades than there
  are students.
- **Bulk actions.** `notSetUp`, so a withdrawn student is not waiting for an invitation.

The student **sees the class** with the agreed line — "You are no longer enrolled in this class.
Your work is kept; ask your instructor." — and keeps a **read-only grades page** (decisions 1 and
2). The class list and the gradebook both have a **Show withdrawn** toggle; the gradebook still
leaves them out of every export even while showing them.

**A withdrawal survives being re-added** (decision 3). `enrolAs` deliberately leaves `withdrawn_at`
out of its update set, `enrollByCode` reports it, and a D2L re-import marks the row "withdrawn
earlier — restore from the class list", counts it, and does not invite it. Restoring is an act a
member of staff takes on purpose, not a side effect of a sync running overnight.

### Select and act

The students' rows moved into [`ClassRoster.tsx`](../../src/components/ClassRoster.tsx), which holds
the selection; faculty and pending invitations stay in their own table below. One bar appears when
anything is selected, with **Resend**, **Withdraw**, **Restore**, **Remove** and the CSV download,
plus quick selections for not set up, invited, demo and withdrawn.

**Select-all and every quick selection work from the rows on screen**, never the whole class: a
checkbox that picks something the reader cannot see is a trap, and a selection that survives a
filter is how the wrong student gets removed.

One endpoint, `POST /api/class/act`, and every library behind it **re-checks each id against the
class**, so a selection carrying an id from another class is refused whole rather than filtered. The
admin-only actions are not on that route at all, so forcing it cannot reach them.

Resend skips a demo account, a student who already set a password, a withdrawn student, and anyone
who has had their three for the hour, and reports every reason by name: **"Sent 24, skipped 6: 4
already set up, 1 demo account, 1 withdrawn."**

### The actions log

`class_actions`: a class, an actor, an action, a count, and a JSON of counts. There is **no column
for a name, an address or a student's id**, so "the log holds counts only" is a property of the
schema rather than of the code that writes it. It reads back on the class page as "Removed 3
students (0 records)".

### The two deletions only an administrator may make

**Delete account** is allowed for an account nobody is using: never set a password, holds no work,
belongs to no other class, is not faculty anywhere, is not an administrator. Every failing condition
is reported together, so an admin learns all the reasons at once. The account's name must be typed.
Nobody can delete their own.

**Delete class** is refused while any student enrolment exists — **a withdrawn one included**,
because a withdrawal keeps that student's attempts, submissions and grades and deleting the class
would take them without saying so. The class's name must be typed.

Both are admin-only in the library, so the controls being hidden from faculty is a convenience
rather than the guard.

### Copy a grading setup

On the gradebook page: **Copy a grading setup**, from a class the person teaches (an admin: any).

What a setup *is* was the third report: **per class** — the categories with their weights and
drop-lowest, the letter scale, and which column sits in which category — and **per exam or quiz** —
the retake rules, which belong to the exam and are not copied.

The wrinkle: copied categories are new rows with new ids, so **`category_id` cannot be carried
over**. Every column in the target is re-matched **by name**, using the renderer's own `norm()` so
punctuation does not decide it, and the ones that match nothing are **listed and left
uncategorised, not deleted**.

The preview says what arrives, what is replaced, which columns match, which do not, and **how many
students' course totals will change**. With any score present it is allowed behind the class's own
name typed (decision 5), because the totals really do move.

### A CSV of invitation links

**Download invitation links (CSV)** for the selected students, or for everyone not set up.
`invitation-links-<class>-<date>.csv`, columns `name,email,link,expires` with `expires` a UTC date
and no comment line (decision 9).

Each download **issues fresh links and retires those students' earlier unused ones**, so a file that
has been forwarded is not a second way in beside the one in somebody's inbox. Without a selection
the list is "everyone not set up", which a demo account and a withdrawn student are not part of;
with a selection, a demo account is included because it was chosen. The file is generated on the
fly, served `no-store`, and never written anywhere. Nothing is logged but the count.

The page carries the plain warning: the file holds sign-in links, treat it like a list of passwords.

## Migrations

**0021** — `class_actions`. **0022** — `enrolments.withdrawn_at` and `withdrawn_by`. Two rather than
one, so the guarded Remove could ship without the withdrawal column.

## Tests

| Suite | Checks | What it holds |
|---|---|---|
| `test:remove` | **16** | the cost, the typed phrase, a census over 20 tables either side, the account and other class untouched, the log |
| `test:withdraw` | **16** | records kept, the gates, every count, all five exports, the bulk actions, the re-add paths, restore |
| `test:select-act` | **9** | resend's skips and reasons, a foreign id refusing the whole call, the rendered roster's accessibility |
| `test:admin-delete` | **9** | mostly refusals; one census over 17 tables |
| `test:grading-copy` | **14** | the preview, the name matching, the typed confirmation, the CSV's columns, a link that works once |

Two sabotages, run and undone: removing the typed-phrase check fails "without the typed phrase it
refuses, and deletes nothing"; the old intake rule put back fails six section-title cases.

Three mistakes of mine the tests caught, each noted in its commit: a fixture that named every exam
after the student, so the export test looked like a leak when the surviving column title was the
class's own; an off-by-one in the resend rate-limit case, where three sends had not yet gone; and an
assumption that `gradesForStudent` would still find a withdrawn student's own row after the
gradebook started excluding them.

### What the tests do not judge

- **The browser.** jsdom computes no layout, so focus visibility, the dialog's actual focus trap and
  touch-target size are outside its reach. The markup is checked — labelled checkboxes, a live
  region, a real `<dialog>` — not the behaviour a mouse and a screen reader would produce together.
- **A real download.** `linksCsv` and the route's headers are tested; whether a browser saves the
  file with that name is not.
- **Vercel Blob.** A removal deletes `submission_files` rows; the uploaded objects stay, as the Spec
  18 clean-up already documented.

## The January fallback

If email is not ready when Spring starts:

1. Import the class list from D2L, choosing **Create accounts only**.
2. On the class list, **Download invitation links** — everyone not set up, or a selection.
3. Send the file through D2L, or hand the rows out. Each link works once and expires in 14 days.
4. If a link is lost, download again for that student: the new one retires the old.

Treat the file like a list of passwords. Delete it when the class is set up.
