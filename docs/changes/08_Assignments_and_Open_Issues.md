# Flexee Wrapper — Step 3: Assignments and Case Studies, and Open Issues

**29 September 2026** · Patch `0008-assignments.patch` · applies on top of the code Akshay sent on 29 Sep
(which already has changes 1–7 and his own hardening). For Akshay, and for Vikram's record.

---

## Part 1 — What step 3 adds

### The flow

**Faculty** open a class → **Assignments** →

1. **Create** an assignment or a case study: title, instructions, due date and time, points, whether
   late work is accepted. It starts as a **draft**; students cannot see it.
2. **Attach files** for students (the brief, a data file, a case document) — up to 10, 50 MB each.
3. **Publish** it (tick "Published" and save). Students in the class now see it.
4. See **every student** with their submission state: not submitted, submitted, late, graded.
5. Open a submission, read the text, download the files, and **grade** it: a score (halves allowed)
   and written feedback. **The score goes straight into the gradebook**, in the assignment's own column.
6. If a student should revise, **Reopen for revision**: the student can resubmit, and the score is
   taken out of the gradebook until it is graded again.

**Students** open their course → **Assignments** →

1. See the class's published assignments, each with its due date and their own state.
2. Open one: read the instructions, download the attachments, and **submit** text, files, or both.
3. Until it is graded they may **replace** the submission (text and files together). After the due
   date a submission is **marked late** — or refused, if the assignment does not accept late work.
4. Once graded they see the **score and feedback**, and the submission is locked.

### Rules the code enforces (and the tests prove)

| Rule | Where |
|---|---|
| Only the class's faculty create, edit, attach, see submissions and grade | every function in `src/lib/assignments.ts` checks, not the pages |
| Students see only published assignments of their own class | `studentAssignments`, `assignmentForStudent` |
| A student cannot submit into another student's storage path, or submit nothing | `submit` |
| Resubmitting replaces text and files; a graded submission is locked | `submit` |
| Late work is marked late when allowed, refused when not | `submit` |
| A grade must be between 0 and the assignment's points | `gradeSubmission` |
| Points cannot be lowered below a grade already given | `updateAssignment` |
| An assignment with graded work cannot be deleted (unpublish it instead) | `deleteAssignment` |
| Attachments: the class's faculty, and its students once published. Submission files: the student who submitted and the class's faculty — **not classmates** | `downloadable`, used by `/api/files/[kind]/[id]` |
| Upload permissions are issued only for the path a person is entitled to | `uploadPrefix`, used by `/api/files/upload` |

### Due dates and time zones

A browser's date-and-time field has no time zone. Stored naively, a server running in UTC would move an
11:59 PM Dayton deadline to 6:59 PM. Due dates are therefore entered and shown in the **institution's
time zone**, set by `APP_TIMEZONE` (default `America/New_York`), and the conversion is checked across
winter, summer and the day the clocks change (`src/lib/time.ts`).

### Files

Files go **from the browser straight to private Vercel Blob storage** (no size strain on the server),
under paths the server authorised: `assignments/<assignment>/…` for faculty attachments,
`submissions/<assignment>/<student>/…` for submissions. Downloads go through
`/api/files/<assignment|submission>/<id>`, which checks access first and streams the file as a
download; the storage address never reaches a browser.

### The gradebook

Each assignment gets a gradebook column (a line item of kind `assignment`), created with the assignment,
renamed and re-scaled when the assignment is edited, and removed if the assignment is deleted. Grading
writes the score there; reopening removes it. Weights are set on the gradebook page as for any column.

### New and changed files

| File | What |
|---|---|
| `drizzle/0014_assignments.sql` | Tables `assignments`, `assignment_files`, `submissions`, `submission_files` |
| `src/db/schema.ts` | The same four tables |
| `src/lib/assignments.ts` | All assignment logic and access rules |
| `src/lib/time.ts` | Due dates in the institution's time zone |
| `src/app/assignment-actions.ts` | Server actions for the forms |
| `src/app/api/files/upload/route.ts` | Upload permissions for attachments and submissions |
| `src/app/api/files/[kind]/[id]/route.ts` | Access-checked downloads |
| `src/components/FilePicker.tsx`, `AssignmentFields.tsx` | The file picker and the assignment form fields |
| `src/app/teach/[section]/assignments/…` | Faculty: list and create; assignment page; grading page |
| `src/app/[book]/assignments/…` | Students: list; assignment and submission page |
| `src/app/teach/[section]/page.tsx`, `src/app/[book]/page.tsx` | Links to Assignments |
| `scripts/it-assignments.ts`, `package.json` | Tests; `npm run test:assignments` |

### Apply and test

    git am 0008-assignments.patch
    npm install
    npm run test:assignments      # 19 passed

