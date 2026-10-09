# Spec 28 — Moving the Wrapper from Vercel to AWS

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 8 October 2026 · Covers backlog item W40. Akshay runs the AWS setup; this spec is the code side.

## Why

Spring 2027 runs on AWS. The decision is made; this spec is the sequence, not a comparison.

Two things make it smaller than it looks and one makes it larger. Smaller: the content store
**already** has a tested S3 backend, and the Docker deployment **already** exists in `deploy/aws/`.
Larger: Vercel Blob is used for two unrelated jobs, and only one of them has an S3 twin — the other
is browser-direct upload of assignment attachments and student submissions, which is a different
flow, not a backend swap. That is the one item a code freeze would strand.

**There is no live data of any kind, and test data is not kept.** That removes the whole of what
would normally be the riskiest stage: no dump, no restore, no row-count rehearsal, no cutover
window. The database is built fresh with `db:setup` whenever AWS is ready.

## What already works, and must not be rebuilt

- **`S3Store`** in `src/lib/storage.ts`, behind the same `ContentStore` interface as `FsStore` and
  `BlobStore`, chosen by `CONTENT_STORE=s3`. Handles `CONTENT_PREFIX`, paginates `ListObjectsV2`
  through `CommonPrefixes`, maps `NoSuchKey`/404 to `NotFoundError`. `@aws-sdk/client-s3` is a real
  dependency.
- **`test:storage`**, 13 checks, one of which reads every book, table of contents, chapter text and
  figure list from disk, from a mocked S3 and from a simulated Blob and asserts all three are
  `deepEqual`. The read half of stage 1 is finished work.
- **`Dockerfile`** and **`deploy/aws/docker-compose.aws.yml`** (app behind Caddy, RDS for the
  database). `output: "standalone"` is *not* set, which costs image size and nothing else.
- **`src/db/index.ts` already sets `prepare: false`**, with a comment naming PgBouncer and RDS
  Proxy. No code change is needed for a pooler.
- **`setMailTransport`** is a one-function seam, so Resend keeps working from AWS unchanged and SES
  is a later option, not a migration task.

## Everything that depends on Vercel today

| Dependency | Where | Replacement | Stage |
|---|---|---|---|
| Blob — book reads | `src/lib/storage.ts` | `CONTENT_STORE=s3` (built) | 1a |
| Blob — intake writes | `scripts/library-intake.ts:28` `vercelBlob()` | `s3Ops()`, same 5-method `BlobOps` | 1a |
| Blob — book zip upload | `api/library/upload`, `library/UploadForm.tsx` | presigned S3 POST | 1b |
| Blob — assignment and submission files | `api/files/upload`, `api/files/[kind]/[id]`, `components/FilePicker.tsx` | presigned S3 PUT, streaming GET | 1b |
| `crons` | `vercel.json` → `/api/cron/assistant-retention`, `0 4 * * *` | EventBridge Scheduler, or crontab + `curl` with `CRON_SECRET` | 3 |
| `buildCommand` | `npm run db:auto-init && npm run build` | `db:setup` on a fresh database, `db:deploy` after | 2 |
| `VERCEL_ENV` | `scripts/auto-init.ts:7` — returns early unless `production` | nothing: migrations become a deliberate step | 2 |
| `VERCEL_GIT_COMMIT_SHA` / `_REF` | `src/lib/health.ts:66`, the `build` field | Docker `--build-arg` → `ENV` | 3 |
| Env injection | Vercel dashboard | `.env` at `chmod 600`, or SSM Parameter Store | 3 |
| Neon | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | RDS. No code change | 2 |
| Preview deploys | per-branch URLs and env | no equivalent; a second compose stack if wanted | — |
| Aliases, certificates | Vercel domains | Elastic IP, A record, Caddy | 4 |

**Not Vercel, and unaffected:** Resend, the AI providers, `LAUNCH_SECRET` and the RapidSims
contract, the GitHub Actions intake trigger, LTI.

---

## Stage 1a — Book files to S3 *(superseded by Addendum B: an EBS volume, not S3)*

**Effort: ½–1 day.** `s3Ops()` implementing `BlobOps` (`download`, `list`, `put`, `copy`, `del`).
`scripts/it-library.ts` already has a fake `BlobOps`, so the harness exists.

**The first load does not need it.** The Python intake writes a local tree, which the AWS runbook's
Part F already does, and `aws s3 sync` puts it where `CONTENT_PREFIX=live` expects. `s3Ops()` is
needed only for the browser-upload → GitHub Actions path afterwards.

**Parallel with the live site:** completely. New bucket, new prefix, nothing shared.

**Cutover:** `CONTENT_STORE=s3`, `CONTENT_BUCKET`, `AWS_REGION`, `CONTENT_PREFIX=live`.

**Rollback:** one variable — `CONTENT_STORE=fs` with the content tree on disk, which is what
`docker-compose.aws.yml` already mounts. `content/` is 3.8 MB and 148 files.

**Risks.** The prefix arithmetic is the trap, and it has already bitten once: the intake writes to
`live/<book>/`, so with the app's `CONTENT_PREFIX` unset, `listDirs("")` returns `["live"]` and the
Library shows no books while the status page reports one folder. **Bucket versioning must be on
before the first sync** — had the Blob store had it, last week's loss would have been a restore.

**Cost:** under $1 a month.

## Stage 1b — Assignment attachments and student submissions *(presigning superseded by Addendum B)*

**Effort: 2–3 days.** The largest code item in the migration, and the only one a freeze strands.

