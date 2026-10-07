# 27 — Retiring the old RapidSims platform: Part A and B1

Backlog item W4. The spec and its decisions are in
[`docs/specs/27_Retire_Old_RapidSims_Platform.md`](../specs/27_Retire_Old_RapidSims_Platform.md).
Two addenda and a contract govern this work and live outside the repository, in `D:\Code\Wrapper`:
**Addendum A** (`Spec_27_Addendum_C2-2.md` — the filename says C2-2, the document is Addendum A),
**Addendum B** (`Spec_27_Addendum_B_Decisions.md`), and **C2-2 v1.1**
(`Flexee_C2-2_Session_Roster_v1.1.md`), which supersedes v1.0.

**Two migrations: 0025 and 0026.** Both additive. What they do to the live database is below.

## Part A — contract change C2-1: launch passes last 120 minutes

Every sim except 04 re-checks the pass before it reports completion, so a pass that expires
mid-run loses the student's result silently rather than merely blocking re-entry. At sixty minutes
two sims were already past the line. Read from each sim's own metadata in `Disaster_New`:

| Sim | Declared minutes | Over the old 60? |
|---|---|---|
| RapidSim+ 01 (`sim-plus-01`) | **70** | yes |
| RapidSim+ 02 (`simplus02`) | **65** | yes |
| 03, 05 | 30 | no |
| 08 | 25 | no |
| 01, 02, 09 | 20 | no |
| 06 | 15 | no |

Both long sims put every request through a `lib/guard.js` that calls `verifyLaunch`, their final
submit included. 120 clears the longest declared sim by fifty minutes.

`PASS_MINUTES` is now an exported constant read as `a.minutes ?? PASS_MINUTES`, so the number is
stated once. **The Wrapper's default now differs from the old platform's deliberately**: that
platform's `launchToken` still says `minutes = 60` and its `api/launch.js` passes `60` explicitly,
so changing its default alone would not have changed its behaviour. It is not edited — it is being
retired. The wire format is unchanged, so passes stay interchangeable: a sim reads `exp` and does
not care how it was chosen. The comment at the top of `launchpass.ts` used to claim the file was
"identical to" the old one; it now claims the *format* is, which is the part that must stay true.

`test:launch-pass` is pure — no database, no checkout of the sims — and moves a fake clock rather
than reading the constant, because a test that only asserted `PASS_MINUTES` would still pass if
`verifyPass` stopped reading `exp` at all. There is a check for that too, and one that the payload's
nine keys are untouched: a sim whose verifier accepted a renamed key and then misread it is the
failure no expiry test would catch. `test:sims` adds the contract-level check, where **RapidSim
01's own `verifyLaunch`** accepts the Wrapper's pass at 70 and 119 minutes and refuses it at 121.

**Where else sixty minutes was stated.** Two places in the Wrapper, both changed: the comment in
`launchpass.ts` and the assertion in `it-sims.ts`. Nothing in `docs/`, `deploy/` or the change notes
states a pass lifetime at all. Three red herrings left alone: `sims.minutes` is a sim's *advertised
duration* (a different field that shares the name — a future reader could wire one into the other),
and `content/mis3000/` prose about megawatt-hours. Not edited, as instructed: the Systems Map. Not
ours to edit: `Disaster_New`'s own `launch.js`, and two of RapidSim+ 02's test helpers
(`test/integration.test.js:28`, `tools/browser-check.js:50`) that mint hour-long passes and so
encode the old contract in a sim's tests even though no sim's runtime does. **That last one is for
the RapidSims coordinator.**

## A live defect found on the way: the session code never reached a student

C2-2 §4 step 6 launches a joining student with `mode=play` **and** the session code; the code is how
the sim knows which room to put them in. The Wrapper attached it only when the mode was `session`,
and a student's mode is always `play` — the line above forces it — so **the code was dropped for
every student who ever followed an invite link.** They would authenticate, launch, and arrive at the
sim outside the session with nothing on screen to explain why.

The old platform sets it unconditionally (`platform/api/launch.js`: `if (session)
target.searchParams.set('session', session)`). `play` keeps its gate, and that is why the two are
separate: team-or-individual is the facilitator's choice, and a student must not be able to claim it
by editing a query string. There is a test for each half. C2-2 **v1.1 §4 step 6 now states the
requirement explicitly**, after this was found.

