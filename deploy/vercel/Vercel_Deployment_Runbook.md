# Flexee Wrapper — Vercel Deployment Runbook

**For:** Akshay · **From:** Vikram · **Version 1.0 — 26 September 2026**

This puts the Flexee Wrapper online at `https://learn.flexee.org` for the Spring 2027 sections of
MIS 3000 and MIS 3250, on **Vercel Pro** with the database on **Supabase** — the same pairing the
MVCFN simulation already uses. There is no server to maintain.

Expected effort is two to three hours. Everything is in `flexee-reader.zip`. The Vercel-specific
pieces are already in the code:

| File | What it does |
|---|---|
| `next.config.mjs` | Bundles the book content (`content/`) into the deployment, since Vercel has no persistent disk |
| `src/db/index.ts` | Works with Supabase's connection pooler; `DB_POOL_MAX` caps connections per instance |
| `.github/workflows/flexee-intake.yml` | Runs the book intake and database jobs from GitHub, since Vercel only serves the app |

(The `deploy/aws/` folder is an alternative AWS setup. It is not used here.)

---

## How it fits together

- **Vercel** serves the app. Every push to `main` deploys automatically.
- **Supabase** holds the database: accounts, sections, exams, grades.
- **GitHub Actions** runs the jobs that are not web requests: first-time database setup,
  migrations, and loading a new version of a book from Google Drive.
- **Book content lives in the repository** under `content/`. Loading a new book version is:
  run the intake, approve it, and the workflow commits the new content, which Vercel then deploys.

---

## Part A — GitHub repository

1. Create a **private** repository, `OneSmarterInc/flexee-wrapper`.
2. Unzip `flexee-reader.zip`, then push its contents to `main`. The `.gitignore` already leaves out
   `node_modules/`, `.next/`, `.env` files and the intake's archive and staging folders.
   **Do commit `content/`** — the books are part of the deployment.

## Part B — Supabase

1. New project `flexee-wrapper` in the **East US (Ohio)** region. Generate a strong database password
   and keep it in your password manager.
2. From **Connect**, copy two connection strings:
   - **Transaction pooler** (port **6543**) — for Vercel, where every request is short-lived.
   - **Session pooler** (port **5432**) — for GitHub Actions. Use this rather than the "direct
     connection", which is IPv6-only and cannot be reached from GitHub's runners.
   Append `?sslmode=require` to both.
3. Backups: Supabase Pro keeps daily backups for 7 days. Point-in-time recovery is optional.

## Part C — Google Drive access for the intake

1. In Google Cloud Console, create a project `flexee-intake` and enable the **Google Drive API**.
2. Create a service account `flexee-intake` (no roles needed) and download a **JSON key**.
3. **Send Vikram the service account's email address**
   (`flexee-intake@<project>.iam.gserviceaccount.com`). He shares `MIS3250_v2_CURRENT` and
   `Flexee_Standards` with it as **Viewer** and sends you both folder ids.

## Part D — GitHub secrets

In the repository: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
|---|---|
| `DATABASE_URL_DIRECT` | The Supabase **session pooler** string (port 5432) |
| `GOOGLE_SA_JSON` | The entire contents of the service account's JSON key |

Also check **Settings → Actions → General → Workflow permissions** is set to **Read and write**,
so the workflow can commit an admitted book. Then delete the downloaded key file from your machine.

## Part E — First-time database setup

**Actions → Flexee intake → Run workflow**, action **`setup`**.

This creates the tables, loads the books already in `content/`, loads their question banks, and
creates one default section per book. **Note the join codes** it prints in the log.

## Part F — Vercel project

1. **Add New → Project**, import `OneSmarterInc/flexee-wrapper`. Framework: Next.js (detected).
2. **Environment variables** (Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | The Supabase **transaction pooler** string (port 6543) |
   | `DB_POOL_MAX` | `3` |

3. **Settings → Functions → Function Region:** **Cleveland, USA (cle1)**, next to the Ohio database.
4. Deploy. Open the preview address and confirm the library page loads and a chapter opens with its
   figures.

## Part G — Domain

**Settings → Domains → Add** `learn.flexee.org`, and create the DNS record Vercel shows (a CNAME to
`cname.vercel-dns.com`). The HTTPS certificate is issued and renewed automatically.

## Part H — Load the current SAD book

1. **Actions → Flexee intake → Run workflow**: action **`report`**, book id **`sad`**, and the two
   folder ids from Vikram.
2. The report appears in the run's **Summary**. **Send it to Vikram and wait for his go-ahead.**
   A red run means the intake **STOPPED**: nothing was changed, and the report names the exact
   problem for the book team. Do not work around it.
3. When Vikram approves, run the workflow again with action **`approve`** and the same inputs.
   It re-checks, admits the book, commits it (Vercel redeploys within a minute or two), and loads
   the chapters and 288 questions into the database.

## Part I — Monitoring

- Vercel: turn on **Deployment notifications** (failed deployments) for you and Vikram.
- An external uptime check on `https://learn.flexee.org`.
- Supabase: turn on the usage and disk alerts under **Settings → Billing / Usage**.

## Part J — Updating later

- **App changes:** push to `main`. If the change includes a new database migration, run the
  workflow with action **`migrate`** right after pushing.
- **A new book version:** repeat Part H.

---

## Handover — send Vikram these when done

1. The live address, with the HTTPS padlock showing.
2. The service account email (Part C3) — needed before Part H.
3. The join codes from the `setup` run.
4. The SAD intake report from the `report` run.
5. Who has access to the Supabase project, the Vercel project and the repository secrets.

## Not part of this deployment

- **Email** ("forgot password"): not needed for Spring; instructors reset passwords from the
  section roster.
- **D2L / LTI:** dormant until Wright State registers the Wrapper, which needs the HTTPS address
  this deployment creates.
- **The MVCFN simulation** (SAD Thursdays) is a separate application.
- **Before real students sign in,** Vikram is confirming with Wright State that storing student
  names and grades with Vercel and Supabase is acceptable. Do not invite students until he says so.
