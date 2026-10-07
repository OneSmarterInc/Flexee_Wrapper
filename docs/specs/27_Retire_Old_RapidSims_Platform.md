# Spec 27 — Retiring the old RapidSims platform: the Wrapper's side

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 7 October 2026 · Save as `docs/specs/27_Retire_Old_RapidSims_Platform.md` (first commit).
Covers backlog item W4. The old platform's repository is at `D:\Code\Wrapper\Disaster_New` (the `RAPIDSIMS_REPO` your suites use).

## What the RapidSims coordinator reports (facts from both repositories, 7 October)

- **The stakes are low.** No class or paying user has used `rapidsims.flexee.org`; the only activity was one RapidSim 05
  student trial. **Copy no history.** The Wexford legacy ids are ignored. The switch-over can happen at any time.
- **Contract change C2-1 (approved by Vikram): launch passes last 120 minutes, not 60.** Every sim except 04 re-checks the pass
  before it reports completion, so RapidSim+ 01 (70 minutes) fails its final submit and +02 (65 minutes) loses its report.
- **"Switching a sim changes only `PLATFORM_URL`" is not true for ten of the twelve sims.** Three dependencies on the old site
  are not in the contract: (1) **direct-link entry**, where a visitor without a pass is sent to
  `rapidsims.flexee.org/open.html`; (2) **sim addresses**, since sims are served at `rapidsims.flexee.org/sim01` to `/sim10`,
  `/simplus01` and `/simplus02` through the old platform's rewrites; (3) **the session roster**, where sims 03, 04, 05, 08 and
  09 call `POST /api/session-enrolments` and students join live sessions through `session.html`.
- **Decision:** `rapidsims.flexee.org` stays as a **rewrite-only domain**: the sim paths, `open.html` and `session.html` point at
  the Wrapper. The roster endpoint becomes **contract change C2-2**, which the RapidSims coordinator is writing up. Wait for it
  before building that part.

## Part A — C2-1, build now (small; may ship alone)

1. Launch passes last **120 minutes** by default. Change `launchpass.ts` (the default `minutes`) and its comment that says "Sixty
   minutes". A caller that passes its own `minutes` is still honoured.
2. Tests: a pass issued by default is valid at 119 minutes and invalid at 121; a custom length is honoured; update any suite
   that assumes 60 (for example `test:sims`).
3. Find every other place that states or assumes 60 minutes (comments, docs, the change notes) and list them in your report.
   Don't edit the Systems Map; I will.

## Part B — before writing any code, read and report (do not build until I say go)

Read the Wrapper and the old platform, and report for each item below: how the old platform does it today, what the Wrapper
already has, the gap, a proposal, and your open questions.

**Must build before the old platform can retire:**
1. **Paid access before launch.** What does "paid" mean in the old platform (what is paid for, by whom, how recorded, how
   checked before a sim launches)? What does the Wrapper do today when a faculty member adds a sim to a class?
2. **The session invite entry page and the roster endpoint** (`session.html` and `POST /api/session-enrolments`, used by sims 03,
   04, 05, 08, 09). Read how each sim calls it and what it expects back. The contract text (C2-2) is coming from the RapidSims
   coordinator; report what you find so we can check the two against each other.
3. **Per-student results:** what a faculty member sees about each student's play in the old platform, against the Wrapper's
   "Who has played" view and the participation column.
4. **Direct-link entry:** what `open.html` does for a visitor with no pass, and what the Wrapper needs so that visitor can sign
   in, choose a class, receive a pass and return to the sim.

**Should build:**
5. **Faculty self-serve 7-day previews.**
6. **The transcript page.** Only RapidSim+ 01 sends transcripts today.

**The rewrite-only domain:** say what the Wrapper must provide so that `rapidsims.flexee.org` can rewrite `/open.html` and
`/session.html` to it (cookies, cross-origin calls, redirects), and what could go wrong.

**Do not build (decided):** seat caps (stored, never enforced), the guest-code fallback, the migrate and test-data pages, and the
catalogue snapshot file.

## Process

As before. Part A: build, run every suite, commit as its own commits, **show me the summary and ask before pushing**. Part B: the
report only. No change notes yet for Part B, no migration without telling me first, commits authored as me, `git pull` first, and
nothing against the live database.

---

## Decisions — Part A only (7 October 2026)

Part B is a read-and-report; its decisions will be added when the report has been read. Nothing
below touches Part B.

### A1. The default lives in one named constant

`PASS_MINUTES = 120`, exported from `src/lib/launchpass.ts`, with `launchPass` reading
`a.minutes ?? PASS_MINUTES`. The number was written inline before. A caller that passes its own
`minutes` is still honoured in both directions — shorter and longer — and `minutes: 0` means
"already expired" rather than "fall back to the default", because `??` only replaces null and
undefined.

### A2. The premise was checked against both repositories, and holds

Read from each sim's own `lib/scenario.js` / `lib/meta.js` in `D:\Code\Wrapper\Disaster_New`:

| Sim | Declared minutes | Over the old 60? |
|---|---|---|
| RapidSim+ 01 (`sim-plus-01`) | **70** | yes |
| RapidSim+ 02 (`simplus02`) | **65** | yes |
| 03 Midland, 05 Approve | 30 | no |
| 08 Later | 25 | no |
| 01 Disaster, 02 Relay, 09 Money Land | 20 | no |
| 06 | 15 | no |

Both long sims carry a `lib/guard.js` that calls `verifyLaunch` on every request, their final
submit included, so an expired pass does lose the result rather than merely blocking re-entry. 120
minutes clears the longest declared sim by 50.

### A3. The Wrapper's default now differs from the old platform's, deliberately

`Disaster_New/platform/lib/launch.js` still has `minutes = 60`. It is not edited: that platform is
being retired, and nothing in the Wrapper reads it. The **wire format is unchanged**, so passes
stay interchangeable — a sim reads `exp` and does not care how it was chosen. The comment at the
top of `launchpass.ts` said the file was "identical to" the old one; it now says the *format* is
identical, which is the part that must stay true.

### A4. Where else 60 minutes was stated

Rule 3 asked for the list. In the Wrapper there were exactly two, both now changed:

| Place | Was |
|---|---|
| `src/lib/launchpass.ts:34` (comment) | "Sixty minutes, so it outlives the longest sim" |
| `scripts/it-sims.ts:117` | `assert.ok(life >= 59 && life <= 61, "a pass lasts 60 minutes")` |

Nothing in `docs/`, `deploy/` or the change notes states a pass lifetime at all. Three further
places say 60 but mean something else and are left alone: `src/lib/sims.ts` and the two sim-catalogue
pages, where `minutes` is a sim's *advertised duration* ("about 20 minutes"), not a pass; and the
book content under `content/mis3000/`, which is prose about megawatt-hours.

**Not edited, as instructed:** the Flexee Systems Map. Also not edited, because they are not this
repository's: `Disaster_New/platform/lib/launch.js` (`minutes = 60`), and two test helpers there
that mint their own hour-long passes — `simplus02/test/integration.test.js:28` and
`simplus02/tools/browser-check.js:50`, both `exp: now + 3600000`. Those two are worth a line to the
RapidSims coordinator: they are a sim's own tests asserting against an hour, so they encode the old
contract even though no sim's runtime does.
