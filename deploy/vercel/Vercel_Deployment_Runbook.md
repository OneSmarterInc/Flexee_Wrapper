# Flexee Wrapper — Vercel Deployment Runbook

**Version 1.1 — 29 September 2026** · replaces v1.0 (26 Sep), which described Supabase and loading books
by Git commit. This version describes the site as it actually runs.

## How it fits together

| Piece | Service | What it holds or does |
|---|---|---|
| The app | **Vercel** (Pro) | Every push to `main` deploys |
| Database | **Neon** Postgres, connected through Vercel Storage | Accounts, classes, questions, exams, grades, assignments |
| Books and files | **Vercel Blob**, private | Published books (`live/<book>/`), their archives, book uploads, assignment attachments, student submissions |
| Book intake | **GitHub Actions** (`library-intake.yml`) | Checks an uploaded book and publishes it to Blob; started by the app |
| Database setup | `scripts/auto-init.ts`, run by every production build (`vercel.json`) | Applies database migrations; loads the books bundled in `content/` **only into an empty database**; never re-pins an existing class |

Books are loaded by faculty and admins through the **Library** page (see `docs/changes/07_Library_Upload.md`),
not by committing to Git.

## Part A — Repository

Private repository `OneSmarterInc/Flexee_Wrapper`, branch `main`. Keep `.gitattributes` (line endings
normalized to LF) so diffs show only real changes.

## Part B — Database: Neon

1. Vercel project → **Storage** → create or connect a **Neon** Postgres database, for Production (and
   Preview if wanted). Vercel adds the connection variables to the project, including:
   - `DATABASE_URL` — the **pooled** address, used by the running site;
   - `DATABASE_URL_UNPOOLED` — the **direct** address, used for migrations and bulk loads.
2. Nothing else is needed for setup: the next production build runs `auto-init`, which applies every
   migration and, on an empty database, loads the bundled books and creates their default classes.
   It refuses to run if the two addresses point at different databases.
3. Backups: use Neon's point-in-time restore (the window depends on the Neon plan). Before any risky
   change, create a Neon **branch** as a snapshot.

## Part C — Blob storage

**Storage → Create → Blob**, private, connected to the project. Vercel adds `BLOB_READ_WRITE_TOKEN`.

## Part D — Vercel environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | set by Vercel when Neon is connected |
| `BLOB_READ_WRITE_TOKEN` | set by Vercel when Blob is connected |
| `DB_POOL_MAX` | `3` |
| `GITHUB_DISPATCH_TOKEN` | fine-grained token, this repository only, **Actions: Read and write** |
| `GITHUB_REPO` | `OneSmarterInc/Flexee_Wrapper` |
| `GITHUB_REF` | `main` |
| `CONTENT_STORE`, `CONTENT_PREFIX`, `CONTENT_BLOB_ACCESS` | `blob`, `live/`, `private` — **only after** the books have been added through Library (Part G) |
| `CONTENT_CACHE_SECONDS` | `300` |
| `APP_TIMEZONE` | optional; default `America/New_York` (due dates) |

Function region: **Washington, D.C. (iad1)** or **Cleveland (cle1)**, close to the Neon region.

## Part E — GitHub repository secrets (for the book intake)

| Secret | Value |
|---|---|
| `DATABASE_URL_DIRECT` | **the same Neon database's `DATABASE_URL_UNPOOLED` value.** If it names another database, uploaded books are loaded where the site never looks |
| `BLOB_READ_WRITE_TOKEN` | the Blob store's read-write token (Storage → the store → `.env.local` tab) |

## Part F — Domain

**Settings → Domains → Add** `learn.flexee.org`; create the CNAME Vercel shows. HTTPS is automatic.

## Part G — First administrator and the books

1. Vikram signs up on the site. From a machine with `DATABASE_URL_UNPOOLED` in `.env` (as
   `DATABASE_URL`): `npm run admin:set -- <his email>`.
2. Vikram → **Library** → upload `MIS3250_v2_CURRENT` (zipped from Drive) as book `sad`; read the
   report; **Add to library**. Then `MIS3000_v1_CURRENT` as `mis3000`.
3. Set the three `CONTENT_*` variables in Part D and redeploy. The site now reads books from Blob.
4. Check: both books open; MIS 3000's title is *Technology and the Organization*; SAD Figure 1.4 reads
   "Communicate, Model, Judge".

## Part H — Monitoring

- Vercel: deployment-failure notifications to Vikram and the developer.
- Neon: usage and storage alerts.
- GitHub: notifications for failed **Library intake** runs.
- An external uptime check on the live address.

## Part I — Updating

- **Code:** push to `main`. Migrations are applied by `auto-init` on the production build.
- **A new book version:** upload it through **Library**.

## Handover checklist

1. The live address, HTTPS showing.
2. `DATABASE_URL_DIRECT` confirmed to be the site's own Neon database (unpooled).
3. A successful **Library** upload of each book, and the `CONTENT_*` switch made.
4. Who has access to the Vercel project, the Neon database, the Blob store and the repository secrets.

## Not part of this deployment

- **Email** ("forgot password", notifications): not yet; instructors reset passwords from the roster.
- **D2L / LTI:** dormant until Wright State registers the Wrapper.
- **Before real students sign in:** Wright State must approve storing student names, grades and
  submitted work with Vercel, Neon and Vercel Blob. Do not invite students until Vikram says so.
