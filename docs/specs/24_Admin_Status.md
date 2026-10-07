# Spec 24 — An admin status page, the runner's token expiry, and a Reply-To address

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 7 October 2026 · Save as `docs/specs/24_Admin_Status.md` (first commit).
Covers backlog items W33 and W35.

## Why

On 6 October the GitHub token the Library uses to start the intake stopped working, and nothing warned anyone before a
Books upload failed with a 401. The same could happen to the email key, the storage token or the database. Before real
students arrive, an administrator should be able to see at a glance whether the pieces the Wrapper depends on are
working, and be warned **before** a token expires. Separately, invitation emails will be sent from the Flexee sending
domain, but replies should reach `support@osiwrapper.com`.

## Before writing any code

1. Read the Library page and the code that starts the intake (the dispatch to GitHub), how it reads its settings, and the mail
   adapter. Report which settings each check needs.
2. **Report what each check can truthfully verify.** For the GitHub token in particular: GitHub documents a response header
   that carries a fine-grained token's expiry (`github-authentication-token-expiration`). Confirm it from GitHub's
   documentation, say what a classic token or a missing header looks like, and say what a read-only call can and can't prove,
   since starting a workflow can't be tested without starting one.
3. Propose the plan and any open questions. **Wait for my go before building.**

## What to build

### 1. An admin status page (`/admin/status`)

Admins only, linked from the Administration workspace. One line per dependency, each with a plain-words state: **OK,
Needs attention, Down, Not configured, or Unknown**. State is never carried by colour alone.

| Line | What it checks | Notes |
|---|---|---|
| **Database** | a trivial query succeeds, and how long it took | |
| **File storage** | the content store answers a small list request | |
| **Intake runner** | the GitHub token and repository settings work, and **when the token expires** | see below |
| **Email** | whether a sending key is set, and whether Resend answers | "Not configured" is a valid state |
| **AI assistant** | switched on or off globally, and whether a provider key is set | never a call to the provider |
| **Scheduled job** | whether `CRON_SECRET` is set | never shows the value |

- Each check **runs on its own with a short timeout** (about five seconds) so one failure never breaks the page. Results are
  **cached for about ten minutes**, with a **Check now** button.
- **No secret value is ever shown, logged or put in an error**, only whether it is set.

### 2. The intake runner line

- Call GitHub's API with the stored token (a read of the repository and of the intake workflow) and show: connected or not,
  and the **token's expiry date** read from the response header when GitHub sends it.
- Distinguish the causes in plain words: **401** (the token expired or was revoked), **403** (the token lacks permission),
  **404** (the repository or workflow name is wrong), **5xx** (GitHub is briefly unavailable). Use the same wording as the
  upload failure messages.
- **A warning 14 days before expiry,** and again when it has expired, on the status page **and** as a banner on the Library
  page and the Administration dashboard.
- When no expiry is reported, say "expiry unknown" and don't pretend otherwise.

### 3. Reply-To

- An optional `MAIL_REPLY_TO` setting. When set, every outgoing message carries that Reply-To. When unset, nothing changes.

## Rules (tests must prove each)

1. The status page is admin-only. Faculty, students and signed-out visitors are refused.
2. Each check, driven by fakes, reports the right state for: success, a 401, a 403, a 404, a 5xx, a timeout, and "not
   configured". One failing check never prevents the others from showing.
3. The expiry date is read from the header when present, shown as a date, and a warning appears at 14 days or fewer and when
   expired. A missing header gives "expiry unknown".
4. With a token made of a unique string, that string appears nowhere: not in the page, the logs or any error.
5. The cache holds: repeated page loads cause one call per ten minutes per check, and **Check now** forces a fresh call.
6. The warning banner appears on the Library page and the Administration dashboard under the same conditions.
7. `MAIL_REPLY_TO` set adds the header to a message; unset adds none.
8. The page passes the automated accessibility check used in Spec 14, with states stated in words, and a keyboard-operable
   **Check now**.

## Process

As before: `docs/changes/24_Admin_Status.md`, including what each check proves and what it can't; no migration expected; every
suite passes; commits authored as me; **show me the summary and ask before pushing**; `git pull --rebase` first. Don't run
anything against the live database or send any real email.

## After it ships (not part of this build)

I open the status page on the live site, and set `MAIL_REPLY_TO` to `support@osiwrapper.com` when the Resend setup is done.

## Decisions (7 October 2026)

Settled after the two reports below.

### Report 1 — which settings each check needs

