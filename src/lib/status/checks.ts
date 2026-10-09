import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { contentStore, CachedStore, isBookDir } from "@/lib/storage";
import { aiEnabled, aiConfigured, aiAvailable } from "@/lib/ai";
import { mailConfigured, replyTo } from "@/lib/mail";
import type { Check, Result } from "@/lib/status/framework";
import { readExpiry, expiryWords, expiryWarns, HEADER, type Expiry } from "@/lib/status/token-expiry";
import { configuredAppUrl } from "@/lib/app-url";

/**
 * Spec 24 §1: the six checks.
 *
 * Each one answers a question an administrator would otherwise have to ask a developer, and each
 * one says what it cannot answer. **No check ever reports a secret's value** — only whether it is
 * set — and no check puts a caught error's message into its result, because an exception's text is
 * written for a developer and can quote a connection string or a key back at us.
 *
 * `fetch` is injectable so the whole set can be driven by fakes (rule 2) without a network.
 */

type Fetch = typeof fetch;
let _fetch: Fetch = (...a) => fetch(...a);
export function setStatusFetch(f: Fetch | null) { _fetch = f ?? ((...a) => fetch(...a)); }

type Env = Record<string, string | undefined>;
const isSet = (v: string | undefined) => !!(v && v.trim());
const setWord = (v: string | undefined) => (isSet(v) ? "set" : "not set");

// ------------------------------------------------------------------------------------- database

export function databaseCheck(env: Env = process.env): Check {
  return {
    id: "database",
    name: "Database",
    async run(): Promise<Result> {
      if (!isSet(env.DATABASE_URL)) {
        return { state: "down", detail: "DATABASE_URL is not set, so nothing can be read or saved.",
                 facts: [{ label: "DATABASE_URL", text: "not set" }] };
      }
      const started = Date.now();
      // The cheapest round trip there is: no table, no plan, nothing to go stale.
      await db().execute(sql`SELECT 1`);
      const ms = Date.now() - started;
      return {
        state: ms > 2000 ? "attention" : "ok",
        detail: ms > 2000
          ? `The database answered, but took ${ms} ms, which is slow enough to notice.`
          : `The database answered in ${ms} ms.`,
        facts: [{ label: "Round trip", text: `${ms} ms` },
                { label: "Pool size", text: String(Number(env.DB_POOL_MAX || 10)) }],
        caveat: "A round trip proves the database is reachable now. It says nothing about how it behaves under a classful of students at once.",
      };
    },
  };
}

// --------------------------------------------------------------------------------- file storage

export function storageCheck(env: Env = process.env): Check {
  return {
    id: "storage",
    name: "File storage",
    async run(): Promise<Result> {
      const kind = (env.CONTENT_STORE || "fs").toLowerCase();
      // Decision 4: the Blob token is read by the Vercel client, not by the Wrapper, so it is
      // absent from every grep of this code. Without it a Blob store cannot answer at all.
      if (kind === "blob" && !isSet(env.BLOB_READ_WRITE_TOKEN)) {
        return {
          state: "down",
          detail: "The books are stored in Vercel Blob, but BLOB_READ_WRITE_TOKEN is not set, so the store cannot be read.",
          facts: [{ label: "Store", text: "blob" }, { label: "BLOB_READ_WRITE_TOKEN", text: "not set" }],
        };
      }
      if (kind === "s3" && !isSet(env.CONTENT_BUCKET)) {
        return { state: "down", detail: "The books are stored in S3, but CONTENT_BUCKET is not set.",
                 facts: [{ label: "Store", text: "s3" }, { label: "CONTENT_BUCKET", text: "not set" }] };
      }

      // Decision 4: list the store itself, not the cache in front of it. A cached answer would
      // prove only that the cache is warm — which is exactly the state a reader is trying to see
      // past when something has gone wrong.
      const store = contentStore();
      const direct = store instanceof CachedStore ? store.inner : store;
      const started = Date.now();
      const dirs = await direct.listDirs("");
      const ms = Date.now() - started;
      // Spec 28 commit 7: the intake writes archive/ beside the books once the content store is
      // a directory, and an archive counted as a book makes an empty store read as a healthy one.
      const books = dirs.filter(isBookDir);
      return {
        state: books.length ? "ok" : "attention",
        detail: books.length
          ? `The store answered in ${ms} ms with ${books.length} book folder${books.length === 1 ? "" : "s"}.`
          : `The store answered in ${ms} ms but holds no books yet.`,
        facts: [{ label: "Store", text: direct.kind },
                { label: "Books", text: String(books.length) },
                { label: "Read in", text: `${ms} ms` }],
        caveat: "This is a read. It does not prove an upload would succeed, which needs write access the Wrapper only uses during an intake.",
      };
    },
  };
}