Four files, two of them client components. `@vercel/blob/client`'s `upload()` sends the browser
straight to Blob using a one-time server-issued token; the S3 equivalent is a presigned PUT. The
server-side authorisation — `uploadPrefix()`, the path-prefix check, `downloadable()`, the 50 MB cap
— carries over unchanged, and is most of the value in that code.

**No dual-read fallback.** Nothing old exists; the Blob store is abandoned, not recoverable. The
`blobPath` column keeps its name and holds S3 keys.

**Parallel:** yes, but it must be proved with real browser uploads against a real bucket. A mock
will not settle a presigned URL.

**Rollback:** none needed beyond reverting the commit — there is no old data to keep readable.

**Risk:** this is genuinely new code in a path students use under deadline pressure. It wants a
browser test on the AWS stack before Spring, not only a suite.

**Alternative, if it is not wanted for Spring:** decide explicitly that assignments are text-only
and leave attachments off. That is a decision to take now, not a discovery in January.

## Stage 2 — A fresh RDS Postgres

**Effort: 2 hours.** No dump, no restore, no rehearsal, no window.

```
docker compose -f docker-compose.aws.yml run --rm app npm run db:setup
```

`db:setup` runs migrate → sync-content → sync-questions → seed, and is safe to re-run.

**Parallel:** fully, and at any time. The two databases never meet.

**Cutover:** none. The AWS stack is born pointing at RDS.

**Rollback:** none needed. Neon is simply abandoned with the Blob store.

**Risks.** Two, both small and both about *what is not in a fresh database* — see the hand-rebuild
list below. And `auto-init.ts` returns early unless `VERCEL_ENV=production`, so nobody should expect
migrations to run themselves on AWS: they are `db:deploy`, deliberately.

**Cost:** `db.t4g.micro` single-AZ ~$12, 20 GB gp3 with 14-day backups ~$3. Multi-AZ adds ~$13.

## Stage 3 — The app on Docker

**Effort: ½–1 day**, because most of it exists.

What changes: `VERCEL_GIT_COMMIT_SHA` becomes a build argument so `/api/health` still reports which
commit is live; the cron becomes an EventBridge rule or a crontab line posting to
`/api/cron/assistant-retention` with `CRON_SECRET`; environment variables move to `.env` at
`chmod 600` or SSM.

**Parallel:** fully. Stand it up on a temporary hostname and run it beside the current site.

**Cutover and rollback:** DNS only, in stage 4.

**Cost:** `t3.medium` ~$30 on demand, ~$19 on a one-year no-upfront reserved instance; 30 GB gp3
~$2.40.

## Stage 4 — DNS, HTTPS, email

**Effort: 2 hours**, plus propagation.

**HTTPS is already solved.** Caddy obtains and renews the certificate for `{$SITE_DOMAIN}` itself,
provided DNS points at the Elastic IP and **ports 80 and 443 are both open** — port 80 is not
optional, it is how the challenge works.

**DNS:** drop `learn.flexee.org` to a 60-second TTL a day ahead, then point the A record at the
Elastic IP.

**Email: nothing to do.** Resend is an HTTPS API and works from AWS unchanged. It needs
`RESEND_API_KEY` **and** `MAIL_FROM` — both, or nothing sends.

**The Spec 27 interaction, which must not be forgotten.** `learn.flexee.org` is the address the
RapidSims will point `PLATFORM_URL` at, and C2-2 v1.1 §5 fixes the order:

1. `learn.flexee.org` answers **`/api/health` with no redirect**;
2. every sim's `PLATFORM_URL` is set to exactly `https://learn.flexee.org`, RapidSim 01 first;
3. **only then** does `rapidsims.flexee.org` start redirecting `/session.html`, `/open.html` and
   `/faculty.html`.

Caddy must not redirect or canonicalise `/api/session-enrolments` or `/api/health`. The sims call
the roster with `redirect: 'error'`, so a 301 or 308 ends the call rather than following it.

**Rollback:** revert the A record. With a 60-second TTL that is minutes.

**Cost:** Elastic IP attached is free, Route 53 hosted zone $0.50, data transfer out $1–5.

---

## What must be recreated by hand after a fresh `db:setup`

`db:setup` creates **no user accounts at all**. `scripts/seed.ts` creates, per book it finds in
`CONTENT_DIR`, one section named `"<Book title> — Default section"` with a random join code, and
pins every spine entry to its latest version. That is the whole of it.

| # | What | How | Note |
|---|---|---|---|
| 1 | **The first administrator** | Sign up through the site, then `npm run admin:set -- <email>` with `DATABASE_URL` pointing at RDS | The account must already exist, and must have a **password** identity — `admin:set` matches `provider='password'`. It will refuse otherwise |
| 2 | **Faculty accounts** | Each signs up themselves; an administrator then adds them to a class's Faculty list, or creates the class and adds them | There is no account-creation-by-admin path. Faculty cannot upload a book until they are an instructor on at least one class, or an admin — `canUpload` checks exactly that |
| 3 | **The real classes** | Faculty or admin creates each one | `createSection` enrols the creator as instructor, pins the reading set, and applies the starter gradebook |
| 4 | **The MIS 3000 section** | As above | `seed.ts` will have made a *default* section for `mis3000` already; the real one needs its own name and term |
| 5 | **Deleting or renaming the seeded default sections** | By hand | They have **no instructor**, so nobody can manage them, and `seed.ts` sets `bookPublishedAt: new Date()` — unlike `createSection`, which leaves it null. A seeded section is therefore **published to students with no owner**, which is not what anyone wants in Spring |
| 6 | **Publishing each book to each class** | Faculty, per class | `createSection` sets `bookPublishedAt: null` on purpose |
| 7 | **Publishing each simulation** | Admin, on `/admin/sims` | Sims re-register themselves when their `PLATFORM_URL` points at the site, but `registerSim` writes `published: false`. Until an admin publishes each one, faculty cannot add it to a class |
| 8 | **Adding simulations to classes** | Faculty, per class | `class_sims` is empty in a fresh database |
| 9 | **Releasing simulation access** | Faculty, per class | Migration 0025 means every new enrolment starts **unreleased**. On a fresh database that is every student in Spring. "Release everyone" is on the class's Simulations page |
| 10 | **"Allow joining with the class code", if wanted** | Faculty, per class | Migration 0026 defaults it off for every class |
| 11 | **Faculty previews** | Nothing to restore | `sim_previews` is empty; each faculty member's one 7-day preview per simulation is unspent |
| 12 | **Retired books** | Nothing to restore | `retired_books` is empty, so nothing is retired. `cyber123` and `sad` will not exist unless re-uploaded |

