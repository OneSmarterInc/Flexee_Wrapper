# Spec 18 — Import polish, matching by D2L username, and clean-up of test accounts

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 4 October 2026 · Save as `docs/specs/18_Import_Polish.md` (first commit).
Covers backlog items W22 (as a script), W23, W24 and W25.

## Why

The first live tests of Spec 17 (4 October) showed four things:

1. D2L has a built-in role, **"Demo Student"**, and the importer skips it, because only the exact role "Student"
   creates an account.
2. With nothing to create, **both confirm buttons still appear**, and the dark primary one is "Create accounts
   and email invitations".
3. A real class list was imported into a test class under the rehearsal domain, so **real students now have
   accounts with `@rehearsal.invalid` addresses**. A later real import would look for each student by email, find
   none, and try to create a second account with the same D2L username, which the unique index rejects.
4. **Test classes and accounts can't be removed** from the screens.

## Before writing any code

1. Read how `commitD2lImport` finds existing accounts, and what happens when it meets a unique-index collision on
   `users.d2l_username` with a different email. **Report whether it fails, partly applies, or skips, and
   reproduce it in a test.**
2. Find every statistic and list that counts students: class averages, item analysis, mastery rollups, "Who has
   played", progress counts, the gradebook. **Report which would need to exclude a demo account.**
3. List every table that references a user or a class, in the order they must be deleted.
4. Propose a plan and list open questions. **Wait for my go before building.**

## What to build

### 1. Demo Student

- Treat the role "Demo Student" (compared ignoring case) like a student, but flag it as a **demo** (an
  enrolment-level flag is the natural place; propose one).
- It is **never emailed**, even when the faculty choose "email invitations now", and it is left out of "Resend to
  everyone not set up". **Copy link** works, so faculty can sign in as it and preview the student view.
- It is **excluded** from class averages, item analysis, mastery rollups and progress counts (the ones you find in
  report 2), and shown as **"Demo"** on the class list. It stays **in** the D2L grade export, so it matches D2L's
  own row.
- The preview lists it as "demo account: created, never emailed".

### 2. A safer confirm step

- When nothing would be created, confirmation is disabled.
- **"Create accounts only"** is the default action.
- Emailing is its own step that states the count and the domain ("This will email 28 students at wright.edu") and
  needs a second click.

### 3. Match by D2L username first

- When importing, look for an existing account by D2L username first, then by the derived email. A match enrols
  that account (attaching the D2L username if it has none) and **never creates a second one**.
- A match whose email on file differs from the derived one is shown in the preview as "existing account, email on
  file differs", and is **not invited** automatically.
- A collision is reported as a problem row. It never throws, and the import is **all-or-nothing**: it never
  half-applies.

### 4. Clean-up of test data (a script, not a screen)

- `npm run cleanup:test-data`. A **dry run by default**: it prints, per table, what it would delete. `--apply`
  deletes.
- **Targets:** every account whose email ends in the domain given with `--domain`, and optionally one class by id
  (`--class`), with everything that references them. **Only reserved test domains are accepted** (`.invalid`,
  `.test`, `.example`, `.localhost`); any other domain is refused.
- It **skips any account holding exam attempts, submissions or grades** unless `--include-work` is given. The dry
  run says how many accounts hold work. It skips faculty and admin accounts unless `--include-faculty` is given.
- With `--apply` it prints the database host (never the password) and requires the operator to type that host
  before anything is deleted.
- It logs counts only: no names, emails or ids.

## Rules (tests must prove each)

1. A "Demo Student" row is created as a student flagged demo, never emailed (even with "email now"), left out of
   bulk resend, reachable by Copy link, excluded from each statistic found in report 2, shown as "Demo", and
   included in the D2L export.
2. A student whose D2L username matches an existing account with a different email is enrolled, gets no second
   account and no exception, appears in the preview as "email on file differs", and is not invited.
3. A collision never throws or half-applies, and problem rows are listed.
4. With nothing to create, confirmation is disabled. "Create accounts only" is the default, and emailing needs its
   own step showing the count and the domain.
5. Clean-up: the dry run deletes nothing and prints counts; `--apply` without the typed host does nothing; a
   non-test domain is refused; accounts with work are skipped unless `--include-work`; faculty and admins are
   skipped unless `--include-faculty`; after applying, no row references a deleted account (a table census) and
   every other class's data is untouched.
6. After the clean-up, importing the same real-format list under `wright.edu` creates fresh accounts without error.

## Process

As before: a migration only if the demo flag needs one (the next number); `docs/changes/18_Import_Polish.md`,
including how to run the clean-up safely; every suite passes; commits authored as me; **show me the summary and ask
before pushing**; `git pull --rebase` first. Put no real student data in the repository.

