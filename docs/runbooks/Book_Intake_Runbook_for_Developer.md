# Loading the Books into the Flexee Wrapper — Developer Runbook

**For:** Akshay · **From:** Vikram · **Version 1.0 — 27 September 2026**

This runbook loads the two finished books into the live Wrapper:

| Book | Book id | Drive folder |
|---|---|---|
| Analysis and Design of Information Systems (MIS 3250, "SAD") | `sad` | `Flexee/Flexee-SAD/MIS3250_v2_CURRENT` |
| Technology and the Organization (MIS 3000) | `mis3000` | `Flexee/Flexee-3000/MIS3000_v1_CURRENT` |

The copies of both books currently in the repository (`content/sad`, `content/mis3000`) are old
versions from mid-September. The finished versions exist only in Google Drive. The **intake tool**
(`tools/flexee_intake.py`) is the one route from Drive into the Wrapper: it reads a book's folder,
checks everything against the book's register (`STATE_OF_RECORD.md`), and writes a report.
**Nothing is loaded until Vikram approves that report.**

No Google service account or key file is needed. The intake reads the book folders through
**Google Drive for Desktop**, as ordinary files on your computer.

---

## Ground rules

1. **Never edit, move or rename anything in the book folders in Drive.** You have Viewer access
   only, and that is deliberate. If something in a book is wrong, the book team fixes it.
2. **Never work around a STOP.** If the intake stops, it names the exact problem. Send the report
   to Vikram and wait; do not edit files to make it pass.
3. **Run the approve step only after Vikram approves in writing,** and only on the same machine
   that produced the report, without re-running anything in between.

---

## Step 0 — One-time setup

**0.1 Drive access.** Vikram shares three folders with your Google account as **Viewer**:
`MIS3250_v2_CURRENT`, `MIS3000_v1_CURRENT` and `Flexee_Standards`.

Shared folders appear under **Shared with me**, which Google Drive for Desktop does not show
as a local folder. For each of the three folders: open drive.google.com → **Shared with me** →
right-click the folder → **Organize → Add shortcut** → choose **My Drive**. After a minute they
appear on your computer under `G:\My Drive\` (the drive letter may differ on your machine).

**0.2 Software.** On the machine you will run this from:

- Google Drive for Desktop, signed in with the account Vikram shared the folders with
- Python 3.10 or later, then: `pip install Pillow`
- Node 22 and Git
- The repository cloned and up to date:
  ```
  git clone https://github.com/OneSmarterInc/Flexee_Wrapper.git
  cd Flexee_Wrapper
  git pull
  npm ci
  ```

**0.3 Check you have the current intake.** Open `tools/flexee_intake.py` and search for
`lead_int`. It must be there. If it is not, you have an older version: pull again, or ask Vikram
for the latest file. The older version cannot read the MIS 3000 register.

**0.4 Database address.** Create a file named `.env` in the repository root (it is git-ignored)
containing the Supabase **session pooler** connection string (port **5432**, not the 6543
transaction pooler):

```
DATABASE_URL=postgres://postgres.xxxx:PASSWORD@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

The loading scripts read this file automatically.

**0.5 Confirm the paths.** In File Explorer, check these three folders open and contain the files
below. Use your actual paths in the commands that follow if they differ.

| Path | Must contain |
|---|---|
| `G:\My Drive\MIS3250_v2_CURRENT` | `STATE_OF_RECORD.md` and folders `00_Front_Matter` to `07_Question_Banks` |
| `G:\My Drive\MIS3000_v1_CURRENT` | `STATE_OF_RECORD.md` and folders `00_Front_Matter` to `07_Question_Banks` |
| `G:\My Drive\Flexee_Standards\Tools` | `build_questions.py` |

Wait until Google Drive for Desktop shows the folders as fully synced before continuing.

---

## Step 1 — Intake report for SAD

