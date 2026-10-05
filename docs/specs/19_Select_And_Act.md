# Spec 19 — Select and act on the class list, copy a grading setup, and a CSV of invitation links

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 5 October 2026 · Save as `docs/specs/19_Select_And_Act.md` (first commit).
Covers backlog items W26 and W27, and the January fallback for invitations when email isn't ready.

## Why

Faculty manage a class one student at a time today: a Remove button on each row, a resend per student. A class of
thirty with late adds, drops and a failed email needs checkboxes and one-click actions. Two dangers shape the design.
**Remove deletes work:** as far as the schema shows, removing an enrolment deletes that student's exam attempts,
submissions and grades in the class, and it may do so without warning. And **deleting needs guards**, because the
Wrapper is now the grade record. Separately, if email isn't ready in January, faculty need the invitation links
as a file they can send through D2L.

## Before writing any code

1. Read the faculty class list and its controls (Remove, Reset, resend, Copy link), and the code behind them.
   **Reproduce what Remove deletes today:** a student with an exam attempt, a submission and a score, then remove
   them. **Report exactly what disappears, and whether the page warns first.**
2. Find every place an enrolment grants access or counts a student: reading, exams, assignments, grades, sims,
   the assistant, head counts, statistics, exports, bulk actions. **List them.** A withdrawn student must be
   honoured in all of them, as the demo flag already is in the statistics.
3. Read the grading-setup code from Spec 11 (categories, weights, drop-lowest, the letter scale, retake rules) and
   report what "a grading setup" comprises, and what is per class and what is per exam or quiz.
4. Propose the schema (I expect `enrolments.withdrawn_at` and a small actions log), the plan, and open questions.
   **Wait for my go before building.**

## What to build

### 1. Select and act

- A checkbox beside each student, a select-all (visible rows only), and quick selections by state: not set up,
  invited, demo, withdrawn. A bar appears when anything is selected, showing the count and the actions.
- The server **re-checks every selected id belongs to this class.** Nothing is trusted from the page.
- **Resend invitation:** skips demo accounts and students already set up; honours the three-per-hour limit; reports
  "sent N, skipped M" with the reasons.
- **Withdraw** (soft, reversible): the enrolment stays with all its records. The student loses access to the class
  (reading, exams, assignments, grades, the assistant), and drops out of every statistic, head count, bulk action
  and export, with a **Show withdrawn** toggle on the class list and gradebook. **Restore** undoes it.
