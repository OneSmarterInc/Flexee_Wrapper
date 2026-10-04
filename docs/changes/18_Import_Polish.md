# 18 — Import polish, matching by D2L username, and clearing out test data

Backlog items W22 (as a script), W23, W24 and W25. Everything here came out of the first live
import on 4 October.

The spec and the decisions behind it are in [`docs/specs/18_Import_Polish.md`](../specs/18_Import_Polish.md).
**How to run the clean-up safely is at the end of this file.**

## The fault that was not the one we expected

The spec expected the unique index on `users.d2l_username` to reject a second account and stop the
import. It does not. Spec 17 already guarded that index, so nothing throws. Reproduced against the
shipped importer — a rehearsal import under `rehearsal.invalid`, then the real import under
`wright.edu`:

```
preview:  willCreate 1, plan "create",
          warning "another account already uses this D2L username…"
          missing: Maria Alvarez · m204kqr@rehearsal.invalid    <- the same person, right there
commit:   {created: 1, enrolled: 0, invited: 1, skippedUsernames: 1}   no exception
after:    Maria Alvarez  m204kqr@rehearsal.invalid  d2l_username=m204kqr
          Maria Alvarez  m204kqr@wright.edu         d2l_username=null   <- a twin, enrolled, emailed
```

and then, in the grade export:

```
"Username", …
"m204kqr","","","#"
"m204kqr","","","#"      <- one key, twice
```

**That is the damage.** D2L matches on Username. A file like that does not fail on import: it
applies one row, discards the other, and nobody notices the missing marks. A duplicate account can
be merged; a grade import that quietly drops half a class cannot be undone.

## What changed

### A person is found by D2L username first

Then by the derived email. The old order created a twin for every student whose address had moved.

- A match whose **address on file differs** is enrolled, its address is **left alone**, it is **not
  invited**, and the preview says "existing account, email on file differs (…) — enrolled, not
  invited". The derived address may belong to nobody; the one on file is not ours to guess at.
- An account with **no username yet** is matched by email and given one.
- **Two different accounts matching one row** — one holding the username, another holding the
  address — is a **problem row**, listed and skipped. Any choice there would be a guess.

### The import is all-or-nothing

`commitImport` runs inside a transaction, so a failure part way through leaves the class exactly as
it was rather than half a roster. The **invitations are sent afterwards, outside it**: an email that
fails must not undo accounts that were created correctly.

### D2L's Demo Student

Every D2L class ships with one. Spec 17 skipped it, because only the exact role "Student" counted.
It is now imported as a student with **`enrolments.is_demo`** set (migration 0019):

- **Never emailed**, however faculty confirm, and out of every bulk resend. **Copy link** works, so
  faculty can sign in as it and see what students see.
- **Out of every class statistic** (below), **in** the gradebook and **in all five exports**, so the
  file still matches D2L's own row.
- Shown as **"Demo"** on the class list; the head counts leave it out and name it beside the number
  ("27 students · 1 demo").
- The flag is only ever **raised, never lowered**: a later export that lists it as "Student" does
  not quietly turn the account faculty have been signing into into someone whose marks count.

A flag rather than a `role = 'demo'`, so nothing drops out of the existing `role = "student"`
queries — including the export that has to keep it.

### A class statistic counts the class's students

Only student enrolments that are not demo: the exam's **class average** and **item analysis**,
**class mastery**, the **AoL report**'s student count and measures, and an assignment's **"N
submitted"**.

**Three of those filtered by nothing at all before this.** An instructor who ran through their own
exam to check it was already inside the class average, the item analysis and the class mastery
percentages. That is fixed here, because it is the same one line in each place.

The **lists stay lists**: the per-student mastery matrix, the assignment submission list, "Who has
played", the gradebook and every export still show the demo, labelled. Faculty use those pages to
check their own test run, and hiding it would only puzzle them.

### The D2L export refuses to lose marks

If two students in a class share a Username key, the export is **not written**. The response names
the key and the students, and says to merge the accounts or correct their usernames. A blank key is
not a duplicate — those are flagged beside the export links, as before.

Duplicate accounts are only one way to arrive at that shape; a hand-edited username or a fallback
that collides with a stored one are others. Every one of them passes through the export, so the
export is where it stops.

### Confirming is two clicks

- **Nothing to write means nothing to confirm.** The button is disabled and says why. (The live
  test showed a dark "Create accounts and email invitations" button for a file whose only
  importable row was the demo student.)