// -------------------------------------------------------------------------------- intake runner

/** Spec §2: the same four causes the upload failure messages name, in the same words. */
export function runnerCause(status: number): string {
  if (status === 401) return "The token has expired or been revoked.";
  if (status === 403) return "The token does not have permission for this repository.";
  if (status === 404) return "The repository or the workflow name is wrong.";
  if (status >= 500 || status === 429) return "GitHub was briefly unavailable; try again.";
  return `GitHub answered ${status}.`;
}

export type RunnerDetail = { expiry: Expiry | null; warns: boolean };

/** Kept so the banner can ask the same question the page asks, without a second code path. */
export const runnerBannerNeeded = (r: Result) =>
  r.state === "down" || r.state === "attention";

export function runnerCheck(env: Env = process.env): Check {
  return {
    id: "runner",
    name: "Intake runner",
    async run(): Promise<Result> {
      const token = env.GITHUB_DISPATCH_TOKEN, repo = env.GITHUB_REPO;
      const settings = [
        { label: "GITHUB_DISPATCH_TOKEN", text: setWord(token) },
        { label: "GITHUB_REPO", text: repo || "not set" },
        { label: "GITHUB_REF", text: env.GITHUB_REF || "main (default)" },
      ];
      // §2, decision 7: said on every outcome, because it is what a reader would otherwise assume.
      const caveat =
        "This proves the token is alive, the repository resolves and the workflow exists under that " +
        "name. It cannot prove the intake will start: starting a workflow needs the Actions write " +
        "permission, and reading one does not, so only a real upload tests that.";

      if (!isSet(token) || !isSet(repo)) {
        return { state: "not-configured",
                 detail: "The intake runner is not set up, so a book upload cannot start its check.",
                 facts: settings, caveat };
      }

      const call = (path: string) => _fetch(`https://api.github.com/repos/${repo}${path}`, {
        // The token goes in a header and nowhere else: never the URL, never a message.
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      // The repository first — it needs only Metadata: read, which every fine-grained token has,
      // so a failure here is about the token or the name rather than about permissions.
      const repoRes = await call("");
      const expiry = readExpiry(repoRes.headers.get(HEADER));
      const expiryFact = { label: "Token expiry", text: expiryWords(expiry) };

      if (!repoRes.ok) {
        return {
          state: repoRes.status >= 500 || repoRes.status === 429 ? "attention" : "down",
          detail: runnerCause(repoRes.status),
          facts: [...settings, { label: "GitHub answered", text: String(repoRes.status) }],
          caveat,
        };
      }

      const wfRes = await call("/actions/workflows/library-intake.yml");
      if (!wfRes.ok) {
        return {
          state: wfRes.status >= 500 || wfRes.status === 429 ? "attention" : "down",
          detail: wfRes.status === 404
            ? "The token and repository work, but there is no workflow called library-intake.yml in them."
            : runnerCause(wfRes.status),
          facts: [...settings, expiryFact, { label: "GitHub answered", text: String(wfRes.status) }],
          caveat,
        };
      }

      const warn = expiryWarns(expiry);
      return {
        state: warn ? "attention" : "ok",
        detail: warn
          ? `Connected, but the token ${expiryWords(expiry).replace(/^Expires/, "expires").replace(/\.$/, "")}.`
          : "Connected: the token works, the repository resolves and the workflow is there.",
        facts: [...settings, expiryFact],
        caveat,
      };
    },
  };
}

// ----------------------------------------------------------------------------------------- email

/**
 * Decision 1: a Resend **sending-access** key cannot call any read endpoint — it answers 401 with
 * code `restricted_api_key`, "This API key is restricted to only send emails." That is the right
 * key for this application to hold, so that 401 is the success signal: it proves Resend answered
 * *and recognised the key*. Any other 401, any 403, and a timeout are not working.
 *
 * Resend documents no code for an invalid key, so "wrong key" and "revoked key" cannot be told
 * apart by name; both read as "Resend refused the key".
 */
export const SEND_ONLY_WORDS =
  "Resend answered and recognised the key; it can't be checked further because the key is send-only, which is the safer setup.";

export function emailCheck(env: Env = process.env): Check {
  return {
    id: "email",
    name: "Email",
    async run(): Promise<Result> {
      const key = env.RESEND_API_KEY, from = env.MAIL_FROM;
      const facts = [
        { label: "RESEND_API_KEY", text: setWord(key) },
        { label: "MAIL_FROM", text: from || "not set" },
        { label: "MAIL_REPLY_TO", text: replyTo(env).join(", ") || "not set" },
      ];
      // Decision 7: both, or nothing sends. mailConfigured() wants the same two.
      if (!isSet(key) || !isSet(from)) {
        return {
          state: "not-configured",
          detail: !isSet(key) && !isSet(from)
            ? "No sending key and no from-address, so no email is sent. Invitation links can still be downloaded as a file."
            : !isSet(key)
              ? "A from-address is set but no sending key, so no email is sent."
              : "A sending key is set but no from-address, so no email is sent.",
          facts,
          caveat: "Email needs both the key and the from-address. With either missing nothing is sent, and the Wrapper says so rather than failing silently.",
        };
      }

      const res = await _fetch("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${key}` },
      });
      const body = await res.json().catch(() => null) as { name?: unknown } | null;
      const code = typeof body?.name === "string" ? body.name : "";

      if (res.ok) {
        return { state: "ok", detail: "Resend answered and the key has full access.", facts,
                 caveat: "Resend answering is not a sent message. Only a real send proves the domain is verified and the address accepted." };
      }
      if (res.status === 401 && code === "restricted_api_key") {
        return { state: "ok", detail: SEND_ONLY_WORDS, facts,
                 caveat: "Resend answering is not a sent message. Only a real send proves the domain is verified and the address accepted." };
      }
      return {
        state: "down",
        detail: res.status === 403
          ? "Resend refused the key: it is not active, or it is suspended."
          : res.status === 401
            ? "Resend refused the key. It may be wrong or revoked — Resend does not distinguish the two."
            : `Resend answered ${res.status}.`,
        facts: [...facts, { label: "Resend answered", text: String(res.status) }],
      };
    },
  };
}

// ---------------------------------------------------------------------------------- ai assistant

/**
 * §1: never a call to the provider. So this reports the two switches and nothing more, which means
 * a revoked key reads as "configured" — said in the caveat rather than left to be discovered.
 *
 * Decision 3: `aiConfigured()` is reported as it stands. Its Anthropic branch accepts only
 * `ANTHROPIC_API_KEY` while its OpenAI branch also accepts a base URL, so an Anthropic-flavoured
 * self-hosted setup reads as not configured. That asymmetry is described in the change note rather
 * than changed here.
 */
export function assistantCheck(env: Env = process.env): Check {
  return {
    id: "assistant",
    name: "AI assistant",
    async run(): Promise<Result> {
      const on = aiEnabled(env);
      const keyed = aiConfigured(env);
      const provider = (env.AI_PROVIDER || "anthropic").toLowerCase();
      const facts = [
        { label: "AI_ENABLED", text: on ? "true" : (env.AI_ENABLED || "not set") },
        { label: "Provider", text: provider },
        { label: "Key", text: keyed ? "set" : "not set" },
      ];
      const caveat = "Nothing is sent to the provider by this check, so a key that has been revoked still reads as set. Each class also has its own switch.";

      if (!on && !keyed) {
        return { state: "not-configured", detail: "The assistant is switched off globally and no provider key is set. No student sees it.", facts, caveat };
      }
      if (!on) {
        return { state: "not-configured", detail: "A provider key is set, but the assistant is switched off globally, so no student sees it.", facts, caveat };
      }
      if (!keyed) {
        return { state: "attention", detail: "The assistant is switched on but no provider key is set, so a question would fail.", facts, caveat };
      }
      return { state: aiAvailable(env) ? "ok" : "attention",
               detail: "The assistant is switched on and a provider key is set.", facts, caveat };
    },
  };
}

// --------------------------------------------------------------------------------- scheduled job

export function cronCheck(env: Env = process.env): Check {
  return {
    id: "cron",
    name: "Scheduled job",
    async run(): Promise<Result> {
      const set = isSet(env.CRON_SECRET);
      return {
        state: set ? "ok" : "not-configured",
        detail: set
          ? "CRON_SECRET is set, so the daily clean-up of assistant conversations can authenticate."
          : "CRON_SECRET is not set, so the daily clean-up of assistant conversations would be refused.",
        // Whether it is set, never what it is.
        facts: [{ label: "CRON_SECRET", text: setWord(env.CRON_SECRET) }],
        caveat: "This only reads the setting. It does not prove the schedule exists in Vercel, or that the job has ever run.",
      };
    },
  };
}

// ------------------------------------------------------- the site's own address (Spec 27 commit 2)

/**
 * What address this site builds its links from.
 *
 * It reads a setting and nothing else, which is why it is honest about what it cannot see: the
 * check runs from the ten-minute cache with no request in hand, so it cannot know which host a
 * visitor actually arrived on. The status page prints that comparison itself, outside the cache,
 * because caching a request-specific answer would make two hosts share one result.
 *
 * Unset is "not configured" rather than "down": the Host-header fallback works, and it is what
 * every deployment did before this existed. What it costs is in the detail line.
 */
function addressCheck(env: Env = process.env): Check {
  return {
    id: "address",
    name: "Site address",
    async run(): Promise<Result> {
      const set = configuredAppUrl(env);
      const raw = (env.APP_URL ?? "").trim();
      if (set) {
        return {
          state: "ok",
          detail: `Links in email are built from ${set}.`,
          // The address is not a secret: it is in every link the site sends.
          facts: [{ label: "APP_URL", text: set },
                  ...(set === raw ? [] : [{ label: "As written", text: raw }])],
          caveat: "This does not prove the address resolves to this deployment, or that a visitor arrived on it.",
        };
      }
      return {
        state: raw ? "attention" : "not-configured",
        detail: raw
          ? "APP_URL is set but unusable, so links fall back to whichever address the visitor is on."
          : "APP_URL is not set, so links are built from each request's own address. On a preview deployment they point at the preview.",
        facts: [{ label: "APP_URL", text: raw ? "set, but not a usable address" : "not set" }],
        caveat: "This does not prove the address resolves to this deployment, or that a visitor arrived on it.",
      };
    },
  };
}

// --------------------------------------------------------------------------------------- all seven

export function allChecks(env: Env = process.env): Check[] {
  return [
    databaseCheck(env), storageCheck(env), runnerCheck(env),
    emailCheck(env), assistantCheck(env), cronCheck(env), addressCheck(env),
  ];
}

// --------------------------------------------------------------- the banner (§2, decision 6)

/**
 * The runner warning an administrator sees on the Library page and the Administration dashboard.
 *
 * It asks the same question the status page asks, through the same cache, so the banner and the
 * page can never disagree — and so visiting a page does not cost a second set of calls. Null when
 * there is nothing to say, which includes every state a reader cannot act on: an expiry GitHub
 * reported wrongly raises nothing.
 */
export async function runnerWarning(
  isAdmin: boolean,
): Promise<{ kind: "down" | "expiring"; detail: string } | null> {
  // Decision 6: faculty see only the upload failure message, if an upload actually fails.
  if (!isAdmin) return null;
  const { statusCache } = await import("@/lib/status/framework");
  let r;
  try {
    const snap = await statusCache.get([runnerCheck()]);
    r = snap.results.runner;
  } catch {
    return null;                 // a banner must never be the reason a page fails to render
  }
  if (!r) return null;
  if (r.state === "down") return { kind: "down", detail: r.detail };
  if (r.state === "attention") return { kind: "expiring", detail: r.detail };
  return null;
}