- **Remove with records** (permanent): states the counts first ("this will delete 12 attempts, 4 submissions and 9
  grades"). When any records exist, it needs a typed confirmation. It deletes only that enrolment's records. The
  account stays.
- **Delete account** (**admins only**): allowed only for an account that never set a password, holds no work,
  belongs to no other class, and is not faculty or an admin. Typed confirmation showing the count.
- **Delete an empty class** (**admins only**, from the admin class page): refused while any student enrolment exists,
  withdrawn ones included. Typed class name.
- Faculty see Resend, Withdraw, Restore and Remove. Admin-only actions are hidden from faculty and refused if
  forced.

### 2. A log of who did what

- A small table: class, who, what, counts and when. **No names or emails.** Visible to the class's faculty and
  admins on the class page, e.g. "Removed 3 students (0 records)".

### 3. Copy a grading setup

- On the grading page: **Copy setup from another class.** The choices are classes the person teaches (admins: any).
  Show a **preview** of what will replace the target's setup, then confirm.
- Copies what Spec 11 report 3 calls per-class: categories with weights and drop-lowest, and the letter scale.
  Retake rules belong to individual exams and quizzes, so they aren't copied. Columns that can't be matched to a
  copied category are listed, not lost.
- Logged in the actions log.

### 4. A CSV of invitation links

- On the class list: **Download invitation links (CSV)** for the selected students, or everyone not set up.
  Columns: name, email, link, expires.
- Each download **issues fresh links** and retires earlier unused ones for those students. Demo accounts are
  included only if selected. Class faculty and admins only. The file is generated on the fly and never stored.
- A plain warning on the page: the file contains sign-in links, so treat it like passwords.
- Logged in the actions log (counts only). No token in any server log.

## Rules (tests must prove each)

1. Select-all picks only visible rows. The server rejects any id from another class.
2. Resend skips demo and set-up students, honours the limit, and reports sent and skipped counts.
3. Withdraw keeps all records. A withdrawn student cannot read, start an exam, submit, or use the assistant, and is
   absent from every statistic, head count, bulk action and export until restored. Restore reverses all of it.
4. Remove with records states the counts, refuses without the typed confirmation when records exist, deletes only
   that enrolment's records, keeps the account, and touches no other class.
5. Delete account is refused for admins' and faculty accounts, accounts with a password, work or another class, and
   for non-admins; when allowed it removes the account and its dependents (table census).
6. Delete class is admin-only, refused with any student enrolment, needs the typed name, and leaves other classes
   untouched (table census).
7. Copy setup previews first, replaces only the target's categories and scale, reports unmatched columns, and only
   works between classes the person may manage.
8. The CSV links each work once, retire earlier unused links, are available only to the class's faculty and admins,
   and are not stored. A captured log contains no token.
9. The actions log holds counts only: no names or emails.
10. Another class's faculty and any student get a refusal for every action here.
11. Accessibility: each checkbox is named for its student, the action bar is announced to screen readers, dialogs are
    keyboard-operable and trap focus, and the page passes the automated check used in Spec 14.

## Process

As before: a migration with the next number; `docs/changes/19_Select_And_Act.md`; every suite passes; commits authored as
me; **show me the summary and ask before pushing**; `git pull --rebase` first. Put no real student data in the
repository. Don't run anything against the live database.

## After it ships (not part of this build)

I try the class list on a test class of invented students, including a withdraw and restore, and a remove with a
typed confirmation. The CSV of links is the January fallback if email isn't ready.

## Decisions (5 October 2026)

Settled after the "before writing any code" reports: the current Remove reproduced against a
student with real work, an inventory of everywhere an enrolment matters, and the grading setup read
back out of Spec 11.

### What Remove does today

Reproduced with one student holding an exam attempt (two responses), a graded submission with a
file, a gradebook score, a reading position, a simulation completion, an assistant thread and an
invitation token, plus one score in a second class:

```
removeEnrolment(sectionId, enrolmentId)

enrolments 4→3 · bookmarks 1→0 · submissions 1→0 · submission_files 1→0
exam_attempts 1→0 · exam_responses 2→0 · line_item_scores 2→1
assistant_threads 1→0 · assistant_messages 1→0
```

The gradebook goes from one row to none, the export stops naming the student, and the exam reports
no attempts. The account, the identity and the password survive, as does the other class's score.

**There is no warning of any kind.** `removeStudentAction` is five lines — check `ownedSection`,
call `removeEnrolment`, redirect — behind a plain submit button. No dialog, no count, no undo. The
admin class page carries a second one-click Remove with the same behaviour.

**An asymmetry the reproduction exposed.** Attempts, submissions, scores, bookmarks and threads
hang off the **enrolment**; simulation completions, launches, transcripts and invitation tokens hang
off the **user**. So Remove-then-re-add used to leave a student's simulation completions intact
while every grade was gone — the record half-returned, which is worse than either outcome. Decision
7 settles it.

### Where an enrolment matters

A withdrawal has to be honoured in **9 entitlement gates** (`enrolmentForBook` alone guards nine
student pages, plus `courseContextForBook`, `studentEnrolmentForBook`, `openExamsForSection`, the
assignment trio, `prepareLaunch`, `gradesForStudent` and `getBookmark`), **15 counting sites**, **4
exports and pushes** (the five CSV formats through `gradebook()`, the D2L key check, the LTI grade
push, the AoL report) and **5 bulk actions** (`notSetUp`, `commitImport`, `syncRoster`,
`enrollByCode`, the clean-up).

Two differences from the `is_demo` flag Spec 18 added: withdrawal must also block **access**, which
a demo flag never did, and it must **survive** `enrollByCode` and `syncRoster` putting the row back.

### What a grading setup comprises

**Per class, and therefore copyable:** the categories (`name`, `weight`, `drop_lowest`, `position`,
with weights that must total 100%), the letter scale (`letter_scales.bands_json`, one row per
class, absent meaning the default A/B/C/D/F), and which column sits in which category
(`line_items.category_id`).

**Per exam or quiz, and therefore not:** `kind`, `attempt_limit` and `counted_attempt` — the retake
rules — with `feedback`, `time_limit_min` and `status` beside them.

Because copied categories are new rows with new ids, **`category_id` cannot be copied**: every
column in the target has to be re-matched by name, and the ones that match nothing are exactly the
"listed, not lost" the spec asks for.

### The decisions

1. **A withdrawn student sees the class**, with the line "You are no longer enrolled in this class.
   Your work is kept; ask your instructor." Not a 404 and not a `?need=` redirect, both of which
   read like a fault.
2. **They keep a read-only grades page**, and cannot read the book, sit an exam, submit, or use the
   assistant.
3. **`enrollByCode`, `syncRoster` and the D2L re-import leave `withdrawn_at` alone and report it.**
   The import preview lists such a row as "withdrawn earlier — restore from the class list". An LMS
   sync cannot silently reinstate anyone; restoring is a deliberate act.
4. **The LTI grade push skips withdrawn students and says so** — "pushed 28, skipped 2 withdrawn".
5. **Copy setup** previews how many students' totals will change and lists the unmatched columns. It
   is allowed when scores exist, behind a typed confirmation.
6. **Attempts, submissions and scores decide whether typing is required.** Bookmarks, assistant
   threads and simulation completions are listed in the counts but do not by themselves demand it.
7. **Remove with records also deletes that student's simulation completions, launches and
   transcripts for this class**, and the counts say so. Invitation tokens stay with the account,
   because they are how the person signs in rather than work they did.
8. **Both Remove buttons go through the guarded flow** — the class list and the admin class page. A
   student with no records at all can still go in one click behind a simple confirm, and removing a
   member of staff needs a simple confirm.
9. **The CSV is `invitation-links-<class>-<date>.csv`**, columns `name,email,link,expires` with
   `expires` a UTC date, and no comment line.

### Build order

The **guarded Remove comes first among the code commits**, so it can ship on its own: it is the one
piece that stops work being destroyed by a single click. Withdrawal, select-and-act, the admin
deletions, and copy-setup with the CSV follow.

### The schema

`enrolments.withdrawn_at` and `withdrawn_by`, and a `class_actions` log holding a class, an actor, an
action, a count and a JSON of counts — **no names, no emails, no student ids** — so rule 9 is true by
construction. Two migrations rather than one, so the guarded Remove ships without the withdrawal
column: **0021** `class_actions`, **0022** the two enrolment columns.