Nothing in this list needs code. It is the handover checklist for Akshay and Vikram, and it belongs
in the AWS runbook rather than in anyone's memory.

## Before the 30 November feature freeze

Superseded by Addendum B; the current list is the commit plan below. In summary:

**Must land, because they are code:** `fsOps()`; local-disk storage for assignment attachments and
submissions, which are **ON** for Spring; the book zip on the same route; the intake worker; the two
Vercel decouplings; the Schema line; retiring the stale intake-runner check; `deploy.yml` becoming
manual; and `deploy.sh` moving into the repository. **4–6 days.**

**Safe afterwards, because it is operations:** the EC2 and RDS resources, the encrypted data volume
and its snapshot schedule, the rehearsed restore (**which has its own deadline of 11 January**),
Multi-AZ RDS (**also 11 January**), DNS, certificates, `db:setup`, the hand-rebuild checklist, the
`flexee-prod` label and the ephemeral runner.

## Rough monthly cost, a few hundred students

| | |
|---|---|
| EC2 `t3.medium` | $30, or $19 reserved |
| RDS `db.t4g.micro` + 20 GB + backups | $15 |
| EBS 30 GB gp3 | $2.40 |
| **EBS data volume, 50 GB gp3 encrypted** (Addendum B) | **$4.00** |
| **Snapshots, 6-hourly, 30-day retention** | **$2–4** |
| SSM / Secrets Manager | $0–1 |
| Data transfer out | $1–5 |
| **Total** | **~$55–62, or ~$45 reserved** |

Multi-AZ RDS adds ~$13. A few hundred students reading markdown is a trivial load. If the AI
assistant is switched on, the provider's token bill will exceed all of the above.

## Re-publish the three books — not to Blob *(destination superseded by Addendum B: the volume)*

**Yes, and not to Blob.** The Blob store is at 1.3k of its 2,000 included advanced operations;
`put` and `copy` each count one, a book publish is hundreds, and Vercel's documentation is explicit
that crossing the limit removes Blob access for thirty days. Spending that budget on a store being
abandoned, which has already lost its contents once, is the wrong trade.

The first load needs no new code:

```
python tools/flexee_intake.py --book-id fz1001 --drive-folder <id> --standards-folder <id> --out content
python tools/flexee_intake.py --book-id fz1001 --out content --approve
aws s3 sync content/ s3://<bucket>/live/ --exclude "_*"
```

then `db:sync-content` and `db:sync-questions`. Bucket versioning on before the first sync.

## What is needed from Vikram and Akshay

**Account and region**

- The dedicated **Flexee AWS account** inside the One Smarter organization, not One Smarter's
  production account (as the existing runbook already specifies).
- **us-east-2 (Ohio)**, which the runbook assumes. Changing it later means moving the bucket.
- Confirmation that the runbook's **EC2 + Caddy** shape stands, rather than ECS or App Runner.

**Storage — superseded by Addendum B: there is no bucket**

- A **separate encrypted gp3 data volume**, 50 GB, attached to the instance and mounted at a fixed
  path. Not the root volume.
- The mount path, so `CONTENT_DIR` and the student-file root can be set to match.
- A **Data Lifecycle Manager** policy: snapshots every 6 hours in term, daily out of term, 30-day
  retention.
- A **restore rehearsed and documented before 11 January** — condition 3 of Addendum B.

**IAM**

- The instance profile needs `AmazonSSMManagedInstanceCore` for Session Manager, so **no port 22**.
- **No S3 policy, no bucket policy and no GitHub OIDC role** are needed any more.
- A **`flexee-prod` label on the self-hosted runner**, and the runner run `--ephemeral`, so another
  repository in the organisation cannot execute on the box.

**What the box uses, which blocks commit 5**

- Whether the app runs under **compose, systemd or pm2**, and the contents of
  `/var/www/Flexee_Wrapper/deploy.sh`.

**Secrets to place**

`DATABASE_URL`, `LAUNCH_SECRET` (**byte-identical** to the sims'; `/api/health`'s fingerprint is how
to verify that without revealing it), `CRON_SECRET`, `APP_URL=https://learn.flexee.org`,
`HEALTH_SECRET`, `RESEND_API_KEY` + `MAIL_FROM` when email is wanted, `GITHUB_DISPATCH_TOKEN`, the
Google service-account JSON for Drive, and an AI key if the assistant is on.

**Decisions still needed**

1. **Assignment attachments in Spring: on or off?** This decides whether 1b is three days of
   pre-freeze work or a one-line decision.
2. **Multi-AZ RDS?** ~$13 a month for failover on a system that will hold grades.
3. **Does `rapidsims.flexee.org` stay** as a rewrite-only domain after the move, per C2-2 §5, or is
   it retired outright once the sims are repointed?