The code is also validated rather than forwarded blindly — five characters from A–Z and 2–9,
upper-cased first, checked before the launch is recorded so a mistyped code leaves no launch in the
log. That immediately caught a fixture of our own: the session test had passed `"ABC123"` since
Spec 12 — six characters, one of them the digit 1, which the contract excludes along with 0 because
they read as I and O off a slide. No sim would ever have accepted it.

## `APP_URL`: the site's own address, in one place instead of five

Every absolute URL was built from the incoming request's `Host` header. **My Part B report said two
places; it was five.** Besides `baseUrl()` in `actions.ts` and the invitation-links route, the same
expression was copied into `/api/class/act`, `/api/roster/d2l/commit`, `/api/roster/d2l/invite`, and
a second time inside `actions.ts` for the sign-up verification mail. All five send email or produce
sign-in links.

What it cost: links pointed at whatever host the faculty member happened to be on, so a download
taken from a Vercel preview handed out links into the preview. `Host` is also client-supplied, and
these are sign-in links. Spec 27 adds the second reason — the sims will set `PLATFORM_URL` to the
Wrapper's canonical address, and `/open` has to build a `next=` round trip through sign-in.

`APP_URL` wins when set; without it the `Host` header is still used, so local development and the
suites need no configuration. Normalising is lenient about a trailing slash and a bare host, because
both are obviously intended and a silent fall back would hide the typo — and what it concluded is
printed on the status page, so the leniency is visible rather than magic. A trailing slash matters
more than it looks: every caller appends an absolute path, so `https://x/` + `/reset` would be
`https://x//reset`. An address carrying a username and password keeps neither; a URL may legally
hold them, and one pasted into this setting would otherwise appear in every emailed link.

`/admin/status` has a seventh line, which says what it cannot prove: the check runs from the
ten-minute cache with no request in hand, so it cannot know which host a visitor arrived on. It
prints `APP_URL`'s value in full, unlike every other setting there, because the address is in every
link the site sends — and the secret-leak check now also asserts that the address *appears*, so
"shown in full" is pinned to this one line.

## B1 — what a faculty member and a student will see

### Access release (the old platform's `paid`, renamed)

A student needs access released before they can start any simulation in their class. Releasing it
once covers every simulation there, and **it does not affect the book, exams or assignments** —
release gates sim launches and nothing else.

Not called `paid`. The old platform's own schema says why: *"No payment tables — money is handled
outside the system and lands here as a 'paid' flag."* Nothing here takes payment either, and a
column called `paid` invites the next person to build billing on it.

Faculty do this on the class's **Simulations page**, because that is where the sims send them:
C2-2 §3 has each roster console build `<PLATFORM_URL>/faculty.html?course=<id>` as its "manage
access" link, and the Wrapper answers that by redirecting there. A row per student, a checkbox
each, release and un-release, an optional note, and a count that leads — "3 students are waiting on
you", or "Every active student has access". Separately, **Release everyone (n)**, shown only when
somebody is waiting so it is never a button that does nothing, skipping withdrawn students. Adding
a simulation offers "Release everyone now" beside the Add button, acted on only after the sim is in
the class so a failed add never releases anyone.

A student who tries too early sees the old platform's words: *"Waiting on your instructor — Your
enrolment is confirmed, but access to this simulation hasn't been released yet."* The check sits
**after** the enrolment and attachment checks so that "not open in your class" still wins — a
student whose class has not added the simulation must not be told to wait for a release that would
not help, and there is a test for the ordering rather than a comment hoping for it.

**The Demo Student is never gated**, and the rule is read at launch rather than stored. It is the
enrolment a faculty member signs into to see the student view, so gating it would mean nobody could
check a simulation works before releasing a single student. Reading it at launch also means no
import or roster path can set a stored value wrongly.

**The note is faculty-only in three senses**, each deliberate: it is not in `sectionRoster`, which
feeds pages a student can appear on; it is not in the class actions log, which takes counts only;
and it is never echoed into a redirect's query string, because a redirect URL is the one thing on
that page which lands in a browser history and a server log, and the note may hold a purchase order
number. The page says so beneath the field.

Both actions are logged as counts: *"Released simulation access for 1 student, skipped 1 withdrawn"*
— readable without the log having learned who, or what the paperwork said.

### Joining with the class code is now off by default