| Line | Settings | Read in |
|---|---|---|
| Database | `DATABASE_URL`, `DB_POOL_MAX` (default 10) | `db/index.ts` |
| File storage | `CONTENT_STORE` (`fs`\|`blob`\|`s3`), then `CONTENT_DIR`; `CONTENT_PREFIX` + `CONTENT_BLOB_ACCESS` + **`BLOB_READ_WRITE_TOKEN`**; `CONTENT_BUCKET` + `AWS_REGION` + AWS credentials. Plus `CONTENT_CACHE_SECONDS` | `lib/storage.ts` |
| Intake runner | `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `GITHUB_REF` (default `main`) | `lib/library.ts` |
| Email | `RESEND_API_KEY` **and** `MAIL_FROM` — both, or nothing sends | `lib/mail.ts` |
| AI assistant | `AI_ENABLED` (exactly `"true"`), `AI_PROVIDER`, then `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`/`AI_API_KEY`/`AI_BASE_URL` | `lib/ai/index.ts` |
| Scheduled job | `CRON_SECRET` | `api/cron/assistant-retention/route.ts` |

Three of those are not obvious:

- **`BLOB_READ_WRITE_TOKEN` never appears in the Wrapper's code.** `@vercel/blob` reads it itself, so
  a grep for `process.env` misses it. The storage line must not read "configured" from the variables
  the Wrapper names while the one that actually authenticates is absent.
- **Email needs two settings.** `mailConfigured()` wants `RESEND_API_KEY` *and* `MAIL_FROM`; a key
  with no from-address sends nothing.
- **`aiConfigured()` is asymmetric.** The OpenAI branch accepts
  `OPENAI_API_KEY || AI_API_KEY || AI_BASE_URL`; the Anthropic branch accepts only
  `ANTHROPIC_API_KEY`, although `anthropic.ts` also reads `ANTHROPIC_BASE_URL`.

### Report 2 — what each check can truthfully verify

**GitHub's expiry header is real**, confirmed from GitHub's own changelog of 26 July 2021: "When
using a personal access token with the GitHub API, you'll see a new response header,
`GitHub-Authentication-Token-Expiration`, indicating the token's expiration date." Four caveats:

1. **It is not ISO 8601, and the format varies.** Two forms are seen in the wild:
   `2023-01-31 23:00:00 UTC` and `2023-04-26 23:23:18 +0200` — a space where ISO wants `T`, and
   either a zone name or a numeric offset. `Date.parse` outside ISO 8601 is implementation-defined
   by the ECMAScript specification, so `new Date(header)` is unsafe and broke a real library
   (google/go-github#2649).
2. **A token may legitimately have no expiry.** GitHub's current documentation: "Infinite lifetimes
   are allowed but may be blocked by a maximum lifetime policy set by your organization or
   enterprise owner." So a missing header is not evidence of a classic token.
3. **The header has been observed to be wrong.** google/go-github#3708 reports GitHub returning the
   *current server time* instead of the real expiry for fine-grained tokens — a token due in
   November reporting as expiring today. A naive 14-day rule would then warn every day.
4. **The current docs pages do not mention the header at all.** Only the 2021 changelog documents
   it; it is not a versioned API guarantee.

**What a read-only call cannot prove.** The dispatch needs **`Actions: write`**.
`GET /repos/{owner}/{repo}` needs only `Metadata: read`, which every fine-grained token has, and
`GET .../actions/workflows/library-intake.yml` needs `Actions: read`. A token with Actions *read*
passes both reads and still fails the dispatch with 403. The check can prove the token is alive,
GitHub recognises it, the repository resolves and the workflow exists under that name — **not** that
the intake will start. The only test of that is starting one.

**Email has no innocent read probe.** The right key for this app is a Resend **sending-access** key,
and Resend documents that such a key cannot call any read endpoint: `401` with code
`restricted_api_key`, "This API key is restricted to only send emails." Resend documents
`missing_api_key` (401), `restricted_api_key` (401, and 403 "API key is not active") and
`suspended_api_key` (403) — but **no code for an invalid key**, so "wrong key" and "revoked key"
cannot be told apart by code name.

**The other four:**

| Line | Proves | Does not prove |
|---|---|---|
| Database | a round trip works, and its latency | nothing about pool exhaustion under load |
| File storage | the configured store answers a `listDirs("")` | that a *write* would work; and `CachedStore` can answer from memory, so an unbypassed check proves only that the cache is warm |
| AI assistant | both switches, from `aiAvailable()` | nothing about the provider — section 1 forbids a call, so a revoked key reads as configured |
| Scheduled job | `CRON_SECRET` is set | nothing about whether Vercel's cron is scheduled or has ever fired |

### The decisions

1. **Resend: a `401 restricted_api_key` is success**, worded "Resend answered and recognised the
   key; it can't be checked further because the key is send-only, which is the safer setup". No
   full-access key is asked for. Any other 401, any 403, and a timeout are **not working**.
2. **Suspect expiry: yes.** If the GitHub call succeeds the token is alive, so a past date — or one
   within a few minutes of now — shows as **"expiry unknown — GitHub reported a date that looks
   wrong"**. A genuinely expired token fails with a 401 and reads as expired or revoked. The
   header's formats are parsed explicitly, **never** with `new Date(header)`.
3. **The AI asymmetry stays.** Report what `aiAvailable()` says; describe the asymmetry in the
   change note rather than changing behaviour here.
4. **Storage bypasses the cache** and lists the store itself. A missing Blob token reads as **Down**.
5. **The cache is in-process.** Each instance keeps its own ten minutes.
6. **The banner is admin-only**, on the Library page and the Administration dashboard. Faculty see
   only the existing upload-failure message, if an upload actually fails.
7. **The page states in words** that the runner check cannot prove the intake will start, only that
   the token, the repository and the workflow resolve. **Email needs both** the key and the
   from-address.
