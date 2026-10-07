/**
 * Spec 24 §2: reading GitHub's token-expiry header.
 *
 * GitHub's changelog of 26 July 2021 introduced it: "When using a personal access token with the
 * GitHub API, you'll see a new response header, `GitHub-Authentication-Token-Expiration`,
 * indicating the token's expiration date."
 *
 * Four things make this harder than it reads, all confirmed before writing any of it:
 *
 *  1. **It is not ISO 8601, and the format varies.** Two forms appear in the wild:
 *     `2023-01-31 23:00:00 UTC` and `2023-04-26 23:23:18 +0200` — a space where ISO wants `T`, and
 *     either a zone *name* or a numeric offset. `Date.parse` on anything outside ISO 8601 is
 *     implementation-defined by the ECMAScript specification, so `new Date(header)` is not safe
 *     here; it broke google/go-github (#2649) on exactly these two strings. The header is taken
 *     apart explicitly below and never handed to the Date constructor as a whole.
 *  2. **A token may legitimately have no expiry.** GitHub: "Infinite lifetimes are allowed but may
 *     be blocked by a maximum lifetime policy set by your organization or enterprise owner." So a
 *     missing header is not evidence of a classic token, and the only honest answer is "unknown".
 *  3. **The header has been observed to be wrong.** google/go-github#3708 reports GitHub returning
 *     the *server's current time* instead of the real expiry for fine-grained tokens. A naive
 *     14-day rule would then warn every single day and teach the reader to ignore it.
 *  4. **No current documentation page mentions it** — only the changelog. It is not a versioned API
 *     guarantee, which is another reason not to build a hard failure on its absence.
 */

export const HEADER = "github-authentication-token-expiration";

/** Decision 2: a date this close to now cannot be a real expiry on a call that just succeeded. */
export const SUSPECT_WINDOW_MS = 5 * 60 * 1_000;
/** Spec §2: warn this far ahead. */
export const WARN_DAYS = 14;

export type Expiry =
  /** The header was absent, empty, or in a shape this does not recognise. */
  | { kind: "unknown"; why: "absent" | "unreadable" }
  /**
   * A date that cannot be true of a token that just authenticated a successful call — in the past,
   * or within minutes of now. GitHub has been seen to send its own clock here.
   */
  | { kind: "suspect"; at: Date }
  | { kind: "known"; at: Date; daysLeft: number; warn: boolean };

/**
 * `YYYY-MM-DD HH:MM:SS <zone>`, where zone is `UTC`, a named zone, `Z`, or `+HHMM` / `-HH:MM`.
 * Anchored, so a string that merely contains a date does not match.
 */
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i;

/**
 * The header's value as an instant, or null when it cannot be read.
 *
 * Built with `Date.UTC` from the captured digits, so the result does not depend on the server's own
 * timezone — a Vercel instance is UTC but a developer's laptop is not, and a test that passed only
 * in one of those places would be worse than no test.
 */
export function parseExpiryHeader(raw: string | null | undefined): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = SHAPE.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, zone] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(se ?? "0");
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;

  let offsetMinutes = 0;
  const z = (zone ?? "UTC").toUpperCase();
  if (z !== "Z" && z !== "UTC" && z !== "GMT") {
    const om = /^([+-])(\d{2}):?(\d{2})$/.exec(z);
    if (!om) return null;                       // a named zone other than UTC/GMT is not guessed at
    const mins = Number(om[2]) * 60 + Number(om[3]);
    if (Number(om[3]) > 59) return null;
    offsetMinutes = om[1] === "+" ? mins : -mins;
  }

  const ms = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  if (!Number.isFinite(ms)) return null;
  const at = new Date(ms);
  // Date.UTC rolls 2026-02-31 forward into March; a header that does not survive the round trip
  // was not a real date.
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    // Only reject when the offset did not legitimately move the day.
    const naive = new Date(Date.UTC(year, month - 1, day));
    if (naive.getUTCMonth() !== month - 1 || naive.getUTCDate() !== day) return null;
  }
  return at;
}

/**
 * What to say about the token's expiry, given the header from a call that **succeeded**.
 *
 * That the call succeeded is the premise the suspect rule rests on: a token GitHub accepted a
 * moment ago is alive, so a header claiming it expired yesterday is the header being wrong, not
 * the token being dead. A genuinely expired token does not get here — it fails with a 401.
 */
export function readExpiry(raw: string | null | undefined, now: Date = new Date()): Expiry {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "unknown", why: "absent" };
  const at = parseExpiryHeader(s);
  if (!at) return { kind: "unknown", why: "unreadable" };

  const leftMs = at.getTime() - now.getTime();
  if (leftMs < SUSPECT_WINDOW_MS) return { kind: "suspect", at };

  const daysLeft = Math.floor(leftMs / 86_400_000);
  return { kind: "known", at, daysLeft, warn: daysLeft <= WARN_DAYS };
}

/** The date as the page writes it: a plain calendar day, UTC, never a locale-dependent string. */
export function expiryDate(at: Date) {
  return at.toISOString().slice(0, 10);
}

/** One sentence about the expiry, for the status line and the banner. */
export function expiryWords(e: Expiry): string {
  switch (e.kind) {
    case "unknown":
      return e.why === "absent"
        ? "Expiry unknown — GitHub sent no expiry for this token."
        : "Expiry unknown — GitHub sent an expiry this could not read.";
    case "suspect":
      return "Expiry unknown — GitHub reported a date that looks wrong.";
    case "known":
      if (e.daysLeft === 0) return `Expires today (${expiryDate(e.at)}).`;
      return e.daysLeft <= WARN_DAYS
        ? `Expires in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}, on ${expiryDate(e.at)}.`
        : `Expires on ${expiryDate(e.at)}, in ${e.daysLeft} days.`;
  }
}

/** Whether this expiry should raise the banner (§2). */
export const expiryWarns = (e: Expiry) => e.kind === "known" && e.warn;
