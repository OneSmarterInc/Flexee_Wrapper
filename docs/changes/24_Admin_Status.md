# 24 — An admin status page, the runner's token expiry, and a Reply-To address

Backlog items W33 and W35. The spec and the decisions behind it are in
[`docs/specs/24_Admin_Status.md`](../specs/24_Admin_Status.md).

On 6 October the GitHub token the Library uses to start the intake stopped working, and nothing
warned anyone before a Books upload failed with a 401. An administrator can now see at a glance
whether the pieces the Wrapper depends on are working, and is warned fourteen days before that
token expires. **No migration.**

## What each check proves, and what it does not

This table is the point of the page, so it is the first thing in this note. A line reading **OK** is
not a promise that everything downstream of it works, and the page says so on every line.

| Line | Proves | Does **not** prove |
|---|---|---|
| **Database** | a `SELECT 1` round trip works, and how long it took | anything about behaviour under a classful of students at once |
| **File storage** | the configured store answers a listing, **bypassing the cache** | that a *write* would succeed; the Wrapper only writes during an intake |
| **Intake runner** | the token is alive, GitHub recognises it, the repository resolves, `library-intake.yml` exists | **that an upload will start** — see below |
| **Email** | Resend answered and recognised the key; both settings are present | that a message would arrive: the domain may be unverified or the address refused |
| **AI assistant** | the global switch and whether a key is set | anything about the provider — no call is made, so a **revoked key still reads as set** |
| **Scheduled job** | `CRON_SECRET` is set | that the schedule exists in Vercel, or has ever fired |

### The runner line's limit, which is the important one

Starting a workflow needs GitHub's **`Actions: write`** permission.
`GET /repos/{owner}/{repo}` needs only `Metadata: read`, which every fine-grained token has, and
`GET …/actions/workflows/library-intake.yml` needs `Actions: read`.

**So a token with read access alone passes every check on this page and still fails an upload with a
403.** The only test of the dispatch is a dispatch. The page says this in words, on every runner
outcome rather than only on the failures, and it is repeated in the "what no check here can tell
you" section at the foot.

The four causes use the same wording as the upload failure messages Spec 22 wrote — 401 the token
has expired or been revoked, 403 no permission, 404 the repository or workflow name is wrong, 5xx
GitHub was briefly unavailable — so a reader does not meet two vocabularies for one event.

## The token's expiry

GitHub's `GitHub-Authentication-Token-Expiration` header is real, confirmed from GitHub's own
changelog of 26 July 2021: *"When using a personal access token with the GitHub API, you'll see a
new response header, `GitHub-Authentication-Token-Expiration`, indicating the token's expiration
date."* Reading it correctly took more care than it looks, and all four reasons were confirmed
before any code was written.

1. **It is not ISO 8601, and the format varies.** Two forms appear in the wild:
   `2023-01-31 23:00:00 UTC` and `2023-04-26 23:23:18 +0200` — a space where ISO wants `T`, and
   either a zone name or a numeric offset. `Date.parse` outside ISO 8601 is **implementation-defined
   by the ECMAScript specification**, so `new Date(header)` is not safe here; those exact two
   strings broke google/go-github (issue 2649). The header is taken apart explicitly and built with
   `Date.UTC`, so the answer does not depend on the server's own timezone.

   A sabotage adding `new Date(s)` as a fast path fails the suite on a **zoneless** header, which it
   reads as *local* time rather than UTC — a bug that would be invisible on a UTC server and wrong
   on a developer's laptop.

2. **A token may legitimately have no expiry.** GitHub: *"Infinite lifetimes are allowed but may be
   blocked by a maximum lifetime policy set by your organization or enterprise owner."* A missing
   header is therefore not evidence of a classic token, and the only honest reading is **"expiry
   unknown — GitHub sent no expiry for this token"**.

3. **The header has been observed to be wrong.** google/go-github issue 3708 reports GitHub
   returning its **own current time** instead of the real expiry — a token due in November reporting
   as expiring that day. Taken at face value, a 14-day rule would warn *every day* and teach the
   reader to ignore the warning.

   So (decision 2): if the call succeeded the token is alive, and an expiry in the past, or within
   five minutes of now, reads as **"expiry unknown — GitHub reported a date that looks wrong"** and
   raises no banner. A genuinely expired token never reaches that code — it fails with a 401 and
   reads as expired or revoked.

4. **No current documentation page mentions the header**, only the changelog. It is not a versioned
   API guarantee, which is a further reason not to build a hard failure on its absence.

**The warning** appears at 14 days or fewer and when expired, on the status page and as a banner on
the Library page and the Administration dashboard.

## Email, and why a 401 is good news

The right key for this application is a Resend **sending-access** key, and Resend documents that
such a key **cannot call any read endpoint**: it answers `401` with code `restricted_api_key`,
*"This API key is restricted to only send emails."*

So that 401 is the **success** signal (decision 1). It proves Resend answered *and recognised the
key*, and the line says why that is the safer setup rather than a fault:

> Resend answered and recognised the key; it can't be checked further because the key is send-only,
> which is the safer setup.

No full-access key is asked for. Any other 401, any 403 and a timeout are **Down**. One honest gap:
Resend documents `missing_api_key`, `restricted_api_key` and `suspended_api_key` but **no code for
an invalid key**, so a wrong key and a revoked one cannot be told apart, and the wording says so.

**Email needs both** `RESEND_API_KEY` and `MAIL_FROM`. With either missing nothing is sent, and the
line names which is absent and reminds you invitation links can still be downloaded as a file.

## Two settings worth knowing about

