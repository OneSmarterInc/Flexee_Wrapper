# Flexee Reader

A manifest-driven reader for Flexee books, on Next.js (App Router) + TypeScript, with
accounts, per-section enrolment, and per-account bookmarks backed by PostgreSQL (Drizzle).
It has no per-book code: it renders any `content/<book-id>/` tree that follows the
manuscript intake standard. SAD (MIS 3250) and MIS 3000 both run from the same code.

## What's built

- **Reader (step 2):** catalog, spine sidebar, in-chapter section list, prev/next, figure
  asset route, dark mode, progress bar. GFM rendered in-process (remark/rehype); section
  anchors come from the manifest, figures resolve to images, pending placeholders, or tables.
- **Accounts, enrolment, bookmarks (step 3):** email/password sign-in, entitlement that
  lives on the enrolment, and a reading position that resumes where you left off.
- **Instructor console (standalone):** create and own a section, share a join code,
  import a roster from CSV, and manage enrolments. Students join by code or are
  auto-enrolled from an uploaded roster on first sign-in. No LMS required.
- **Content-publishing console:** each section reads a pinned set of chapter versions.
  Publishing content records immutable versions; a feature upgrade waits for the
  instructor to review a diff and publish it to their section, while errata are pushed
  automatically. Two sections can read two different Chapter 5s, both correct.
- **Assessment:** a structured question bank per book (schema in `specs/`), instructor
  exam assembly (random draw or fixed set, served per student), student attempts with
  scoring and rationale feedback, and per-student and per-question reporting. Each exam is
  a gradeable per enrolment.
- **Assessment of learning:** questions link to per-book learning objectives, so results
  aggregate into mastery — by objective, per class and per student. A section can define its
  own syllabus outcomes and map them to the book's objectives, so mastery rolls up to a
  faculty member's outcomes (the syllabus link populates at adoption; empty until then).
- **Gradebook + grade export:** every exam is a gradebook column (a line item); faculty can
  add manual columns and set per-section weights, and each student gets a weighted total over
  the items they've been graded on. Export as CSV in generic / Canvas / Brightspace(D2L) /
  Blackboard / Moodle shapes. Built on a generic "line item for anything gradeable" model, so
  simulation milestones drop in later and it maps to the LTI line-item seam.