Migration 0014 is applied automatically on the next production deploy (Akshay's `auto-init`), or by
`npm run db:deploy`. No new settings are needed; `APP_TIMEZONE` is optional. The same Blob store is used.

All other suites still pass: library 13, publishing 14, admin 12, storage 13, intake 13, and the twelve
older `it-*` scripts. The app builds cleanly with the seven new pages and routes.

### Check on the test site

1. As faculty: create an assignment due tomorrow at 11:59 PM, attach a PDF, publish it.
2. As a student in the class: open **Assignments**, download the PDF, submit text and a file.
3. Resubmit with different text: the earlier text and file are replaced.
4. As faculty: the submission shows **to grade**; grade it 8/10 with feedback. Open the **gradebook**:
   the score is in the assignment's column.
5. As the student: the score and feedback show, and the submit form is gone.
6. As a second student: try the first student's file address — **Not found**.
7. As faculty: **Reopen for revision** — the gradebook cell empties and the student can resubmit.

---

## Part 2 — Issues

### Found and fixed during this work (for the record)

| # | Issue | Fixed in |
|---|---|---|
| 1 | The live site served the MIS 3000 **answer key** to anyone at `/api/asset/mis3000/questions.json` | Change 1 |
| 2 | The intake could not read the **SAD register's current layout** (Lane / File / Bytes / Status); SAD's intake would have stopped | Change 4 |
| 3 | Ten older **test scripts had gone stale** (hard-coded migration lists); eight were failing on `main` | Change 3 |
| 4 | **Self-enrolment** let any signed-in user join any book's default class, bypassing publishing and the admin model | Change 6 |
| 5 | The new validator's "never the longest answer" warning **fired falsely on tied numeric options** ("20%", "25%") | Standards release of 28 Sep |
| 6 | Publishing a book briefly **left no live copy** between delete and upload | Akshay's hardening of change 7 |
| 7 | Workflow inputs were **interpolated into shell commands**; zips were extracted without **path and link checks** | Akshay's hardening of change 7 |

### Open — needs action now

| # | Issue | Why it matters | Action |
|---|---|---|---|
| 8 | **Docs say Supabase; the site runs on Neon.** The GitHub secret `DATABASE_URL_DIRECT` must be the **same Neon database's unpooled address** (`DATABASE_URL_UNPOOLED`) | If it points elsewhere, uploaded books are loaded into the wrong database and never appear | Akshay: check the secret; change "Supabase" to "Neon" in `docs/changes/07_Library_Upload.md` and `deploy/vercel/Vercel_Deployment_Runbook.md` |
| 9 | **Windows line endings** throughout the repository | Every future comparison shows whole files as changed, hiding real edits | Akshay: add `.gitattributes` with `* text=auto eol=lf`, then `git add --renormalize .` and commit once |
| 10 | The **two finished books are not yet in the library** | Students would still see the mid-September versions | Vikram: upload SAD and MIS 3000 through **Library**; Akshay: then set `CONTENT_STORE=blob`, `CONTENT_PREFIX=live/`, `CONTENT_BLOB_ACCESS=private` |

### Open — before real students (January)

| # | Issue | Notes |
|---|---|---|
| 11 | **Wright State's approval** for student data on Vercel, Neon and Vercel Blob | Waiting on the right contact. Assignments add student *work* (files) to what is stored, which the review should know |
| 12 | **Accessibility audit** (WCAG 2.1 AA) of the reader, quizzes, assignments and figures; alt text for all figures | Required of public universities under the ADA web rule; likely to be asked for in the review |
| 13 | **Grading rules**: which attempt counts on quiz retakes, and **category weights** (e.g. quizzes 15%, assignments 30%) | Today every column has a simple weight; categories are needed for real syllabi |
| 14 | **A data-handling statement** (what is stored, where, who sees it, how long) | Pairs with 11 and 12 |
| 15 | **Rehearsal on the live site** with made-up accounts: a whole term, including an assignment | Finds what tests cannot: settings, storage, time zones on the real host |

### Open — known limits of step 3, for later

| # | Limit | Proposed approach |
|---|---|---|
| 16 | **Files are never deleted from storage.** Replaced submission files, removed attachments and deleted assignments leave their blobs; files uploaded on a form that is never submitted remain too | Deliberate for now (student work is never lost by accident). Later: a monthly cleanup that deletes blobs no record points to, older than 30 days |
| 17 | **No notifications** (submitted, graded, due soon) | Needs the email adapter (Amazon SES or similar), already on the list |
| 18 | **No rubrics, group assignments or originality checks** | Rubrics are the natural next step; groups need team formation; originality checks need a third-party service and a privacy review |
| 19 | **Instructions are plain text** (line breaks kept, no formatting) | Safe by design. Markdown rendering can come with the course-page editor |
| 20 | **No scheduled publishing or automatic late penalties** | Faculty publish by hand; late work is marked, and the penalty is applied in the grade |
| 21 | **Administrators cannot grade** unless added to the class as faculty | Intentional: grading is a teaching role |
| 22 | **The validator has two homes**: `Flexee_Standards/Tools` (the source) and a pinned copy in the repository for GitHub | When the coordinator changes the validator, it must say "pass this to the Wrapper chat", which updates the copy |
| 23 | **One time zone per installation** (`APP_TIMEZONE`) | Enough for Wright State; a per-institution zone comes with multi-institution support |