**This takes something away, and that is the decision.** My Part B report said `sections.join_code`
was displayed and consumed nowhere. **That was wrong**: `enrollByCode` redeems it,
`enrollByCodeAction` wires it up, and there is a live form on the student dashboard where any
student could type any class's code and enrol themselves. Decision 2 was taken knowing that:
accounts come from the D2L class list, and nobody adds themselves unless the faculty member opts in.

So every class — existing ones included — refuses the code until its faculty member turns it on,
and the refusal explains itself: *"This class isn't accepting students who join with a code. Ask
your instructor to add you."* That is told apart from a code that does not exist, which is the whole
reason for the extra return shape; one shared "No class found for that code." would send a student
holding their instructor's correct code hunting for a typo that is not there.

The switch is separate from whether a code exists. A test turns it off, on and off again and
asserts the code is unchanged, because the old one may be printed on a slide from last term and
stranding that slide is exactly what a convenience regeneration would do.

### The session roster, the two entry pages, and the three external paths

`POST /api/session-enrolments` is the read-only class roster a sim's facilitator console reads. The
instructor's own launch pass is the only credential, and **every fact in it is re-checked against
the database** — a valid signature proves the Wrapper issued the pass and nothing more. A pass lasts
120 minutes, long enough for the facts behind it to change during one session.

Two things it deliberately does not do, both the opposite of the Wrapper's three existing sim
endpoints. **It sends no CORS headers and has no OPTIONS handler**, because C2-2 says "No CORS
needed": the call comes from the sim's server, so there is no preflight to answer and no origin to
allow, and adding them would expose a class roster to any page on the internet holding a pass. And
**it reads no cookie** — a test sends a session cookie and still gets 401.

Three fields leave the Wrapper and nothing else: no email, no grades, never the release note. The
`platform:` prefix is pinned against the student's own pass rather than hard-coded twice, because
each sim builds the same string itself from the arriving pass (`sim03/api/session.js`:
`` `platform:${launched.sub}` ``) and a divergence would break team assignment silently.

`/session.html` is all eight steps of C2-2 §4, and §4's closing rule — "the page decides nothing the
launch doesn't" — is checked directly rather than asserted: every person in the fixture goes through
both the page and the launch, and the check fails if the fixture stops exercising both sides. The
waiting page re-checks every 5 seconds and **stops after 10 minutes** with a "Check again" button;
it stops because a tab left open over a weekend would otherwise poll forever, and after an hour a
button is more honest than a spinner.

`/open.html` is the only page that has to **find** the class, since every existing link to
`/sims/launch` is built by a page that already knows a section id. It never guesses: with the sim in
two of a student's classes it asks, marking which are ready. The old platform picked one with
`ORDER BY e.paid DESC LIMIT 1`. It keeps the old platform's distinction between "you are in no
class" and "this simulation is not in your class" (naming the class), because reporting both as
"Not enrolled" sent people to check a student's enrolment when the class was fine. **There is no
guest-code fallback**: that route is decided not to be built, so the way through is sign in, come
back, and be released.

`/session.html`, `/open.html` and `/faculty.html` are **rewrites**, because those addresses are
printed inside sims and in invite links already handed out. `trailingSlash` stays at its default,
and a check keeps it there: turning it on would answer the sims' POST with a 308 they refuse to
follow — a setting three files away from the endpoint it would break.

## Two clauses of C2-2 the Wrapper cannot enforce

Both are written into the code rather than skipped quietly, because a future reader comparing the
contract to the implementation will otherwise read them as omissions.

