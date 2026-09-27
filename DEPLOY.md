# Flexee Reader — standalone deployment & course runbook

Run Flexee for a real class with **no LMS and no email server**. Students self-enrol with a
section code and set their own password; grades export as CSV (or push to D2L later, if you
add LTI). This guide covers hosting the reader for **MIS 3000** and **SAD (MIS 3250) Tuesday**.
(SAD's Thursday MVCFN simulation is a separate application — see the note at the end.)

> **Hosting on AWS:** follow `deploy/aws/AWS_Deployment_Runbook.md`, which uses the files in
> `deploy/aws/` (Amazon RDS for the database, Caddy for HTTPS). The steps below are the generic
> single-server version.

## Prerequisites

- A Linux host with **Docker** and Docker Compose.
- The **content trees** — `content/sad/` and `content/mis3000/` — placed next to this repo
  (produced by the intake tools; keep them in git).
- For a real class, put the app **behind HTTPS** (a reverse proxy such as Caddy or nginx).
  Required if you later add D2L; recommended always.

## Deploy (about ten minutes)

```bash
# 1. content trees in ./content  (content/sad, content/mis3000)
# 2. choose a strong DB password
export POSTGRES_PASSWORD='<a-strong-password>'

# 3. build the image
docker compose build

# 4. one-shot setup: migrate DB, load content, load objectives+questions, seed sections
docker compose run --rm app npm run db:setup

# 5. start
docker compose up -d          # now serving on :3000 (put HTTPS in front of it)
```

`db:setup` runs migrate → sync-content → sync-questions → seed in order. Re-running it is safe.

## Per-course runbook

### MIS 3000 (reader + exams)
1. Sign in / create your instructor account, or open the seeded section under **Teaching**.
2. Share the section **join code**; students sign up and self-enrol (no email needed).
3. Build exams from the 338-question bank (a random draw or a fixed set), set timing and
   attempts, open when ready.
4. Grades: the **Gradebook** gives weighted totals; **export CSV** to drop into your grade
   system (or push to D2L once LTI is registered).

### SAD / MIS 3250 — Tuesday (the book)
1. Same reader; create a section for the SAD book and share its join code.
2. Students read the book. SAD has a complete question bank (288 approved questions over 60
   objectives), loaded by the intake; build quizzes and exams from it as for MIS 3000.
3. **Thursday (the simulation)** is the MVCFN food-bank sim — a *separate* application (engine
   + student workspace + instructor console), **not part of this reader deployment**. Stand it
   up on its own; this guide does not cover it.

## No email required

Sign-up, join-by-code, reading, exams, and grades all work with no mail server. The only
email-dependent feature is a student's "forgot password." Instead, on the section roster use
**Reset password** next to a student — it sets a temporary password and shows it to you once,
to hand over in person; they change it after signing in. To enable real email later, set
`MAIL_PROVIDER` and implement the adapter in `src/lib/mail.ts`.

## Operations

- **Backups:** `docker compose exec db pg_dump -U flexee flexee > backup.sql` (schedule it).
- **Update content:** edit the source, rebuild the tree (assemble_book.py / build_questions.py),
  replace `./content`, then `docker compose run --rm app npm run db:sync-content` and
  `... npm run db:sync-questions`.
- **Upgrade the app:** `docker compose build && docker compose run --rm app npm run db:deploy`
  (applies any new migrations) then `docker compose up -d`.
- **What's stored / who can see it:** see `Flexee_Admin_Security_Onepager.md`.