## After it ships (not part of this build)

I run the clean-up (dry run first) against the live database, with `DATABASE_URL_UNPOOLED` given to Claude Code
only, never pasted in the chat. Then the real import can go ahead.

## Decisions (4 October 2026)

Settled after the "before writing any code" reports: the collision reproduced against the shipped
importer, an inventory of everything that counts students, and the delete order proved by seeding a
student with work and deleting them.

### A correction to this spec's premise

"Why" item 3 says a later real import "would try to create a second account with the same D2L
username, which the unique index rejects". **That is not what happens.** Spec 17 already guards the
index, so nothing is rejected and nothing throws. Reproduced, with a rehearsal import under
`rehearsal.invalid` followed by the real import under `wright.edu`:

- The preview reports `willCreate: 1`, plan **"create"**, with the warning "another account already
  uses this D2L username, so it will not be stored on this one" — and lists the rehearsal account
  under "on this class but not in the file", so both halves of one person appear on one screen
  without anything saying they are the same person.
- The commit returns `{created: 1, enrolled: 0, invited: 1, skippedUsernames: 1}` and **throws
  nothing**. The result is **two accounts for one student**, both enrolled as students, with an
  invitation emailed to the new one, and `d2l_username` left on the rehearsal account.
- **The real damage is in the grade export.** Both accounts key to the same cell — one from the
  stored username, the other from the email's local part, which *is* the username — so the D2L
  export carries `"m204kqr"` **twice**. D2L matches on Username, so it would take one row and
  silently discard the other's grades. A duplicate account is recoverable; a grade import that
  quietly drops marks is not.

So the fault is a silent duplicate, not an exception. **It skips**; it never half-applies today only
because nothing has yet failed mid-import — `commitImport` runs one insert per row with no
transaction, so rule 3 holds by luck rather than by construction.

Two further findings that shape the work:

- **The cascade is complete.** One `DELETE FROM users` removes that person's identities, sessions,
  invitation tokens, enrolments, bookmarks, submissions and their files, exam attempts and
  responses, line-item scores, and every sim launch, completion, transcript and preview grant. One
  `DELETE FROM sections` removes its enrolments, assignments, exams, line items and class sims. No
  explicit order is *required*; the order in the clean-up exists for the dry run's report.
- **Two things the cascade does not do.** `ON DELETE SET NULL` quietly blanks authorship
  (`sections.created_by`, `assignments.created_by`, `submissions.graded_by`, `class_sims.added_by`,
  `sim_previews.granted_by`, `library_uploads.published_by`), which is why `--include-faculty` must
  be opt-in; and **Blob storage is untouched** — `submission_files`, `assignment_files` and
  `library_uploads` rows go, the uploaded objects stay, and nothing in the app deletes a blob except
  the intake job.

### 1. The demo flag is `enrolments.is_demo`

Migration **0019**, additive, `not null default false`. Not a `role = 'demo'`: a new role would drop
the demo out of every existing `role = "student"` query, including the gradebook and the export that
rule 1 says must keep it, and would still let it read the book.

### 2. The demo row stays in **all five** exports

Generic, Canvas, D2L, Blackboard and Moodle. They are roster-shaped files, and D2L's must keep it.

### 3. The instructor-practice hole is fixed here

Class averages, item analysis, class mastery, the AoL report and the assignment counts all count
**only student enrolments that are not demo**. Today none of them filters by role at all, so an
instructor's own practice attempt is already inside the exam average, the item analysis and class
mastery. A test covers it.

### 4. Demo stays visible, and labelled

In the per-student mastery matrix, the assignment submission list and "Who has played". Hiding it
would leave faculty wondering where their own test run went.

### 5. A username match whose email differs

Enrol the existing account, **leave its email alone**, **do not invite it**, and show it in the
preview as **"existing account, email on file differs"**. No automatic email update, in this build or
as an offer.

### 6. Blob: report and leave

The clean-up prints the **count** of uploaded files orphaned by the records it deletes, and leaves
them. No blob delete is built here.

### 7. The live clean-up targets both

The rehearsal accounts **and** the Rehearsal class, through `--class`.

### Also in this build

**(a) The D2L export refuses to write a file with a duplicate Username key.** It names the students
involved and stops. This is the real protection against dropped grades: the duplicate accounts are
only one way to arrive at two rows with one key, and the export is the single place every way
converges. A new rule, with a test.

**(b) `commitImport` runs inside a real transaction**, so "never half-applies" is true by
construction rather than by luck.

**(c)** The premise correction above is recorded here rather than left implicit, because the fix the
spec asks for (match by username first) is right for a different reason than the one it gives: it
prevents a silent duplicate, not an exception.