**1. "Not archived" has nothing to check.** C2-2 §4 step 2 ("find that class, and only if the sim is
added to it and it is not archived") and §2 check 4 ("the class exists and is not archived") both
assume the old platform's `courses.archived`. **The Wrapper has no archived-class concept** —
`sections` has no such column, and nothing anywhere treats a class as retired. The rest of each
check is enforced; this part is a no-op. C2-2 v1.1 dropped the old platform's "account not disabled"
clause for the same reason, and could drop this one on the same grounds.

**2. There is no supported route to a withdrawn instructor.** Check 4 asks for "an instructor
enrolment that is not withdrawn". `setWithdrawn` refuses any row whose role is not `student`
(`src/lib/withdraw.ts`), so **nothing in the Wrapper can create a withdrawn instructor enrolment.**
The filter is kept anyway, as defence: the column exists on every enrolment, and a future bulk
action or import that stopped excluding instructors would otherwise hand a withdrawn one a live
roster. It is tested by writing `withdrawn_at` directly, with that reason recorded beside the test —
and the realistic case, where the instructor's enrolment is *removed* while their pass is still
valid, is tested through the supported path. My first version of that test withdrew the instructor
through the API, where nothing happened, so it was testing my own fixture.

Related, and also unreachable: check 4's old "or is an administrator" branch. `prepareLaunch`
requires an instructor enrolment on the section, so **an administrator who does not teach a class
can never obtain a session pass for it**, and the branch could never fire. v1.1 removed it.

## `/api/health` — required by C2-2 v1.1, not yet built

v1.1 **§5 step 1** makes it a precondition of switch-over: `https://learn.flexee.org` must go live
*and answer `/api/health` with no redirect* before any sim is repointed. v1.0 did not ask for it,
and the Wrapper has no such route — its API routes are `aol, asset, assistant, auth, bookmark,
class, complete, cron, files, gradebook, library, lti, register, roster, session-enrolments,
transcript`.

It is **the first B2 commit**, ahead of the rest of B2, because the domain cannot go live without
it. The old platform's `platform/api/health.js` is the model, and two things in it are worth
keeping:

- **It reveals nothing without a secret.** Without `x-health-key` matching `HEALTH_SECRET` (compared
  in constant time) it answers only `{ ok: true, service: … }`. The diagnostic body is behind the
  secret.
- **`launchSecretFingerprint`** — the first 8 hex characters of a SHA-256 of `LAUNCH_SECRET`. It
  lets both sides confirm they share the same secret **without revealing it**, which is the one
  thing that cannot be checked any other way at switch-over: a mismatched secret makes every pass
  fail verification, and the symptom is indistinguishable from a dozen other faults.

The old route also reports `PUBLIC_BASE_URL`, which is exactly the `APP_URL` added here.

## The order of switch-over, which matters

From C2-2 v1.1 §5. **The sims refuse redirects on the roster call**, so doing this in another order
breaks the roster rather than merely delaying it.

1. **`https://learn.flexee.org` goes live** and answers `/api/health` with no redirect.
2. **Every sim's `PLATFORM_URL` is set to exactly `https://learn.flexee.org`** and redeployed,
   RapidSim 01 first.
3. **Only then** do `/session.html`, `/faculty.html` and `/open.html` on `rapidsims.flexee.org`
   start redirecting here.

The failure the order prevents: each sim's `PLATFORM_URL` **defaults to
`https://rapidsims.flexee.org`**, and the roster is called with `redirect: 'error'` and a
four-second timeout. A sim still pointing at the old domain after step 3 meets a redirect on
`/api/session-enrolments`, the call ends, and its console shows the roster as unavailable while live
play continues. Nothing crashes, which is why it would be easy to miss.

Addendum B §4 settles the matching cookie question: those three paths **redirect (302)** rather than
rewrite, keeping the query string, and `Domain=.flexee.org` is **not** set on the session cookie.
One origin, one cookie. `fx_session` is host-only (`httpOnly`, `sameSite: lax`, no `Domain`), so a
rewrite would have given `rapidsims.flexee.org` its own separate cookie and a student signed in on
the Wrapper would have arrived signed out.

## The migrations, and what they do live

Both run from Vercel's build command (`npm run db:auto-init && npm run build`) **before `next
build`, and therefore before the new code serves a request**. `auto-init.ts` exits unless
`VERCEL_ENV === "production"`, so preview deployments never migrate.

| | What it does on deploy |
|---|---|
| **0025** | Three nullable columns, one foreign key and one index on `enrolments`; then one `UPDATE` setting `released_at` and `released_note` on **every existing enrolment row**. Additive: nothing dropped, narrowed or made `NOT NULL`. |
| **0026** | One `NOT NULL DEFAULT false` column on `sections`. Postgres records the default in the catalogue rather than rewriting the table, so no row is read or written. |

**A correction to either must be a new migration, never an edit.** 0025 says so in capitals, and the
reason is not discoverable from the SQL: drizzle records each migration's hash but selects what to
apply by comparing the journal's `when` against the newest row in `__drizzle_migrations`
(`drizzle-orm/pg-core/dialect.js`), and **never compares that hash again**. Editing an applied
migration is not detected, not re-run and not reported — the edit silently never happens, and the
database keeps whatever the first version did.

**There is no "halfway".** The migrator wraps the whole batch of pending migrations in one
transaction, not one each, and Postgres handles DDL transactionally. If 0026 failed, 0025 would roll
back with it, `__drizzle_migrations` would record neither, the build would fail and the old
deployment would keep serving. The fix is to correct the SQL and redeploy.

**Why the backfill is dated to `created_at` and not `now()`.** Every row that exists when 0025 runs
was created when any enrolled student could launch any simulation in their class, so
`released_at = created_at` is the literal truth; `now()` would claim an act nobody performed today.
`created_at` is `NOT NULL` (`0000_init.sql`) and has never been altered, so no row can be skipped by
a null and no `COALESCE` is needed. `released_by` stays null because no person did it, and the note
says so — otherwise a null `released_by` on a released row cannot be told from the other way it
happens, since `released_by` is `ON DELETE SET NULL` and a real release by a since-deleted account
also leaves it null.

**The backfill was untested until it was written down as untestable.** Every suite applies
`drizzle/*.sql` to a fresh PGlite database, so a syntax error fails all fifty-eight — but the table
is empty when the migration runs, so the `UPDATE` was a no-op in tests. `test:access-release` now
reads the shipped statement out of the file and runs it against rows with distinct creation dates.
Sabotaged to `now()`, the check fails. Four more checks around it: that the file drops nothing,
alters no column and holds exactly one data write; that the `WHERE` guard makes it idempotent, so a
later hand-run cannot overwrite a real release date, releaser or note; and that the journal lists it
once, after 0024, with a strictly increasing timestamp — because an out-of-order entry means the
file silently never runs at all.

**The push order.** A migration ships in an earlier push than its first reader. 0025 went up alone
and inert; the gate and the controls followed; 0026 went up with them, and the join-code switch that
reads it followed after. Belt and braces given the build order, but it removes the only window in
which `42703 column "released_at" does not exist` is possible — an error this codebase has met
before, which is why `src/lib/auth.ts` carries a handler for exactly that code.

## My own mistakes, since several were silent passes

- **Three wrong claims in the Part B report**, corrected above: five `Host`-header call sites rather
  than two; `sections.join_code` described as consumed nowhere when a live student form redeems it;
  and `participantId` offered as `flexee:` when the sims build `platform:` themselves.
- **A tautology.** `assert.ok(r.ok || true)` in the `/open` cross-check cannot fail. It now reads the
  class out of the pass the page produced and re-checks the launch against that.
- **A mislabelled accessibility route.** A `/session (waiting)` entry that, with no `course` in the
  query, actually rendered *not-in-class* — claiming coverage of a state it never reached.
- **A check that matched its own prose.** The `trailingSlash` guard searched the config for the word
  and found the comment explaining the setting.
- **A wrong assertion about the instructor's release.** I asserted the instructor's row was
  unreleased; it is not, because 0025's backfill has no role filter — correctly, since nothing reads
  an instructor's release. The check now clears the row itself and re-tries the launch.
- **A test stub that made a whole class of page untestable.** `next-navigation.mjs`'s `redirect()`
  threw a bare "not available in tests", so a page whose entire behaviour is a redirect could not be
  tested. It now throws the way Next does, carrying the destination on `digest`.

## What the tests do not judge

- **Nothing was run against the live database.** `scripts/test-support/hooks.mjs` short-circuits
  `@/db` to an in-memory PGlite instance, so no suite can reach `DATABASE_URL`; the only places that
  name it are fixtures asserting on the string.
- **No sim was called.** Every roster, session and open check runs against the Wrapper's own code
  with passes the Wrapper minted. What is real is RapidSim 01's **own** `verifyLaunch` in
  `test:sims`, which needs `RAPIDSIMS_REPO` pointed at a checkout of `OneSmarterInc/Disaster_New`
  (its default `/tmp/rs` does not exist on Windows; on this machine it is
  `D:/Code/Wrapper/Disaster_New`).
- **Whether `rapidsims.flexee.org` and `learn.flexee.org` behave as required is a deployment
  property, not a code one.** No test can prove the roster is answered without a redirect, that the
  rewrite-only domain redirects the three paths, or that `PLATFORM_URL` was repointed first. C2-2
  §6's four-step test against a test deployment is the thing that settles it.
- **The waiting page's polling is checked by reading the component**, not by running a clock for ten
  minutes. What is asserted is the interval, the stop, the button, and that it contains no `fetch`
  and no launch call — so it cannot become a second place where access is decided.
