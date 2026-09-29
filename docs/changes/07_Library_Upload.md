# Wrapper change 7 — Uploading books into the library

**28 September 2026** · Patch: `0007-library-upload.patch` · apply after `0006-class-publishing.patch`

## What it does

Faculty and admins add books to the Wrapper themselves, from a **Library** page — no developer,
no Git commit.

1. **Upload.** In Google Drive, right-click the book's `CURRENT` folder → **Download**. On
   **Library**, choose which book it is (a new version of an existing one, or a new book id) and upload
   the zip (up to 200 MB). It goes from the browser straight into **private** Vercel Blob storage.
2. **Check.** The app starts the **Library intake** workflow in GitHub Actions. It runs the same
   intake and validator we have tested against SAD and MIS 3000 and writes the report back. The upload
   page refreshes itself; after a minute or two it shows **Ready to add** or **Stopped**, with the report.
3. **Add to library.** The uploader or an admin clicks **Add to library**. The workflow checks again,
   archives the book's current files in Blob (`archive/<book>/<time>/`), uploads the new ones to
   `live/<book>/`, and loads chapters and questions into the database. **The answer key never goes to
   Blob** — questions live only in the database. The job checks the zip's paths and expansion size;
   if the Blob upload or database load fails, it restores the previous live files from the archive.
4. **Publish to a class** (change 6). No student sees anything until a class's faculty publish it.

## New pieces

| File | What |
|---|---|
| `drizzle/0013_library_uploads.sql` | The `library_uploads` table: who uploaded what, status, report |
| `src/lib/library.ts` | Who may upload (admins, anyone teaching a class) and approve (uploader or admin); recording uploads; starting the GitHub workflow |
| `src/app/api/library/upload/route.ts` | Issues one-time tokens for browser-to-Blob uploads (faculty/admin, `.zip`, ≤ 200 MB) |
| `src/app/library/` | The Library page, the upload form, the upload page with report and **Add to library** |
| `scripts/library-intake.ts` | The job the workflow runs: download, check, report; publish to Blob and load |
| `.github/workflows/library-intake.yml` | The workflow, started by the app |
| `tools/build_questions.py` | **Pinned copy** of the shared validator (`Flexee_Standards/Tools`, 12,938 bytes, released 28 Sep). GitHub has no Drive access, so the repository keeps this copy. When the standards change it, the Wrapper chat updates this copy |
| `scripts/run-support/` | Lets command-line jobs import `src/` modules against the real database |
| `scripts/it-library.ts` | Tests |

## One-time setup

**1. Database.** `npm run db:deploy` (migrations 0012 and 0013, if 0012 is still pending).

**2. GitHub repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DATABASE_URL_DIRECT` | Supabase **session pooler** string (port 5432) — may already exist |
| `BLOB_READ_WRITE_TOKEN` | The Blob store's read-write token (Vercel → Storage → the store → `.env.local` tab) |

**3. A token the app uses to start the workflow.** GitHub → Settings → Developer settings →
**Fine-grained personal access tokens** → new token, repository `OneSmarterInc/Flexee_Wrapper` only,
permission **Actions: Read and write**, nothing else.

**4. Vercel environment variables** (Production and Preview):

| Variable | Value |
|---|---|
| `GITHUB_DISPATCH_TOKEN` | the token from step 3 |
| `GITHUB_REPO` | `OneSmarterInc/Flexee_Wrapper` |
| `GITHUB_REF` | `main` |
| `BLOB_READ_WRITE_TOKEN` | set automatically when the Blob store is connected |

Redeploy.

## Load the two books, then switch the app to Blob

1. Sign in as an admin → **Library** → upload `MIS3250_v2_CURRENT` as book `sad`. Wait for
   **Ready to add**, read the report, **Add to library**. Wait for **In the library**.
2. The same for `MIS3000_v1_CURRENT` as book `mis3000`.
3. In Vercel set `CONTENT_STORE=blob`, `CONTENT_PREFIX=live/`, `CONTENT_BLOB_ACCESS=private`, and
   redeploy. The app now reads books from Blob; the `content/` folder in Git is no longer used by the
   live site (keep it until you have checked the site).
4. Check: both books open; MIS 3000 shows its new title; SAD Figure 1.4 reads "Communicate, Model, Judge".

## Tests

    SAD_PACKAGES=/path/to/sad/packages npm run test:library      # 13 passed with the SAD package fixture

The job test runs a real SAD shelf, zipped the way Drive zips a folder, through the real intake and
validator against a simulated Blob store: check → ready; only the uploader or an admin may add it,
once; publish → `live/sad/` without the answer key, loaded; a second version archives the first; a
defective book is stopped with the intake's reason and nothing is published; a non-zip or a zip
without a register fails with a plain explanation. GitHub is simulated: the dispatch request is
checked field by field, and a missing or refused runner is reported on the upload instead of leaving
it waiting. The extra checks reject unapproved publish dispatches, path traversal and links in zips.

All other suites still pass.
