# Wrapper change 10 — RapidSims behind the front door

**1 October 2026** · Patch `0010-rapidsims-handoff.patch` · applies after `0009-docs-neon-gitattributes.patch`
Implements the Wrapper's side of **contract C2** in `Flexee_Standards/Flexee_Systems_Map_v1.0.md`.

## What it does

The Wrapper now does for RapidSims exactly what the frozen RapidSims platform (`rapidsims.flexee.org`)
does, in the same way, so **the sims need no code change** — only their `PLATFORM_URL` setting changes
at switch-over.

| | Who | Where in the Wrapper |
|---|---|---|
| A sim **registers** itself on start-up | the sim | `POST /api/register` → catalogue entry, **unpublished** |
| An admin **publishes** it, edits its wording, or grants a **preview** before publication | admin | **Administration → Simulations** (`/admin/sims`) |
| Faculty **add** a sim to a class, open it themselves, or **run a live session** | faculty | class page → **Simulations** (`/teach/<class>/sims`) |
| A student **starts** a sim | student | course home → **Simulations** (`/<book>/sims`) |
| The front door **launches** it with a signed pass | Wrapper | `/sims/launch` → the sim's address with `#lt=<pass>` |
| The sim reports a **completion** | the sim | `POST /api/complete` → "Who has played" on the class page |
| The sim sends an instructor **transcript** | the sim | `POST /api/transcript` → stored for the class's faculty |

Rules, the same as the platform's: an unpublished sim is seen only by admins and people granted a
preview; students see a sim only once it is published **and** added to their class; faculty opening an
unpublished sim launch as `faculty_preview`; only faculty can open a live session; a completion or
transcript is accepted only from someone who launched that sim (in that class); metrics are capped at
12 keys and 200 characters; a transcript over 256 KB, or one whose events carry a character's words, is
refused. Wording an admin edits is kept when the sim re-registers — until the sim reports a new
scenario revision, when the sim's own wording returns.

## How it was proven

`scripts/it-sims.ts` runs **RapidSim 01's own code** from `Disaster_New` — its `announce`,
`verifyLaunch` and `reportCompletion` — with `PLATFORM_URL` pointed at the Wrapper and its calls
delivered to the Wrapper's real route handlers. The sim registered itself, **accepted the Wrapper's
launch pass**, and reported its completion back, logging "announced rapid-01-disaster…" and
"completion reported…". The pass was also checked byte-for-byte against the platform's own
`launch.js`, in both directions, and both reject a tampered pass. 14 checks; all pass.

    RAPIDSIMS_REPO=/path/to/Disaster_New npm run test:sims      # 14 passed

## New files

| File | What |
|---|---|
| `drizzle/0015_rapidsims.sql`, `src/db/schema.ts` | `sims`, `sim_previews`, `class_sims`, `sim_launches`, `sim_completions`, `sim_transcripts` |
| `src/lib/launchpass.ts` | The signed pass — identical to the platform's |
| `src/lib/sims.ts` | Catalogue and registration, visibility and previews, class sims, launch, completions, transcripts |
| `src/lib/sim-endpoint.ts`, `src/app/api/{register,complete,transcript}/route.ts` | The three endpoints sims call (open to any origin, same answers and status codes as the platform) |
| `src/app/sims/launch/route.ts` | Launch: checks, records, redirects with the pass in the fragment |
| `src/app/sim-actions.ts`, `src/app/admin/sims/`, `src/app/teach/[section]/sims/`, `src/app/[book]/sims/` | The pages |
| `scripts/it-sims.ts` | The test |
| `scripts/it-acceptance.ts` | Reads the repository's own `content/` instead of a fixed machine path |

A book can no longer have the id `sims` (the launch address `/sims/launch` takes that path).

## Setup

1. Apply, `npm install`, deploy. Migration 0015 is applied by `auto-init`.
2. Vercel variable **`LAUNCH_SECRET`** = the **same value** the RapidSims use (each sim's Vercel project
   has it). Without it, launches show "This site has no launch secret set".
3. Nothing else changes yet. The sims still report to `rapidsims.flexee.org`.

## Switch-over (no class uses RapidSims this term, so it can be done whenever this is checked)

1. **Test one sim first.** In RapidSim 01's Vercel project, set `PLATFORM_URL` to the Wrapper's address and
   redeploy (or open it once so it starts). It appears in **Administration → Simulations**, unpublished.
2. Publish it; as faculty add it to a test class; as a test student start it, play it through, finish.
   The class page's **Who has played** shows the completion.
3. Then the same `PLATFORM_URL` change for the other eleven sims, one by one.
4. Retire `rapidsims.flexee.org` when all twelve report to the Wrapper. Its course and completion history
   can be copied across if wanted (not built yet).

## Not yet — next, per the Systems Map

| Item | Notes |
|---|---|
| **Paid access** | The platform lets faculty mark a student or section as paid before a launch is allowed. Not built: today, a published sim in a class can be started by its students |
| **Sims in the gradebook** | A completion is recorded but does not yet put a score in the gradebook |
| **Transcript viewer** | Transcripts are stored and readable by the class's faculty (`transcriptsFor`); no page shows them yet |
| **Seven-day faculty previews** | Previews are granted by an admin; the platform's self-serve seven-day preview is not built |
| **Copying history** from `rapidsims.flexee.org` | Only if wanted |

## Tests

All other suites pass, except two that need test data on the machine running them: `test:library` and
`test:intake` read the real SAD chapter packages from `SAD_PACKAGES` (unchanged by this patch).