## Addendum A (9 October 2026) — the browser book-upload flow on AWS

Vikram found three blockers in the flow that takes a book from a faculty member's browser to the
library. All three are confirmed in the code, and they are not independent: how the second is
answered decides how much of the rest has to be rebuilt.

| # | Blocker | Where |
|---|---|---|
| 1 | The upload itself is a Vercel Blob browser upload | `src/app/api/library/upload/route.ts` → `handleUpload` from `@vercel/blob/client`; `src/app/library/UploadForm.tsx` → `upload()` |
| 2 | The intake connects to the database **directly from a GitHub-hosted runner**, and RDS is private | `.github/workflows/library-intake.yml:19` — `DATABASE_URL: ${{ secrets.DATABASE_URL_DIRECT }}` on `runs-on: ubuntu-latest` |
| 3 | The intake writes through `vercelBlob()`; there is no S3 writer | `scripts/library-intake.ts:28` |

### What the intake actually needs, which is what the options turn on

**Three things from the database**, not one:

1. `getUpload(uploadId)` — read the `library_uploads` row.
2. `setStatus(...)` — write status, report, register version, message, `publishedAt`.
3. `syncDbWithScripts(out)` → `db:sync-content` and `db:sync-questions`, which write
   **`chapter_versions`, `learning_objectives` and `questions`**.

**And the decisive detail: the question bank never reaches object storage.**
`library-intake.ts:159` publishes `walk(tree).filter(rel => rel !== "questions.json" && rel !== "objectives.json")`.
Those two files go from the job's temp directory **straight into the database** and are never written
to Blob, and would never be written to S3. On top of that, `sync-content.ts` and
`sync-questions.ts` read `CONTENT_DIR` through `node:fs` directly — **they do not go through
`contentStore()`**, so they cannot read S3 at all today.

Together those mean: **whatever runs the intake must hold the built tree on local disk and have
database access at the same moment** — unless that is deliberately changed, which is most of the
cost of option (b).

**And from the host:** Node 22 with `npm ci`, Python 3.12 with **Pillow**, the repo's `tools/`, about
fifteen minutes, and serialisation per book. Pillow is **not optional**: `flexee_intake.py:494`
imports it unconditionally inside the figure loop, so any book with figures needs it. The workflow
gets per-book serialisation from `concurrency: group: library-intake-${{ inputs.book_id }}`, and
whatever replaces it must provide that too.

**What is already injectable, and worth preserving:** `runJob(opts)` takes `blob: BlobOps` and
`syncDb` as parameters, and `scripts/it-library.ts` already drives it with fakes for both. The
tested core does not need rewriting for any option below — only the *trigger* and the *blob
backend* change.

### The options

#### (a) A self-hosted GitHub runner inside the VPC

Register a runner on the existing `t3.medium` (as a container) or its own small instance, label it,
and change `runs-on: ubuntu-latest` to `runs-on: [self-hosted, flexee]`. `DATABASE_URL_DIRECT`
becomes the RDS endpoint, reachable because the runner is inside the VPC.

- **Effort: ½ day, and zero application code** beyond `s3Ops()`, which every option needs.
- **Cost: $0** co-located on the existing box; ~$15/month for a dedicated `t3.small`.
- **Risk — and it must be an explicit decision, not a side effect.** A self-hosted runner executes
  workflow code *from the repository* on a machine that holds database credentials and sits inside
  the VPC. Anyone who can push a branch can run code there. Mitigations: keep the trigger
  `workflow_dispatch`-only, as it already is; **never** add a `pull_request` trigger; scope the
  runner to this one repository; run it in a container as a non-root user with `--ephemeral`.
  Secondary risks: the runner agent needs patching, and if that box is down the intake stops.
- **Verdict:** fastest and cheapest, and the only option with no new code. Its cost is a standing
  security property to document and live with.

#### (b) The intake reports to the app over an authenticated HTTPS callback

The runner stays on GitHub-hosted infrastructure, never touches the database, and posts its result
to a new endpoint.

What it actually requires, given the detail above:

- `s3Ops()` (needed anyway);
- somewhere for `questions.json` and `objectives.json` to travel, since they are excluded from the
  published tree — a new `staging/<uploadId>/` prefix with a lifecycle rule, uploaded by the runner
  and deleted by the app;
- a new authenticated endpoint (`POST /api/library/intake-result`) with its own shared secret,
  replay protection and size limits — a permanent public write surface that did not exist before;
- **teaching `sync-content.ts` and `sync-questions.ts` to read the content store instead of
  `CONTENT_DIR`**, which is a real refactor of two scripts and their tests;
- the database load then happens inside a web request and takes minutes, so it needs a background
  worker regardless — which is most of option (c) arrived at sideways.

- **Effort: 3–4 days.** The most new code of any option.
- **Cost: $0 extra infrastructure.**
- **Risk:** a new authenticated write endpoint is a new thing to get wrong, and the staging prefix
  is a new place for half-finished state to accumulate. The upside — the runner holds no database
  credential — is real but is also achieved by (c) and (d) without any of this.
- **Verdict:** the tidiest on a diagram and the worst value here.

#### (c) The intake runs on the EC2 box, started by the app

Drop GitHub Actions from this flow entirely. Add Python 3.12 and Pillow to the image (or a second
small image sharing the repo), and run the existing `runJob` on the box.

The app must not run a fifteen-minute job inside a request, so the trigger is one of:

- **a second compose service that polls** `library_uploads` for `checking` and `publishing` rows —
  simplest, needs no IPC, and the status machine it reports through already exists; or