From the repository root (Windows Command Prompt; on macOS or Linux replace `^` with `\` and use
your paths):

```
python tools/flexee_intake.py --book-id sad ^
  --local "G:\My Drive\MIS3250_v2_CURRENT" ^
  --validator "G:\My Drive\Flexee_Standards\Tools\build_questions.py" ^
  --out content
```

**What it does:** reads the SAD register, checks every file the register lists against the
folder (and flags any file the register does not list), checks the twelve chapter packages and
their figures, validates all 288 questions with the shared validator, and stages the result in
`content/_staging/sad`. It changes nothing that students see.

**What you get:** a status line at the end, and the full report in
`content/_intake_report_sad.md`.

- **READY TO APPROVE** — send `content/_intake_report_sad.md` to Vikram.
- **STOPPED** — send the same file to Vikram. Do not change anything. Nothing was loaded.

## Step 2 — Intake report for MIS 3000

```
python tools/flexee_intake.py --book-id mis3000 ^
  --local "G:\My Drive\MIS3000_v1_CURRENT" ^
  --validator "G:\My Drive\Flexee_Standards\Tools\build_questions.py" ^
  --out content
```

Same checks, for fourteen chapters and 338 questions. Send `content/_intake_report_mis3000.md` to
Vikram, whatever its status.

**Then wait for Vikram's written approval of each report before Step 3.**

## Step 3 — Approve (only after Vikram approves)

For each approved book, on the same machine, without re-running Steps 1–2:

```
python tools/flexee_intake.py --book-id sad --out content --approve
python tools/flexee_intake.py --book-id mis3000 --out content --approve
```

Each command moves the staged book into `content/<book id>/` and archives the previous version
under `content/_archive/` (kept locally; git-ignored). Run only the line for a book Vikram
approved.

## Step 4 — Commit and push (Vercel redeploys)

```
git add content/sad content/mis3000 content/_intake_report_sad.md content/_intake_report_mis3000.md
git commit -m "Admit SAD (register 6.18) and MIS 3000 (register 1.7) via intake"
git push
```

Vercel deploys the push automatically. Wait for the deployment to finish in the Vercel dashboard
before Step 5's checks.

Do **not** commit `content/_staging` or `content/_archive`; `.gitignore` already excludes them.

## Step 5 — Load the database

From the repository root, with the `.env` from Step 0.4:

```
npm run db:sync-content
npm run db:sync-questions
```

`db:sync-content` records the new chapter versions, so existing sections see them as upgrades to
review. `db:sync-questions` loads the objectives and questions, with each question's review
status. Both are safe to re-run.

## Step 6 — Check the live site

Open the live address and confirm:

- [ ] The library shows both books, and MIS 3000's title reads **Technology and the Organization:
      An Introduction to Management Information Systems** (not "Introduction to MIS").
- [ ] SAD chapter 1 opens, and **Figure 1.4** shows the words **Communicate, Model, Judge** in
      both the box and the footer.
- [ ] MIS 3000 chapter 2 opens and its figures display (they were missing from the old version).
- [ ] As an instructor, the question bank for each book is available when building a quiz:
      288 questions for SAD, 338 for MIS 3000.

Send Vikram the address and a one-line result for each box.

## Step 7 — Rehearse a term with made-up accounts

Use invented names and email addresses only. **Do not invite real students** until Vikram says
Wright State has approved.

1. Create an instructor account and a section for each book (Spring 2027).
2. Join each section as a test student, using the section's join code.
3. As the student: read a chapter, take a practice quiz, take it again.
4. As the instructor: build a short quiz from the bank; confirm the student's attempt appears.
5. Open the section's **Mastery** page; confirm results show by objective.
6. Export the **gradebook** as CSV and open it.

Note anything that fails, looks wrong, or is confusing, with the page address and what you did.
Send the list to Vikram.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `STOPPED` — "register lists `X`, not in Drive" | The register names a file the folder does not have, or Drive for Desktop has not finished syncing. Wait for sync and re-run Step 1/2 once. If it persists, send the report to Vikram. |
| `STOPPED` — "`X` is in Drive but not in the register" | An extra file sits in a book folder. On Windows, check for a hidden `desktop.ini`; otherwise send the report to Vikram. Do not delete files in the book folders yourself. |
| `STOPPED` — validator errors on a question | A question file fails the shared validator. Send the report to Vikram. |
| `no validator` | The `--validator` path is wrong. Check Step 0.5. |
| `python` not found | Use `py` instead of `python` on Windows. |
| `db:sync-*` cannot connect | `.env` is missing, or uses the 6543 transaction pooler instead of the 5432 session pooler. |
| MIS 3000 register cannot be read | You have the old intake. See Step 0.3. |

---

## What to send Vikram, in order

1. Confirmation that the three folders are visible (Step 0.5).
2. `_intake_report_sad.md` and `_intake_report_mis3000.md` (Steps 1–2).
3. After approval and deployment: the live address and the Step 6 checklist results.
4. The Step 7 rehearsal notes.
