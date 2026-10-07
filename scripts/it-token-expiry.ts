// Integration test: Spec 24 §2 and rule 3 — GitHub's token-expiry header.
//
// Pure. Every string here is a format confirmed from GitHub's changelog or reported against a real
// client library, which is why the parser exists at all: `new Date(header)` is unsafe on these,
// and that is not a theory — it broke google/go-github on the two forms below.
import assert from "node:assert/strict";
import { parseExpiryHeader, readExpiry, expiryWords, expiryWarns, expiryDate,
         HEADER, WARN_DAYS, SUSPECT_WINDOW_MS } from "@/lib/status/token-expiry";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

t("the header's name is the one GitHub documents, lower-cased for fetch", () => {
  // fetch's Headers are case-insensitive, but the constant is what the code looks up, so it has to
  // be the documented spelling in the case fetch normalises to.
  assert.equal(HEADER, "github-authentication-token-expiration");
  assert.equal(HEADER, HEADER.toLowerCase());
});

t("both formats seen in the wild parse, and to the same instant", () => {
  // The two strings from google/go-github#2649, which a single hardcoded parser got wrong.
  assert.equal(iso(parseExpiryHeader("2023-01-31 23:00:00 UTC")), "2023-01-31T23:00:00.000Z");
  assert.equal(iso(parseExpiryHeader("2023-04-26 23:23:18 +0200")), "2023-04-26T21:23:18.000Z");
  // and the one from #3708
  assert.equal(iso(parseExpiryHeader("2025-09-05 17:55:53 +0500")), "2025-09-05T12:55:53.000Z");
});

t("the offset is applied in the right direction, which is the easy thing to get backwards", () => {
  // +0200 means the local clock is ahead of UTC, so the instant is two hours EARLIER in UTC.
  assert.equal(iso(parseExpiryHeader("2026-06-01 12:00:00 +0200")), "2026-06-01T10:00:00.000Z");
  assert.equal(iso(parseExpiryHeader("2026-06-01 12:00:00 -0500")), "2026-06-01T17:00:00.000Z");
  assert.equal(iso(parseExpiryHeader("2026-06-01 12:00:00 +05:30")), "2026-06-01T06:30:00.000Z");
  assert.equal(iso(parseExpiryHeader("2026-06-01 12:00:00 -00:30")), "2026-06-01T12:30:00.000Z");
});

t("the spellings of UTC all mean UTC, and a missing zone is read as UTC", () => {
  const want = "2026-06-01T12:00:00.000Z";
  for (const z of ["UTC", "utc", "Z", "z", "GMT", "gmt", ""]) {
    const raw = `2026-06-01 12:00:00${z ? " " + z : ""}`;
    assert.equal(iso(parseExpiryHeader(raw)), want, raw);
  }
  // and the ISO spelling, in case GitHub ever tidies it up
  assert.equal(iso(parseExpiryHeader("2026-06-01T12:00:00Z")), want);
  // seconds are optional
  assert.equal(iso(parseExpiryHeader("2026-06-01 12:00 UTC")), want);
});

t("the result does not depend on the machine's own timezone", () => {
  // A test that passed only on a UTC server and failed on a developer's laptop would be worse than
  // no test, so the parser builds from Date.UTC rather than from the Date constructor.
  const at = parseExpiryHeader("2026-06-01 12:00:00 UTC")!;
  assert.equal(at.getUTCFullYear(), 2026);
  assert.equal(at.getUTCMonth(), 5);
  assert.equal(at.getUTCDate(), 1);
  assert.equal(at.getUTCHours(), 12);
  assert.equal(at.getTime(), Date.UTC(2026, 5, 1, 12, 0, 0));
});