- a detached child process spawned by the app.

Per-book serialisation, which `concurrency` gave for free, is replaced by a Postgres advisory lock
keyed on the book id — `scripts/auto-init.ts` already uses `pg_advisory_xact_lock` for exactly this
kind of mutual exclusion, so there is precedent in the repository.

- **Effort: 1–2 days.**
- **Cost: $0.** Same box; roughly +100 MB of image for Python and Pillow.
- **Risk:** a CPU- and memory-hungry job (Pillow resizing every oversized figure) on the same
  `t3.medium` as the web app — it wants a memory limit in compose. GitHub's free logs and retry
  button are lost, though `library_uploads.report` and `.message` already carry everything a reader
  sees, and `run_url` simply becomes null. **One honest wrinkle:** on a single EC2 instance the app
  and the worker share one instance profile, so scoping the app to read-only S3 and the worker to
  read-write needs either a separate credential for the worker or the acceptance that the box can
  write to the bucket.
- **Verdict:** fewest moving parts, no new credential of any kind, no new HTTP surface, and the
  database never leaves the VPC.

#### (d) Recommended: (c) as a worker service, with (a) as the documented fallback

Build (c) as a second service in the existing `docker-compose.aws.yml`, polling `library_uploads`
and taking a per-book advisory lock. Keep (a) written down as the fallback if the worker proves
awkward, because it needs no application code and can be stood up in an afternoon.

Why this one:

- **It removes a dependency rather than working around one.** GitHub Actions disappears from the
  book flow; `GITHUB_DISPATCH_TOKEN`, the Actions `BLOB_READ_WRITE_TOKEN` secret, the OIDC role and
  the whole class of "two independently configured credentials that nothing compares" go with it.
  That class of fault is exactly what made the Blob store's emptiness invisible for days.
- **It introduces no new secret.** No runner registration token, no callback shared secret, no OIDC
  trust policy. The worker uses the same `DATABASE_URL` the app has.
- **It preserves the tested core.** `runJob` already takes `blob` and `syncDb` as parameters and is
  driven by fakes in `it-library.ts`; only the trigger and the backend change. Option (b) would
  rebuild half of it.
- **It is half the effort of (b)** and keeps `s3Ops()`, which is needed either way.

The one thing (d) gives up relative to (a) is GitHub's operational furniture — logs, retries, a run
URL. That is a fair trade for deleting a cross-cloud credential pair, and the report a Books
coordinator actually reads has always lived in the database, not in the Actions log.

### Blocker 1 — the browser upload itself

`api/library/upload` issues a Blob client token; the replacement is a **presigned S3 POST** scoped
to `uploads/<uploadId>.zip`, with the existing `canUpload` check and the 200 MB cap unchanged
(`runJob` already refuses anything larger). `UploadForm.tsx` posts the form fields S3 returns
instead of calling `upload()`. Same shape as stage 1b's presigned PUT, so the two should be built
together and share one helper.

- **Effort: ½ day on top of 1b**, because 1b establishes the presigning helper and the client
  pattern. Alone it is closer to 1 day.

### What must land before 30 November

All three blockers are code, and the browser upload flow is not optional for Spring, so all three
land before the freeze.

| Item | Effort | Why it cannot wait |
|---|---|---|
| `s3Ops()` | ½–1 day | Every option needs it; without it nothing can publish a book |
| Presigned S3 for assignment and submission files (stage 1b) | 2–3 days | Establishes the presigning helper, and is the largest code item in the migration |
| Presigned S3 for the book zip upload (blocker 1) | ½ day | Shares 1b's helper |
| The worker service and its trigger (option d) | 1–2 days | Blocker 2. The image change, the entry point and the advisory lock are all code |
| `VERCEL_GIT_COMMIT_SHA` and the cron trigger | ½ day | Code |

**Total: 5–7 days of code before the freeze.**

Operations that may follow the freeze: registering a runner if (a) is ever needed, the EC2 and RDS
resources, IAM, SSM, DNS, certificates, `db:setup`, and the hand-rebuild checklist.

**One consequence of choosing (d) worth stating plainly:** `GITHUB_DISPATCH_TOKEN` and the
`library-intake.yml` workflow stop being part of the book flow. Spec 24's `/admin/status` **intake
runner** line checks exactly that token and workflow, so it becomes a check of something no longer
used. It should be retired or re-pointed at the worker — a small change, but one that will otherwise
leave a green line on the status page proving nothing.

## Addendum B (9 October 2026) — EBS instead of S3, and what Akshay had already built

**Where this differs from the body or from Addendum A, this addendum wins.** The body was written
assuming S3 for both books and student files. That is no longer the plan.

### What was already on the box when this spec was written

Discovered when pushing commit 1: `main` had moved, with two commits nobody had mentioned.

- **`784842f` adds `.github/workflows/deploy.yml`** — `on: push: branches: [main]`,
  `runs-on: [self-hosted, Linux, X64]`, running `/var/www/Flexee_Wrapper/deploy.sh`. So **every
  push to `main` deploys production**, and pushing commit 1 deployed it.
- **`610b366`** was committed by `Ubuntu <ubuntu@ip-172-31-26-231.ec2.internal>` — on the box
  itself, in a `172.31.x.x` default-VPC subnet.

Three things follow.

**Addendum A's option (a) is not hypothetical; it is live.** A self-hosted runner already exists
inside the VPC. That makes the fallback cheaper than priced, and it is why the worker (option d)
remains the choice on its merits rather than on effort alone: it removes the cross-cloud credential
pair, which the runner's existence does not.

