# Wrapper Intake Runbook

**Version 1.0 — 24 September 2026.** Part of `Flexee/Flexee_Standards`. Do not copy.


Intake reads a book's shelf straight from Google Drive and loads it into the Wrapper. **Nobody
downloads, zips, uploads, renames, or types a version number.** The tool works out what is current
from the register and the filenames, checks everything, and stops if anything is off.

## One-time setup (an administrator, once per installation)

Create a Google Cloud service account with the Drive API enabled, download its key as
`sa.json`, and share each book's `<COURSE>_vN_CURRENT` folder with the service account's email
as **Viewer**. That is the only configuration.

## Before any intake

Intake runs only when the book's register says `Intake status: READY FOR INTAKE`. That line
means the book chat has finished every correction (see `Book_Production_Process`). If it says
anything else, the tool stops at once — do not ask anyone to change the line so you can proceed.

## Every intake

    npm run intake -- --book-id sad --drive-folder <folder id> --credentials sa.json --out content

The folder id is the last part of the folder's Drive URL. The tool prints a report and writes it
to `content/_intake_report_<book>.md`.

**If the status is STOPPED,** nothing was loaded. The report names the exact problem — a version
that disagrees with the register, a chapter edited without its version bumped, an old copy left
beside a new one, a missing figure. Fix it in the book-build chat and the register, then run the
same command again. Do not work around a stop.

**If the status is READY TO APPROVE,** a person with authority to publish reads the report and,
if it is right, runs:

    npm run intake -- --book-id sad --out content --approve
    npm run db:sync-content

The previous version of the book is archived, never deleted. Sections that adopted the book see the
new chapters as upgrades to review, under their existing pinning.

## What the tool checks

The register says the book is ready for intake; The register exists and can be read; every chapter's filename version matches the register; no
extra or duplicate copies; the chapter and figure counts match the register; no chapter's content
changed while its version stayed the same; each package has one markdown file with every figure
present, referenced and numbered to its chapter; figures are downsampled to 1500 px if larger;
American spelling; "is not… it is" constructions (reported for an editor to judge); no simulation
terms in the book; the imprint recorded in the register; front matter present on the shelf.