t("a string that is not one of those shapes is refused, not guessed at", () => {
  for (const bad of ["", "   ", "never", "2026", "2026-06", "2026-06-01",
                     "01/06/2026 12:00:00 UTC", "Mon, 01 Jun 2026 12:00:00 GMT",
                     "2026-06-01 12:00:00 EST", "2026-06-01 12:00:00 +2",
                     "2026-13-01 12:00:00 UTC", "2026-06-32 12:00:00 UTC",
                     "2026-06-01 25:00:00 UTC", "2026-06-01 12:60:00 UTC",
                     "expires 2026-06-01 12:00:00 UTC", "2026-06-01 12:00:00 UTC and more"]) {
    assert.equal(parseExpiryHeader(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseExpiryHeader(null), null);
  assert.equal(parseExpiryHeader(undefined), null);
  // A named zone other than UTC/GMT is refused rather than silently treated as UTC: reading EST as
  // UTC would be five hours wrong, which near a deadline is the difference between two answers.
  assert.equal(parseExpiryHeader("2026-06-01 12:00:00 EST"), null);
});

t("a date that does not exist is refused", () => {
  // Date.UTC rolls 31 February forward into March; a header that does not survive the round trip
  // was never a date.
  assert.equal(parseExpiryHeader("2026-02-31 12:00:00 UTC"), null);
  assert.equal(parseExpiryHeader("2027-02-29 12:00:00 UTC"), null);
  // and a real leap day is kept
  assert.equal(iso(parseExpiryHeader("2028-02-29 12:00:00 UTC")), "2028-02-29T12:00:00.000Z");
});

// ----------------------------------------------------------------------- what it is read to mean

const NOW = new Date("2026-10-07T12:00:00Z");
const inDays = (n: number) => {
  const d = new Date(NOW.getTime() + n * 86_400_000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
};

t("an absent header is unknown, and says GitHub sent none", () => {
  const e = readExpiry(null, NOW);
  assert.deepEqual(e, { kind: "unknown", why: "absent" });
  assert.equal(expiryWords(e), "Expiry unknown — GitHub sent no expiry for this token.");
  assert.equal(expiryWarns(e), false, "an absent expiry must not raise the banner");
  // A token may legitimately have no expiry — GitHub allows infinite lifetimes — so this is not a
  // fault and must not read as one.
  assert.deepEqual(readExpiry("", NOW), { kind: "unknown", why: "absent" });
});

t("an unreadable header is unknown, and says so differently", () => {
  const e = readExpiry("sometime next year", NOW);
  assert.deepEqual(e, { kind: "unknown", why: "unreadable" });
  assert.equal(expiryWords(e), "Expiry unknown — GitHub sent an expiry this could not read.");
  assert.equal(expiryWarns(e), false);
});

t("a date far ahead is known, with the days left and no warning", () => {
  const e = readExpiry(inDays(90), NOW);
  assert.equal(e.kind, "known");
  if (e.kind !== "known") return;
  assert.equal(e.daysLeft, 90);
  assert.equal(e.warn, false);
  assert.equal(expiryDate(e.at), "2027-01-05");
  assert.match(expiryWords(e), /^Expires on 2027-01-05, in 90 days\.$/);
});

t("the warning starts at fourteen days and not before", () => {
  assert.equal(WARN_DAYS, 14);
  const at15 = readExpiry(inDays(15), NOW);
  assert.equal(at15.kind === "known" && at15.warn, false, "15 days should not warn");
  const at14 = readExpiry(inDays(14), NOW);
  assert.equal(at14.kind === "known" && at14.warn, true, "14 days should warn");
  assert.equal(expiryWarns(at14), true);
  assert.match(expiryWords(at14), /Expires in 14 days, on 2026-10-21\./);
  const at1 = readExpiry(inDays(1), NOW);
  assert.match(expiryWords(at1), /Expires in 1 day, on 2026-10-08\./);
});

t("an expiry later today reads as today, and warns", () => {
  const e = readExpiry("2026-10-07 23:30:00 UTC", NOW);
  assert.equal(e.kind, "known");
  if (e.kind !== "known") return;
  assert.equal(e.daysLeft, 0);
  assert.equal(e.warn, true);
  assert.equal(expiryWords(e), "Expires today (2026-10-07).");
});

t("a past date, on a call that just succeeded, is the header being wrong", () => {
  // Decision 2. google/go-github#3708: GitHub has been seen to send its own clock here. A token
  // GitHub accepted a moment ago is alive, so this cannot be a real expiry — and a 14-day rule
  // that took it at face value would warn every single day and teach the reader to ignore it.
  for (const raw of [inDays(-1), inDays(-400), "2020-01-01 00:00:00 UTC"]) {
    const e = readExpiry(raw, NOW);
    assert.equal(e.kind, "suspect", raw);
    assert.equal(expiryWords(e), "Expiry unknown — GitHub reported a date that looks wrong.");
    assert.equal(expiryWarns(e), false, "a suspect date must not raise the expiry banner");
  }
});

t("a date within minutes of now is suspect too, which is the server-clock case exactly", () => {
  assert.equal(SUSPECT_WINDOW_MS, 5 * 60 * 1000);
  // The #3708 symptom: the header equals the moment of the call.
  assert.equal(readExpiry("2026-10-07 12:00:00 UTC", NOW).kind, "suspect");
  assert.equal(readExpiry("2026-10-07 12:04:00 UTC", NOW).kind, "suspect");
  // Just outside the window it is believed again, and warns because it is imminent.
  const e = readExpiry("2026-10-07 12:06:00 UTC", NOW);
  assert.equal(e.kind, "known");
  assert.equal(e.kind === "known" && e.warn, true);
});

t("every state produces a sentence, and none of them is empty or a stray value", () => {
  for (const raw of [null, "", "rubbish", inDays(-1), inDays(0.5), inDays(14), inDays(365)]) {
    const words = expiryWords(readExpiry(raw, NOW));
    assert.ok(words.length > 10, JSON.stringify(raw));
    assert.ok(words.endsWith(".") || words.endsWith(")."), words);
    assert.ok(!words.includes("undefined") && !words.includes("NaN") && !words.includes("Invalid"), words);
  }
});

console.log(`\n${passed} checks passed`);