**The deployment deviates from the runbook**: `/var/www/Flexee_Wrapper`, not `/opt/flexee`, and
nothing in the workflow mentions Docker or compose. **`deploy.sh` is not in the repository**, so
what it does — including whether it runs migrations — cannot be read from here.

**`flexee-intake.yml` cannot work against a private RDS.** It runs `db:setup` from a
GitHub-**hosted** runner against `secrets.DATABASE_URL_DIRECT`. That is blocker 2 again, and
`db:setup` from CI against a production database is not something to keep even if it could connect.

### Decision: books and student files on an encrypted EBS volume, not S3

Approved with all four conditions. What changes:

| | Body of this spec | Now |
|---|---|---|
| Book content | `CONTENT_STORE=s3` | **`CONTENT_STORE=fs`**, already built and tested, reading the mounted volume |
| Intake writes | `s3Ops()` | **`fsOps()`** — the same five-method `BlobOps`, against the filesystem. Smaller, and `it-library.ts`'s existing fake is already close to it |
| Student and faculty files | presigned S3 PUT and GET | **a route that streams the body to the volume, and one that streams it back**. `uploadPrefix()`, `downloadable()`, the 50 MB cap and `safeKey()` are unchanged |
| Book zip upload | presigned S3 POST | the same streaming route, one more path |
| S3 credentials | instance profile, OIDC role, bucket policy, versioning | **none of it** |

**Why**, in one line: it recovers 2–3 days of code seven weeks before a freeze, on the two items
most likely to overrun, and it removes a duplication rather than substituting a backend — the worker
needs the built tree on local disk anyway, so S3 would have meant one copy on disk and another in a
bucket with a sync step between.

**The four conditions, which are part of the decision and not advice:**

1. **A separate encrypted gp3 data volume**, not the root, so it survives instance replacement and
   is snapshotted independently.
2. **Snapshots every 6 hours in term, daily out of term**, via Data Lifecycle Manager. This is what
   turns "up to 24 hours of submissions lost" into "up to 6".
3. **A restore rehearsed and written into the runbook, done before 11 January.** An unrehearsed
   restore is not a backup, and this condition is what makes the choice defensible.
4. **`S3Store` stays in the codebase and stays tested.** `test:storage`'s three-way comparison keeps
   running, so moving to S3 later is one environment variable rather than a project. `blobPath`
   likewise keeps its name and holds filesystem keys.

**What is knowingly accepted:** books and every student submission depend on one instance and one
volume; gp3 carries roughly a 0.1–0.2% annual failure rate against S3's eleven nines; restore is a
procedure rather than a command; and a second app instance is foreclosed without EFS or S3 later.
Books are regenerable from Drive in minutes. Submissions are not regenerable at all, which is what
condition 2 is for, and `submission_files` rows survive in RDS, so a loss is recoverable by asking
named students rather than silently.

**The asymmetry is deliberate and should stay visible:** Multi-AZ RDS before 11 January gives the
database cross-zone redundancy while the files sit in one zone on one volume. Grades are in the
database; submissions can be re-collected.

**Cost:** 50 GB gp3 **$4.00/month**, snapshots at 6-hourly with 30-day retention **$2–4/month**,
DLM itself free. Against S3 at under $1. **EBS is marginally the more expensive option**, by roughly
$60 a year; cost was not the deciding factor in either direction.

### Decision: auto-deploy stays for now, and becomes manual before the freeze

There is no live data and no users, so deploying on every push to `main` is acceptable today and
convenient. **Before 30 November, `deploy.yml` becomes `workflow_dispatch` only** — the same change
the freeze implies for everything else, and it must land before students exist.

Pushing resumes only after the two schema checks below have been read.

### Decision: a Schema line on `/admin/status`

The question "is 0027 applied on the box?" could not be answered from anywhere, which is itself the
finding. A seventh check — **Schema** — compares what the database has applied against what the
image shipped:

- **applied**: `count(*)` and `max(created_at)` from `drizzle.__drizzle_migrations`. `created_at`
  holds the journal's `when`, because the migrator inserts `migration.folderMillis` there
  (`drizzle-orm/pg-core/dialect.js`), so the newest row maps to a tag without guessing.
- **expected**: the entry count and last `when` from `drizzle/meta/_journal.json`, which ships in
  the image.
- **ok** when they agree; **attention** when applied is behind, naming the missing tags, because
  that is the state where a reader meets `42703 column … does not exist`; **attention** when applied
  is ahead, which means the code was rolled back under the schema; **down** when the table is
  absent, which means nothing has ever migrated.
- **The caveat it must print**, in the manner Spec 24 established: this compares counts and
  timestamps, **not hashes**. drizzle never re-compares a migration's recorded hash, so this cannot
  prove that what ran was what the file now says — only that something with that timestamp ran.

### Decision: the worker matches how the box actually runs the app

Addendum A specified the worker as "a second service in `docker-compose.aws.yml`". That assumed
compose, and `deploy.yml` suggests the box may not use it. **The worker will be designed once the
box's process manager is known** — compose, systemd or pm2 — because the trigger, the restart
policy and the memory limit differ in each. The parts that do not change whichever it is: polling
`library_uploads` for `checking` and `publishing`, a per-book `pg_advisory_lock`, Python 3.12 with
Pillow available, and reporting through the existing status machine.

### Also decided

- **`deploy.sh` moves into the repository** once pasted, so what deploys is reviewable and
  versioned. Today it exists only at `/var/www/Flexee_Wrapper/deploy.sh`.
- **`flexee-intake.yml` is retired.** It cannot reach a private RDS, and running `db:setup` from CI
  against production is not wanted even where it can.