- The confirm button **names what it will do** — "Create 6 accounts and enrol 2" — and sends no
  email.
- **Emailing is its own step.** It states the count and the domain — "This will email 28 students at
  wright.edu." — and needs a second click. The count comes from the server, so it is not a guess,
  and it is the same list the class page's "Resend to everyone not set up" uses.

An **enrol-only** import (nothing to create, people to enrol) stays possible: the button is disabled
only when neither number is above zero. Blocking a valid enrol-only import would have been a bug,
so this reads rule 4 as "nothing to write", not "nothing to create".

## Migration

**0019** — `enrolments.is_demo boolean not null default false`, with an index on
`(section_id, is_demo)`. Additive: every existing query keeps working, and every existing enrolment
is not a demo.

## The clean-up

`npm run cleanup:test-data`. **A dry run by default**: it prints, per table, what it would delete,
and deletes nothing.

```bash
npm run cleanup:test-data -- --domain rehearsal.invalid
npm run cleanup:test-data -- --domain rehearsal.invalid --class <id> --apply
```

- **Only reserved test domains**: `.invalid`, `.test`, `.example`, `.localhost`. Anything else is
  refused before it reads a single row, so it cannot be pointed at `wright.edu` by a slip.
- **It spares an account holding work** — an exam attempt, a submission or a grade — unless
  `--include-work`. The dry run says how many hold work.
- **It spares faculty and administrators** — an admin account, or anyone who teaches any class —
  unless `--include-faculty`. (Deleting a faculty account does not fail: it blanks the authorship of
  their assignments, because those columns are `ON DELETE SET NULL`. Hence opt-in.)
- `--class <id>` takes one class and its own furniture as well.
- With `--apply` it prints the **database host, never the password**, and the operator has to type
  that host back before anything is deleted.
- **It logs counts only.** No names, addresses or ids, beyond the class id the operator passed in.

Two things worth knowing about what it does:

- **The cascade does the work.** One `DELETE FROM users` takes that person's identities, sessions,
  invitation tokens, enrolments, bookmarks, submissions and their file rows, exam attempts and
  responses, line-item scores, and every sim launch, completion, transcript and preview grant; one
  `DELETE FROM sections` takes its enrolments, assignments, exams, line items and class sims. Both
  run in one transaction. The long per-table list in the report exists to say what those two
  statements will reach.
- **Blob storage is not touched.** The rows that point at uploaded files go; the objects stay. They
  are **counted and reported** — "uploaded files left in Blob storage: 3" — and left, by decision.
  Nothing in the Wrapper deletes a blob except the intake job.

## Tests

- `npm run test:demo-account` — **24 checks**. One group per rule. A class with one real student,
  one demo and the instructor's own exam attempt proves each statistic counts one person; the
  rehearsal-to-real import proves no twin; a row whose display name cannot be stored proves the
  transaction (the good row before it is rolled back too); and the export refusal is checked for the
  key, the students and the advice.
- `npm run test:cleanup` — **13 checks**, written the other way round from the rest: most of it is
  about what is *not* deleted. The real class, an account holding marks, a faculty account, a test
  admin — and nothing at all before `--apply`. After applying, twelve joins confirm nothing
  dangles, and the other class is byte-for-byte as it was. The command itself is run as a child
  process for the domain refusal.
- `npm run test:d2l` — **36 checks**, unchanged in number but two moved with the behaviour: its
  username-collision case used to prove a twin was created without an exception, and now proves no
  twin is created at all.

Four sabotages, run and undone: dropping the export's conflict check loses "Missing expected
rejection"; making the demo filter unconditional counts four answers where two are the class's;
making the clean-up delete everything it matches takes six accounts instead of two; and letting any
domain through fails on "wright.edu must be refused".

### What the tests do not judge

- **The typed-host prompt.** `confirmed()` is tested directly, and the script's ordering is asserted
  against its own source (the dry-run exit and the host check both precede `applyCleanup`). A person
  typing at a terminal is not simulated.
- **The confirm step's markup.** The decisions behind it — `nothingToWrite`, `confirmLabel`,
  `emailSentence` — are pure and tested; which element is disabled is not.

## The fixture

`scripts/fixtures/d2l_class_list.csv` now carries a `Demo Student` row, because a real D2L export
always does. Still invented people, still byte-exact (CRLF, no BOM, D2L's own column order).