**`BLOB_READ_WRITE_TOKEN` appears nowhere in the Wrapper's own code.** The Vercel Blob client reads
it directly, so a status check built from the variables this repository mentions would have reported
"configured" while the one that actually authenticates was missing. A Blob store without it reads as
**Down**, before anything is called.

**`aiConfigured()` is asymmetric**, and this build reports it as it stands (decision 3). Its OpenAI
branch accepts `OPENAI_API_KEY || AI_API_KEY || AI_BASE_URL`; its Anthropic branch accepts only
`ANTHROPIC_API_KEY`, although `anthropic.ts` also reads `ANTHROPIC_BASE_URL`. **So an
Anthropic-flavoured self-hosted setup would read as "not configured" on this page even though it
works.** Nobody is running one today; if that changes, the fix is in `src/lib/ai/index.ts` and not
on the status page.

## The frame the checks run in

- **Each check runs on its own, with a five-second limit.** A throw, a rejection and a promise that
  never settles all become a result, so **one failure never hides the others** — proved with a check
  that throws beside one that works.
- **Failing and hanging say different things.** The first version collapsed both into "No answer
  within 5 seconds", so a check that failed in 0 ms sent a reader hunting a network problem that was
  not there. Found by a sabotage that was *supposed* to bite and didn't.
- **No secret is carried.** A result holds a state, a sentence and label-and-text facts; there is no
  field for a value. Every check reports "set" or "not set", never the thing itself.
- **No caught error's message reaches a result.** An exception's text is written for a developer and
  can quote a connection string or a key back at us.
- **Results are cached for ten minutes, in process.** Each serverless instance keeps its own, so two
  loads a moment apart can land on two instances and show different times (decision 5). That is a
  known property, not a bug — the alternative is a migration for a page opened occasionally.
  **Check now** ignores the cache entirely.

## The banner

Admin-only, on the Library page and the Administration dashboard (decision 6). The Library page is
open to **any instructor**, and faculty are deliberately not shown it: it names an infrastructure
problem they cannot fix, and if an upload does fail they already get Spec 22's message, which tells
them what to do.

It appears for exactly two conditions — the runner is **Down**, or its token expires within the
fortnight. A suspect date raises nothing. It asks the same question the page asks, through the same
cache, so the two can never disagree, and it **can never be the reason a page fails to render**: the
check is caught and the Library page comes up regardless.

## Reply-To

`MAIL_REPLY_TO`, optional. Set, every outgoing message carries `reply_to` (Resend's field name,
taking a string or an array, so a comma-separated setting becomes two addresses). Unset, the request
body has **exactly the four keys it had before this existed**, which the suite pins — so this could
ship before the address was live.

An entry with no `@`, or with a space in it, is dropped rather than sent: a malformed Reply-To can
make a provider refuse the whole message, and losing an invitation is a worse outcome than losing
the reply address. So `Flexee Support <support@osiwrapper.com>` contributes nothing rather than
breaking a send — use the bare address.

## Tests

| Suite | Checks | What it holds |
|---|---|---|
| `test:token-expiry` | 15 | both wild formats, the offset's direction, a zoneless header as UTC, 31 February, the three readings |
| `test:status-checks` | 27 | every state of all six by fakes, isolation, the cache, and rule 4 over a whole snapshot |
| `test:status-page` | 8 | admin-only, states in words, no secret in the markup, axe, and the banner's conditions |
| `test:mail-reply-to` | 9 | set and unset, junk dropped, and the three rules the adapter already kept |

`test:a11y-pages` now renders **45** pages, `/admin/status` among them, with no finding at any
impact.

**Nine sabotages, each run and undone.** The ones worth naming: adding `new Date(s)` as a fast path
fails on a zoneless header; removing the suspect window fails the server-clock case; treating the
restricted-key 401 as a failure fails by name; the storage check reading the cache fails; dropping
the Blob-token guard fails; dropping the runner's caveat fails; and carrying a thrown error's
message into a result fails with "the message leaked".

**Rule 4 is proved over a whole snapshot**, with every secret a unique string and every console
channel captured — and the recorder is **proved to work first**, because an empty transcript looks
exactly like a broken capture.

### Four mistakes of mine, all caught by running it

- The framework reported a check that *threw* as "No answer within 5 seconds". Failing and hanging
  are different things and now say different sentences.
- The status page wrapped definition-list pairs in `<span>`, which is invalid inside a `<dl>`. axe
  reported `definition-list` and `dlitem`; they are `<div>` now.
- My own admin-only test never exercised the signed-out case, because the render helper set the
  session *after* the test had cleared it.
- My own "no state word names a colour" check matched the **red** inside "configu**red**", so "Not
  configured" failed it. Word boundaries now.

One guard was adjusted rather than a comment bent around it: Spec 21's bare-hex scan read
`go-github#3708` as a four-digit colour. It now ignores a hash following a word character, and the
two bracketed references are written without a hash — which reads better anyway. A sabotage confirms
it still catches a real literal.

### What the tests do not judge

- **A real GitHub or a real Resend.** Every outcome is driven by fakes. Whether GitHub actually
  sends the expiry header for the token this project holds — and whether it sends the right value —
  is something only the live page will say.
- **Whether the cache behaves as expected across instances.** The ten minutes are proved with an
  injected clock on one instance. Two instances are a property of the platform.
- **The page in a browser.** Colour contrast, visible focus and the real tab order are the opt-in
  browser run's business.

## After it ships

Open `/admin/status` on the live site — that is the first time the runner line meets a real token,
and the first chance to see whether GitHub sends an expiry for it. Set `MAIL_REPLY_TO` to
`support@osiwrapper.com` when the Resend setup is done; nothing else changes until you do.