- **A `flexee-prod` runner label and an `--ephemeral` runner** are a DevOps task, not a code change.
  `runs-on: [self-hosted, Linux, X64]` carries no repository-specific label today, so any other
  repository in the organisation that can reach that runner pool can execute on the box.

### The two checks to run before pushing resumes

Read-only, against the AWS database:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'sim_previews' AND column_name IN ('expires_at','reset_at','reset_by');

SELECT count(*) AS applied, max(created_at) AS newest FROM drizzle.__drizzle_migrations;
```

`applied` should be **28** (`0000`–`0027`) and `newest` **1791911616249**. Lower means `deploy.sh`
does not run migrations and the schema is behind the code — in which case the release gate from
Spec 27 is live against a table without `released_at`, and a student launch would meet
`42703 column "released_at" does not exist`.

## Commit plan

Superseded by Addendum B where the two differ. Each commit stands alone and leaves every suite
passing. Commit 1 is pushed; everything below is unstarted.

| # | Commit | Code? | Effort |
|---|---|---|---|
| 1 | **The spec**, with its addenda and decisions — `8b02cd7`, pushed | — | done |
| 2 | **`fsOps()` for the intake writer** — the same five-method `BlobOps` against the filesystem, chosen by `CONTENT_STORE`, tested on `it-library.ts`'s existing fake. Replaces the `s3Ops()` the body called for | yes | ½ day |
| 3 | **Local-disk storage for assignment attachments and submissions** — a route that streams the request body to the data volume and one that streams it back. `uploadPrefix()`, `downloadable()`, the 50 MB cap and `safeKey()` unchanged; the two client components post multipart instead of calling `upload()` | yes | ~1 day |
| 4 | **The book zip upload on the same route** — one more path, and `runJob` reads the zip from disk instead of `blob.download` | yes | ½ day |
| 5 | **The intake worker** — polling `library_uploads`, a per-book `pg_advisory_lock`, Python 3.12 with Pillow, reporting through the existing status machine. **Shape pending the box's process manager** (Addendum B) | yes | 1–2 days |
| 6 | **The two Vercel decouplings** — `VERCEL_GIT_COMMIT_SHA` as a build argument, the cron as an external trigger with `CRON_SECRET` | yes | ½ day |
| 7 | **The Schema line on `/admin/status`** — applied migrations against the journal's count and newest `when`, with the hash caveat printed | yes | ½ day |
| 8 | **Retire or re-point the intake-runner status line** — with the worker in place it checks a token and workflow the book flow no longer uses | yes | ½ day |
| 9 | **`deploy.yml` becomes `workflow_dispatch` only**, and **`flexee-intake.yml` is deleted** | yes | 1 hour |
| 10 | **`deploy.sh` into the repository**, once pasted, so what deploys is reviewable | yes | 1 hour |
| 11 | **`deploy/aws` brought up to date** — `CONTENT_STORE=fs` and the volume mount, the 6-hourly snapshot schedule, the rehearsed-restore procedure, the hand-rebuild checklist, C2-2 §5's switch-over order, the `flexee-prod` label and ephemeral runner as DevOps tasks, and the stale "Supabase session pooler" comment corrected to Neon | docs | ½ day |
| 12 | **`docs/changes/28_AWS_Migration.md`** | docs | — |

**Commits 2–10 are code and land before 30 November — 4–6 days**, which is 1–2 days less than the
S3 plan. Commit 11 is what Akshay works from and is cheap enough to do alongside.

Commits 3 and 4 share one streaming-upload helper and go in that order. Commits 6, 7 and 9 are
independent of everything else and can be built at any point. **Commit 5 is blocked** until the box's
process manager is known.

**Not in this plan, and no longer needed:** `s3Ops()`, presigned uploads of any kind, the S3 bucket,
bucket versioning, the S3 IAM policy and the GitHub OIDC role.

## Rules (tests must prove each)

1. `fsOps()` round-trips a book — put, list, copy, download, del — with the same assertions
   `it-library.ts` already makes of its fake, and refuses a key that would climb out of the content
   root, which `safeKey()` already enforces for reads.
2. A publish archives the previous version and deletes only files absent from the new version, with
   the same scoping the Blob path has, proved the same way.
3. `CONTENT_STORE` selects the writer, and a misconfigured store is refused with a message naming
   the missing setting.
4. An upload is accepted only for a path the signed-in person is entitled to, and a request for
   anyone else's prefix is refused — the existing `uploadPrefix` tests, re-pointed at the disk route.
5. A download streams only to someone `downloadable()` allows, and the storage path never reaches
   the browser.
6. An upload larger than the cap is refused **while streaming**, not after the whole body has been
   written to the volume.
7. `/api/health` still reports the running commit when `VERCEL_GIT_COMMIT_SHA` is absent and the
   build argument is present.
8. The cron route still refuses a request without `CRON_SECRET`, whatever triggers it.
9. The worker claims one book at a time: two workers started on the same `checking` row produce one
   run, not two, proved by holding the advisory lock and watching the second attempt wait.
10. The worker reports through the same status machine — a stopped intake leaves `stopped` and
   nothing published, a failure leaves `failed` with a message, and neither needs a `run_url`.
11. The Schema line reads **ok** when applied matches the journal, **attention** naming the missing
   tags when it is behind, **attention** when it is ahead, and **down** when
   `drizzle.__drizzle_migrations` is absent — each driven by a fixture rather than the real database.
12. Every existing suite passes, including `test:storage`'s three-way comparison, which keeps
   `S3Store` honest under condition 4 of Addendum B, and `test:library`'s drive of `runJob` through
   its fakes.

## Not in scope

- Any migration of old data. There is none; the Blob store and the Neon database are abandoned.
- **S3 for books or student files** (Addendum B). `S3Store` nonetheless stays in the codebase and
  stays tested, so it remains one environment variable away.
- SES. Resend works from AWS unchanged, and `setMailTransport` is a one-function seam.
- `output: "standalone"`, RDS Proxy, autoscaling, a second environment for previews. **Multi-AZ RDS
  is in scope but has its own deadline of 11 January**, not 30 November.
- Retiring `rapidsims.flexee.org`, which stays a 302-redirect-only domain through Spring 2027 and is
  reviewed in summer.
- A second app instance, which the single data volume forecloses until EFS or S3 is revisited.

## Decisions (8 October 2026)

### 1. There is no live data, and test data is not kept

This is the decision that reshaped the plan, so it comes first. What it removes:

- **No `pg_dump`, no restore, no row-count rehearsal, no cutover window.** The database stage drops
  from "½ day plus a rehearsed maintenance window, the only irreversible step" to **two hours,
  whenever AWS is ready**. It can happen in any order relative to everything else.
- **No dual-read fallback** for files uploaded on Vercel. `blobPath` keeps its name and holds S3
  keys; nothing has to stay readable.
- **No early-December window.** There is nothing to coordinate around.

What it does *not* remove is the hand-rebuild list above. A fresh database has no accounts, and the
sections `seed.ts` makes have no instructor and are published to students, which is the one trap in
an otherwise trivial stage.

### 2. The Blob store is abandoned, not recovered

The three books are re-published **straight to S3**, never again to Blob. Two reasons, and the
second is the operative one: the store lost its contents last week for a reason no code path in
this repository can produce, and it stands at 1.3k of its 2,000 included advanced operations, where
crossing the line removes access for thirty days. Writing hundreds of operations into an
unexplained store on a platform being left is the wrong trade twice over.

Bucket versioning is on before the first sync. Had the Blob store had it, that loss would have been
a restore rather than an investigation, and it is the cheapest insurance in this spec.

### 3. Akshay runs the AWS setup; this spec is the code side

So the deliverables split. Commits 2–5 are code and belong before the freeze. Commit 6 is what
Akshay works from: `deploy/aws` updated for S3, the hand-rebuild checklist as a runbook part, and
the C2-2 §5 switch-over order written down where the person doing it will read it.

The existing runbook (v1.0, 26 September, EC2 `t3.medium` + Caddy + RDS `db.t4g.micro`, ~half a day,
$45–60 a month) stands. Its one gap is that it configures `CONTENT_DIR` and a mounted disk, so it
predates the S3 decision; commit 6 closes that.

### 4. The stage order is inverted from the obvious one

Stage 3 — the app — is nearest to done, because the Dockerfile and compose file exist and
`prepare: false` is already set for a pooler. Stage 1a's read half is finished and tested. **Stage
1b, which was not in the original four stages at all, is the largest item and the only one a code
freeze would strand.** So the pre-freeze work is 1b first, then `s3Ops()`, then the two small
decouplings; the AWS resources follow at Akshay's pace.

### 5. The three answers that were open on 8 October

**Assignment attachments in Spring: ON.** So stage 1b is in scope and is the largest single item
before the freeze. It also establishes the presigning (or streaming-upload) helper that the
book-zip route reuses, which fixes the order: 1b first, then the book zip.

**RDS single-AZ now, Multi-AZ before 11 January.** The database gets failover before students
arrive. Worth noting the asymmetry this creates: the database will have cross-zone redundancy while
book content and student files sit wherever the file-storage decision puts them. If that is a single
EBS volume, the files are the weaker half, and the snapshot schedule is what stands behind them.

**`rapidsims.flexee.org` stays redirect-only through Spring 2027** — **302, not rewrite** — for
`/open.html`, `/session.html` and `/faculty.html`, with retirement reviewed in summer. This is
already what Addendum B of Spec 27 decided and what Spec 27 built the three rewrites against, so
nothing changes in the Wrapper. Two consequences to keep in view:

- The redirect must **not** extend to `/api/session-enrolments` or `/api/health`. The sims call the
  roster with `redirect: 'error'`, so a 302 there ends the call. C2-2 v1.1 §5's order exists for
  this reason, and Caddy must not canonicalise those two paths.
- Because the domain survives Spring, the sims' `PLATFORM_URL` values are the only thing that has
  to move at switch-over, and they move one at a time, RapidSim 01 first.

### 6. What was considered and rejected

- **Keeping book content on a disk** (`CONTENT_STORE=fs`, which `docker-compose.aws.yml` already
  does) rather than S3. At 3.8 MB and 148 files it would work and cost nothing, and it remains the
  **rollback** for stage 1a. Rejected as the destination because S3 is where this is going anyway
  and a one-variable fallback is worth more than a saved day.
- **SES.** `setMailTransport` makes it a ~20-line transport later; Resend is an HTTPS API and needs
  no change. Not a migration task.
- **RDS Proxy, Multi-AZ, `output: "standalone"`.** All optional, none load-bearing at a few hundred
  students. Multi-AZ is left as an open question because it concerns grades, not performance.
- **A long-lived AWS access key in a GitHub repository secret** for the intake. Rejected in favour
  of GitHub's OIDC provider and a role to assume: it is the one new credential this migration can
  avoid creating, and the secret it replaces is the same kind that already made two Blob tokens
  disagree without anything noticing.

## Process

As before. Commit the spec with a Decisions section first; build in the order above; every suite
passes; commits authored as Vikram; **show the summary and ask before pushing**; `git pull --rebase`
first. Nothing is run against any live database, and nothing is written to the Blob store.