- **LTI 1.3 (attachment layer):** Flexee is an LTI tool — OIDC login, resource-link launch
  with full id_token validation (signature/issuer/audience/expiry, single-use nonce,
  deployment check), mapping the LMS user, context and roles onto the existing seams
  (`identities` provider `lti`, `sections.external_context_id`, enrolment), plus a JWKS and a
  config endpoint for registration, **Deep Linking** (the instructor picks the book at placement), and **AGS grade pass-back** (a line item per gradebook column + score push, Gradebook → “Push grades to LMS”), and **NRPS roster sync** (the LMS roster populates the section on the instructor's launch, plus a “Sync roster from LMS” button). Instructors land on their section dashboard; students land in the reader. The security mechanics
  are verified locally; a real LMS launch and the AGS network round-trip require an LMS
  conformance test before production (see `LTI_Status.md`).

- **Account-recovery essentials (standalone):** password reset and email verification (via a
  pluggable mailer), auth rate limiting, self-serve email change (fixes a mistyped signup),
  and an account-merge support operation. Every flow is verified; only the actual email *send*
  is a provider adapter (dev logs the link).
- **Assurance of learning:** course outcomes (syllabus) map up to a program's declared outcomes
  (e.g. ABET student outcomes, loaded with `npm run aol:load-program -- institutions/<program>.json`)
  and down to book objectives; simulation and graded-work columns can count as evidence. The
  **Assurance of learning** page sets benchmarks and produces an end-of-term report (Markdown + CSV):
  per-measure and combined results by course outcome, a program-outcome rollup that shows unaddressed
  outcomes explicitly, small-group flags, anonymous aggregates, and a closing-the-loop section for
  faculty. Every served question is frozen at the moment it is served, so review and evidence never
  change when the bank is edited. `npm run test:aol` runs the real library code against in-memory Postgres.
- **Course scaffolding + dashboard:** section-scoped announcements, a per-section syllabus, and
  a "what's due when" schedule; a faculty **My courses** dashboard grouping sections as cards by
  term; and a student **course home** (announcements, what's due, syllabus, continue reading) as
  the place a student lands. This is the connective tissue the AI layer later reasons over.

Deferred: simulation milestones feeding the gradebook (needs the MVCFN engine). The schema
leaves the seams (see `src/db/schema.ts`).

## Run it

Needs Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env            # set DATABASE_URL
ln -s ../content content        # or set CONTENT_DIR to your content tree

npm run db:migrate              # apply the migrations (reading model, console, versioning)
npm run db:sync-content         # snapshot the content tree into the version store (v1s)
npm run db:sync-questions       # ingest each book's objectives.json + questions.json
npm run db:seed                 # one section per book, pinned to the latest versions
npm run dev                     # http://localhost:3000

# after editing content later, re-snapshot (add --errata to auto-push a fix):
# npm run db:sync-content
```

Sign up, and each book on the catalog offers **Enroll**; once enrolled you can **Open** it.
Reading is gated by enrolment — the entitlement lives there, not on the account. Go to
**Teaching** to create a section, get its join code, and import a roster (CSV) — the
importer guesses the email and name columns, lets you correct the mapping, and shows what
will be added before committing.

## The data layer (src/db/schema.ts)

The first migration is the reading model:

- **users** — a person. How they sign in lives in **identities**, not here.
- **identities** — pluggable: (provider, subject) is unique; a password identity keeps a
  hash. Today provider = "password"; an LTI subject slots in later with no auth rewrite.
- **sessions** — server-side; the cookie holds only the token.
- **sections** — a section adopts one book. externalContextId is nullable — the seam an
  LMS section fills later. joinCode supports self-enrolment by code.
- **enrolments** — the entitlement. Enrolled in a section means you may read that book.
- **bookmarks** — one position per enrolment per book, pinned to the chapter version and
  the stable cNsM section anchor, so a future republish can't silently move it.
- **chapter_versions** — immutable snapshots of an entry's content (markdown + manifest),
  deduped by content hash; kind is feature or errata.
- **section_content_pins** — what version each section reads for each entry. This is the
  per-section version pinning the whole design is built around.
- **questions** — the bank (one row per item, ingested from questions.json); options with
  per-option rationale are stored as JSON.
- **exams / exam_attempts / exam_responses** — an assembled exam, a student's attempt with
  the exact questions served (so scoring and review are reproducible), and the graded
  responses behind per-student and per-question reporting.
- **line_items / line_item_scores** — the gradebook. A line item is any gradeable column
  (an exam, or a manual column) with a per-section weight; scores are derived (latest
  submitted exam attempt) or entered manually. Weighted totals and CSV export build on these.
- **lti_platforms / lti_keys / lti_nonces / lti_links** — LTI registration, the tool's signing
  keypair (serves JWKS, signs AGS assertions), launch replay-protection nonces, and the
  section↔LMS-context↔AGS-endpoint link captured at launch.
- **auth_tokens / rate_counters** (+ `identities.email_verified_at`) — single-use expiring
  tokens for password reset and email verification, and a fixed-window auth rate limiter.
- **announcements / section_syllabus / schedule_items** (+ `sections.term`) — the course
  scaffolding: class announcements, one syllabus per section, dated "what's due when" items,
  and the term used to group the faculty dashboard.
- **learning_objectives** — a book's objectives (its catalog substance); questions carry
  `objective_id` referencing one. **section_outcomes / outcome_objective_map** — a section's
  own syllabus outcomes and their mapping to book objectives, so mastery rolls up.

chapter_versions, section_content_pins, and line_items are intentionally deferred to the
faculty-console and assessment migrations; the bookmark stores the version as an integer
now, forward-compatible with them.

## How rendering works (src/lib/render.ts)

Content is GFM markdown rendered with unified/remark/rehype — no external binary. Tables
render natively; figures resolve against the manifest by filename (image to a figure with
caption; pending to a placeholder; a table stays a table); section anchors are assigned
from the manifest's sections by title in reading order, which handles MIS's ## sections and
SAD's numbered ### alike and keeps the cNsM id stable across rewordings.

## Verifying

- npm run build — type-checks and compiles; account/reading pages are dynamic, so no DB is
  needed to build.
- node --experimental-strip-types scripts/it-test.ts — applies the migration in an
  in-process Postgres (PGlite) and exercises signup, login, idempotent enrolment,
  entitlement, and the bookmark upsert.
- CONTENT_DIR=./content node --experimental-strip-types scripts/test-render.ts — renders
  chapters from both books and checks anchors, figures, and tables.

## Layout

```
src/
  db/       schema.ts (reading model), index.ts (lazy client)
  lib/      content.ts, render.ts, auth.ts, enrolment.ts
  app/      catalog, [book] (resume redirect), [book]/[entry] (gated reader),
            login, signup, forgot, reset, account, api/auth/verify,
            actions.ts (auth + enrol + section actions),
            teach, teach/[section] (dashboard), teach/[section]/import,
            teach/[section]/content (+/[entry] diff & publish),
            teach/[section]/exams (+/[exam] results),
            teach/[section]/mastery, teach/[section]/syllabus,
            teach/[section]/gradebook,
            [book]/exams (+/take/[attempt], /result/[attempt]),
            api/asset, api/bookmark, api/roster/commit, api/gradebook/export,
            api/lti/{login, launch, jwks, config, deeplink/return}, lti/select
  components/ Spine, ProgressBar, ThemeToggle, Bookmarker, LogoutButton, RosterImport
  lib/      + roster.ts (sections, roster, invites, join-by-code)
            + versions.ts (record, sync, pin, resolve, diff, errata push)
            + assessment.ts (bank, assemble/serve, attempts, scoring, reporting)
            + mastery.ts (objective mastery, syllabus outcomes + rollup)
            + gradebook.ts (line items, weighting, weighted totals, CSV export)
            + lti.ts (keys/JWKS/config, OIDC login, launch validation + mapping, AGS)
            + recovery.ts (reset, verify, rate limit, change email, merge) + mail.ts (pluggable)
drizzle/    generated SQL migration
scripts/    seed.ts, sync-content.ts, sync-questions.ts, it-*.ts (integration tests), test-render.ts
```

## The "standalone essentials" — status

The unglamorous half the platform brief flags for a standalone deployment is now built:
roster CSV import, self-enrolment by code, grade export, password reset, email verification,
auth rate limiting, mistyped-email correction (self-serve email change), wrong-section fix
(remove + re-join by code), and account merge (`npm run merge:user`). The one external
dependency is **sending email**: `lib/mail.ts` is a pluggable mailer that logs the link in
dev; wiring a provider (SMTP/API) is a single adapter, set via `MAIL_PROVIDER`.
