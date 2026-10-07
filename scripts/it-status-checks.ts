// Integration test: Spec 24 §1, rules 2, 4 and 5 — the check framework and the seven checks.
// The seventh, the site's own address, arrived with Spec 27 commit 2.
//
// Every check is driven by fakes, so success, a 401, a 403, a 404, a 5xx, a timeout and
// "not configured" are all exercised without a network. The two checks that carry the most weight
// are the isolation one — a check that throws beside one that works — and rule 4, where every
// secret is a unique string and the whole snapshot is searched for it.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setContentStore, CachedStore, type ContentStore } from "@/lib/storage";
import { setMailTransport } from "@/lib/mail";
import { runCheck, runAll, StatusCache, overall, agoWords, STATE_WORDS,
         TIMEOUT_MS, CACHE_MS, type Check, type Result, type State } from "@/lib/status/framework";
import { databaseCheck, storageCheck, runnerCheck, emailCheck, assistantCheck, cronCheck,
         allChecks, setStatusFetch, runnerCause, SEND_ONLY_WORDS } from "@/lib/status/checks";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

/** Unique strings, so rule 4 can search for them rather than for a plausible-looking secret. */
const SECRETS = {
  GITHUB_DISPATCH_TOKEN: "ghp_UNIQUE_RUNNER_TOKEN_aaa111",
  RESEND_API_KEY: "re_UNIQUE_SENDING_KEY_bbb222",
  ANTHROPIC_API_KEY: "sk-ant-UNIQUE_AI_KEY_ccc333",
  CRON_SECRET: "UNIQUE_CRON_SECRET_ddd444",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_UNIQUE_eee555",
  DATABASE_URL: "postgresql://user:UNIQUE_DB_PASSWORD_fff666@db.invalid/flexee",
};

const BASE = {
  ...SECRETS,
  GITHUB_REPO: "OneSmarterInc/Flexee_Wrapper",
  MAIL_FROM: "no-reply@flexee.invalid",
  AI_ENABLED: "true",
  CONTENT_STORE: "fs",
  // Not a secret: it is in every link the site sends, which is why the line prints it in full.
  APP_URL: "https://learn.flexee.invalid",
} as Record<string, string | undefined>;

/** A fake GitHub or Resend: answers with the status given, and records the calls. */
function answering(entries: { status: number; headers?: Record<string, string>; body?: unknown }[]) {
  const calls: { url: string; auth: string | null }[] = [];
  let i = 0;
  setStatusFetch(async (url: any, init?: any) => {
    calls.push({ url: String(url), auth: (init?.headers?.Authorization ?? init?.headers?.authorization) ?? null });
    const e = entries[Math.min(i++, entries.length - 1)];
    return new Response(e.body == null ? null : JSON.stringify(e.body),
      { status: e.status, headers: e.headers });
  });
  return calls;
}
const ok2 = (headers?: Record<string, string>) =>
  [{ status: 200, headers, body: {} }, { status: 200, body: {} }];

// -------------------------------------------------------------------------------- the framework

await t("every state has a word, and none of them is a colour", () => {
  assert.deepEqual(Object.keys(STATE_WORDS).sort(),
    ["attention", "down", "not-configured", "ok", "unknown"]);
  for (const [, w] of Object.entries(STATE_WORDS)) {
    assert.ok(w.length > 1, w);
    // Word boundaries, or "Not configured" fails on the "red" inside "configured" — which is
    // exactly what the first version of this check did.
    assert.ok(!/(red|green|amber|yellow|orange)/i.test(w), `${w} names a colour`);
  }
  assert.equal(STATE_WORDS.ok, "OK");
  assert.equal(STATE_WORDS.attention, "Needs attention");
  assert.equal(STATE_WORDS["not-configured"], "Not configured");
});

await t("a check that throws becomes a result, and does not read as a timeout", async () => {
  const r = await runCheck({ id: "x", name: "X", run: async () => { throw new Error("boom") ; } });
  assert.equal(r.state, "down");
  assert.ok(typeof r.ms === "number");
  // An exception's text is written for a developer and can quote a connection string back at us.
  assert.ok(!r.detail.includes("boom"), `the message leaked: ${r.detail}`);
  // Failing and hanging are different things. The first version of this framework reported both as
  // "No answer within 5 seconds", which sends a reader looking for a network problem that is not
  // there — a check that threw in 0 ms did answer, it answered badly.
  assert.ok(!/No answer within/.test(r.detail), `a thrown error read as a timeout: ${r.detail}`);
  assert.match(r.detail, /could not be completed/);
  // and the same for a rejection rather than a throw
  const rej = await runCheck({ id: "y", name: "Y", run: () => Promise.reject(new Error("boom")) });
  assert.ok(!/No answer within/.test(rej.detail), rej.detail);
});

await t("a check that returns rubbish becomes Unknown rather than breaking the page", async () => {
  for (const bad of [null, undefined, "ok", 42, {}, { state: "fine" }]) {
    const r = await runCheck({ id: "x", name: "X", run: (async () => bad) as () => Promise<Result> });
    assert.equal(r.state, "unknown", JSON.stringify(bad));
    assert.ok(r.detail.length > 10);
  }
});

await t("a check that never returns times out, and says how long it waited", async () => {
  // The timeout is a parameter, so this proves the behaviour in twenty milliseconds rather than
  // spending five real seconds doing it. The production default is asserted separately.
  const never: Check = { id: "slow", name: "Slow", run: () => new Promise(() => {}) };
  const r = await runCheck(never, () => Date.now(), 20);
  assert.equal(r.state, "down", r.detail);
  assert.match(r.detail, /No answer within 20 ms/);
  assert.equal(TIMEOUT_MS, 5000, "the page's own timeout is the five seconds the spec asked for");
  assert.match((await runCheck(never, () => Date.now(), 5000)).detail, /No answer within 5 seconds/);
});

await t("one failing check never stops the others showing", async () => {
  // Rule 2's second half, which is the whole reason each check is isolated.
  const checks: Check[] = [
    { id: "good", name: "Good", run: async () => ({ state: "ok", detail: "fine" }) },
    { id: "throws", name: "Throws", run: async () => { throw new Error("nope"); } },
    { id: "rejects", name: "Rejects", run: () => Promise.reject(new Error("nope")) },
    { id: "also-good", name: "Also good", run: async () => ({ state: "ok", detail: "fine too" }) },
  ];
  const snap = await runAll(checks);
  assert.deepEqual(Object.keys(snap.results).sort(), ["also-good", "good", "rejects", "throws"]);
  assert.equal(snap.results.good.state, "ok");
  assert.equal(snap.results["also-good"].state, "ok");
  assert.equal(snap.results.throws.state, "down");
  assert.equal(snap.results.rejects.state, "down");
});

await t("the worst state present is the one summarised at the top", () => {
  const r = (state: State): Result => ({ state, detail: "x" });
  assert.equal(overall({ a: r("ok"), b: r("ok") }), "ok");
  assert.equal(overall({ a: r("ok"), b: r("not-configured") }), "not-configured");
  assert.equal(overall({ a: r("not-configured"), b: r("unknown") }), "unknown");
  assert.equal(overall({ a: r("unknown"), b: r("attention") }), "attention");
  assert.equal(overall({ a: r("attention"), b: r("down") }), "down");
  assert.equal(overall({}), "ok");
});

await t("the cache holds for ten minutes, and Check now forces a fresh call", async () => {
  // Rule 5. The clock is injected, so this is exact rather than approximately ten minutes.
  assert.equal(CACHE_MS, 600_000);
  let calls = 0;
  let clock = 1_000_000;
  const checks: Check[] = [{ id: "c", name: "C", run: async () => { calls++; return { state: "ok", detail: "fine" }; } }];
  const cache = new StatusCache(CACHE_MS, () => clock);

  const first = await cache.get(checks);
  assert.equal(calls, 1);
  assert.equal(first.cached, false, "the first snapshot is not from the cache");

  // Repeated loads inside the window: still one call.
  for (let i = 0; i < 5; i++) {
    const s = await cache.get(checks);
    assert.equal(s.cached, true);
  }
  assert.equal(calls, 1, `${calls} calls inside the window`);

  // Check now ignores the cache entirely.
  const forced = await cache.get(checks, { force: true });
  assert.equal(calls, 2);
  assert.equal(forced.cached, false);

  // Just inside, then just outside.
  clock += CACHE_MS - 1;
  await cache.get(checks);
  assert.equal(calls, 2, "it re-ran one millisecond early");
  clock += 2;
  await cache.get(checks);
  assert.equal(calls, 3, "it did not re-run after ten minutes");
});

await t("two readers arriving together share one run", async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const checks: Check[] = [{
    id: "c", name: "C",
    run: () => new Promise((res) => { calls++; release = () => res({ state: "ok", detail: "fine" }); }),
  }];
  const cache = new StatusCache();
  const a = cache.get(checks);
  const b = cache.get(checks);
  // Give the first run a tick to register before releasing it.
  await new Promise((r) => setTimeout(r, 5));
  release!();
  await Promise.all([a, b]);
  assert.equal(calls, 1, `${calls} runs for two simultaneous readers`);
});

await t("the age of the snapshot reads as words", () => {
  assert.equal(agoWords(null), "not yet");
  assert.equal(agoWords(0), "just now");
  assert.equal(agoWords(9_000), "just now");
  assert.equal(agoWords(30_000), "30 seconds ago");
  assert.equal(agoWords(59_000), "59 seconds ago");
  assert.equal(agoWords(60_000), "1 minute ago", "a minute should read as a minute, not as 60 seconds");
  assert.equal(agoWords(4 * 60_000), "4 minutes ago");
  assert.equal(agoWords(3 * 3_600_000), "3 hours ago");
});

// ------------------------------------------------------------------------------- database check

await t("the database check reports a round trip, and its absence", async () => {
  const r = await runCheck(databaseCheck(BASE));
  assert.equal(r.state, "ok", r.detail);
  assert.match(r.detail, /answered in \d+ ms/);
  assert.ok(r.facts?.some((f) => f.label === "Round trip"));
  assert.ok(r.caveat?.includes("under a classful"), r.caveat);

  const none = await runCheck(databaseCheck({ ...BASE, DATABASE_URL: undefined }));
  assert.equal(none.state, "down");
  assert.deepEqual(none.facts, [{ label: "DATABASE_URL", text: "not set" }]);
});

// -------------------------------------------------------------------------------- storage check

await t("the storage check lists the store itself, not the cache in front of it", async () => {
  // Decision 4. A cached answer proves only that the cache is warm, which is exactly the state a
  // reader is trying to see past when something has gone wrong.
  let innerCalls = 0;
  const inner: ContentStore = {
    kind: "blob",
    readText: async () => "",
    readBytes: async () => new Uint8Array(),
    listDirs: async () => { innerCalls++; return ["sad", "mis3000", "_staging"]; },
  };
  const cached = new CachedStore(inner, 600_000);
  await cached.listDirs("");                 // warm it
  assert.equal(innerCalls, 1);
  setContentStore(cached);
  try {
    const r = await runCheck(storageCheck({ ...BASE, CONTENT_STORE: "blob" }));
    assert.equal(r.state, "ok", r.detail);
    assert.equal(innerCalls, 2, "the check was answered from the cache");
    assert.match(r.detail, /2 book folders/, r.detail);   // _staging is not a book
    assert.ok(r.facts?.some((f) => f.label === "Store" && f.text === "blob"));
    assert.ok(r.caveat?.includes("does not prove an upload"), r.caveat);
  } finally { setContentStore(null); }
});

await t("a Blob store with no token reads as Down, before anything is called", async () => {
  // Decision 4. BLOB_READ_WRITE_TOKEN appears nowhere in the Wrapper's own code — the Vercel
  // client reads it — so a check built from the variables the Wrapper names would miss it.
  let called = false;
  setContentStore({
    kind: "blob", readText: async () => "", readBytes: async () => new Uint8Array(),
    listDirs: async () => { called = true; return []; },
  });
  try {
    const r = await runCheck(storageCheck({ ...BASE, CONTENT_STORE: "blob", BLOB_READ_WRITE_TOKEN: undefined }));
    assert.equal(r.state, "down");
    assert.match(r.detail, /BLOB_READ_WRITE_TOKEN is not set/);
    assert.equal(called, false, "it tried to list a store it knew could not answer");
  } finally { setContentStore(null); }
});

await t("a store that throws, or holds no books, is reported rather than crashing the page", async () => {
  setContentStore({
    kind: "s3", readText: async () => "", readBytes: async () => new Uint8Array(),
    listDirs: async () => { throw new Error("AccessDenied: arn:aws:s3:::secret-bucket"); },
  });
  try {
    const r = await runCheck(storageCheck({ ...BASE, CONTENT_STORE: "s3", CONTENT_BUCKET: "books" }));
    assert.equal(r.state, "down");
    assert.ok(!r.detail.includes("secret-bucket"), `the error leaked: ${r.detail}`);
  } finally { setContentStore(null); }

  setContentStore({ kind: "fs", readText: async () => "", readBytes: async () => new Uint8Array(), listDirs: async () => [] });
  try {
    const r = await runCheck(storageCheck(BASE));
    assert.equal(r.state, "attention");
    assert.match(r.detail, /holds no books yet/);
  } finally { setContentStore(null); }

  const noBucket = await runCheck(storageCheck({ ...BASE, CONTENT_STORE: "s3", CONTENT_BUCKET: undefined }));
  assert.equal(noBucket.state, "down");
  assert.match(noBucket.detail, /CONTENT_BUCKET is not set/);
});

// --------------------------------------------------------------------------------- runner check

await t("the runner check says what it cannot prove, on every outcome", async () => {
  // Decision 7: the caveat is the point of the line, so it is present whatever the state.
  const cases: [string, { status: number; headers?: Record<string, string>; body?: unknown }[], Record<string, string | undefined>][] = [
    ["connected", ok2(), BASE],
    ["401", [{ status: 401 }], BASE],
    ["404", [{ status: 404 }], BASE],
    ["500", [{ status: 500 }], BASE],
    ["not configured", [], { ...BASE, GITHUB_DISPATCH_TOKEN: undefined }],
  ];
  for (const [label, answers, env] of cases) {
    if (answers.length) answering(answers); else setStatusFetch(null);
    const r = await runCheck(runnerCheck(env));
    assert.ok(r.caveat, `${label}: no caveat`);
    assert.match(r.caveat!, /cannot prove the intake will start/, label);
    assert.match(r.caveat!, /Actions write permission/, label);
  }
  setStatusFetch(null);
});

await t("the runner check names the four causes in the same words as an upload failure", async () => {
  assert.match(runnerCause(401), /expired or been revoked/);
  assert.match(runnerCause(403), /does not have permission/);
  assert.match(runnerCause(404), /repository or the workflow name is wrong/);
  assert.match(runnerCause(503), /briefly unavailable/);

  for (const [status, state] of [[401, "down"], [403, "down"], [404, "down"], [500, "attention"], [429, "attention"]] as const) {
    answering([{ status }]);
    const r = await runCheck(runnerCheck(BASE));
    assert.equal(r.state, state, `${status} -> ${r.state}`);
    assert.equal(r.detail, runnerCause(status), String(status));
    assert.ok(r.facts?.some((f) => f.label === "GitHub answered" && f.text === String(status)));
  }
  setStatusFetch(null);
});

await t("the repository can work while the workflow is missing, and it says which", async () => {
  answering([{ status: 200, body: {} }, { status: 404 }]);
  const r = await runCheck(runnerCheck(BASE));
  assert.equal(r.state, "down");
  assert.match(r.detail, /no workflow called library-intake\.yml/);
  setStatusFetch(null);
});

await t("the runner check reads the expiry header, and warns inside fourteen days", async () => {
  // Nine days and twelve hours, so truncating the header's seconds cannot make Math.floor say
  // eight. Flooring is the right direction — 8.99 days left should read as 8, not 9 — so the
  // fixture carries the margin rather than the code losing the rule.
  const soon = new Date(Date.now() + 9.5 * 86_400_000).toISOString();
  const header = `${soon.slice(0, 10)} ${soon.slice(11, 19)} UTC`;
  answering(ok2({ "github-authentication-token-expiration": header }));
  const warn = await runCheck(runnerCheck(BASE));
  assert.equal(warn.state, "attention", warn.detail);
  assert.match(warn.detail, /expires in 9 days/);
  assert.ok(warn.facts?.some((f) => f.label === "Token expiry" && /Expires in 9 days/.test(f.text)));

  const far = new Date(Date.now() + 200.5 * 86_400_000).toISOString();
  answering(ok2({ "github-authentication-token-expiration": `${far.slice(0, 10)} ${far.slice(11, 19)} UTC` }));
  const fine = await runCheck(runnerCheck(BASE));
  assert.equal(fine.state, "ok", fine.detail);
  assert.match(fine.detail, /^Connected:/);

  // No header at all: connected, expiry unknown, and not a warning.
  answering(ok2());
  const unknown = await runCheck(runnerCheck(BASE));
  assert.equal(unknown.state, "ok");
  assert.ok(unknown.facts?.some((f) => f.label === "Token expiry" && /sent no expiry/.test(f.text)));

  // A date GitHub reported that cannot be true of a call that just succeeded.
  answering(ok2({ "github-authentication-token-expiration": "2020-01-01 00:00:00 UTC" }));
  const suspect = await runCheck(runnerCheck(BASE));
  assert.equal(suspect.state, "ok", "a suspect date must not be treated as expiring");
  assert.ok(suspect.facts?.some((f) => /looks wrong/.test(f.text)));
  setStatusFetch(null);
});

// ---------------------------------------------------------------------------------- email check

await t("a send-only key's 401 is success, in the agreed words", async () => {
  // Decision 1. This is the right key for the application to hold, so Resend refusing to let it
  // read is evidence the setup is correct — not a fault.
  answering([{ status: 401, body: { name: "restricted_api_key", message: "This API key is restricted to only send emails." } }]);
  const r = await runCheck(emailCheck(BASE));
  assert.equal(r.state, "ok", r.detail);
  assert.equal(r.detail, SEND_ONLY_WORDS);
  assert.match(r.detail, /send-only, which is the safer setup/);
  setStatusFetch(null);
});

await t("any other 401, a 403 and a 5xx are not working", async () => {
  for (const [answer, expected] of [
    [{ status: 401, body: { name: "missing_api_key" } }, /refused the key/],
    [{ status: 401, body: {} }, /refused the key/],
    [{ status: 403, body: { name: "suspended_api_key" } }, /not active, or it is suspended/],
    [{ status: 500, body: {} }, /answered 500/],
  ] as const) {
    answering([answer]);
    const r = await runCheck(emailCheck(BASE));
    assert.equal(r.state, "down", JSON.stringify(answer));
    assert.match(r.detail, expected);
  }
  setStatusFetch(null);
});

await t("a timeout from Resend is not working either", async () => {
  // Decision 1 names a timeout as not working, alongside the wrong 401s and the 403s.
  setStatusFetch(() => new Promise(() => {}));
  const r = await runCheck(emailCheck(BASE), () => Date.now(), 20);
  assert.equal(r.state, "down");
  assert.match(r.detail, /No answer within/);
  setStatusFetch(null);
});

await t("a timeout from GitHub is Down too, and still says what it cannot prove", async () => {
  setStatusFetch(() => new Promise(() => {}));
  const r = await runCheck(runnerCheck(BASE), () => Date.now(), 20);
  assert.equal(r.state, "down");
  assert.match(r.detail, /No answer within/);
  setStatusFetch(null);
});

await t("email needs both the key and the from-address, and says which is missing", async () => {
  setStatusFetch(null);
  const neither = await runCheck(emailCheck({ ...BASE, RESEND_API_KEY: undefined, MAIL_FROM: undefined }));
  assert.equal(neither.state, "not-configured");
  assert.match(neither.detail, /No sending key and no from-address/);
  assert.match(neither.detail, /downloaded as a file/, "it should name the fallback that exists");

  const noKey = await runCheck(emailCheck({ ...BASE, RESEND_API_KEY: undefined }));
  assert.equal(noKey.state, "not-configured");
  assert.match(noKey.detail, /from-address is set but no sending key/);

  const noFrom = await runCheck(emailCheck({ ...BASE, MAIL_FROM: undefined }));
  assert.equal(noFrom.state, "not-configured");
  assert.match(noFrom.detail, /sending key is set but no from-address/);
  for (const r of [neither, noKey, noFrom]) {
    assert.match(r.caveat ?? "", /needs both the key and the from-address/);
  }
});

await t("the Reply-To setting is reported as a fact, not as a state", async () => {
  answering([{ status: 401, body: { name: "restricted_api_key" } }]);
  const without = await runCheck(emailCheck(BASE));
  assert.ok(without.facts?.some((f) => f.label === "MAIL_REPLY_TO" && f.text === "not set"));
  answering([{ status: 401, body: { name: "restricted_api_key" } }]);
  const with_ = await runCheck(emailCheck({ ...BASE, MAIL_REPLY_TO: "support@osiwrapper.com" }));
  assert.ok(with_.facts?.some((f) => f.label === "MAIL_REPLY_TO" && f.text === "support@osiwrapper.com"));
  assert.equal(with_.state, "ok", "an unset Reply-To must not change the state");
  setStatusFetch(null);
});

// ------------------------------------------------------------------------------ assistant check

await t("the assistant check reads the two switches and calls no provider", async () => {
  let called = false;
  setStatusFetch(async () => { called = true; return new Response(null, { status: 200 }); });
  const on = await runCheck(assistantCheck(BASE));
  assert.equal(on.state, "ok", on.detail);
  assert.equal(called, false, "it called the provider, which §1 forbids");

  const off = await runCheck(assistantCheck({ ...BASE, AI_ENABLED: undefined }));
  assert.equal(off.state, "not-configured");
  assert.match(off.detail, /switched off globally/);

  const onNoKey = await runCheck(assistantCheck({ ...BASE, ANTHROPIC_API_KEY: undefined }));
  assert.equal(onNoKey.state, "attention");
  assert.match(onNoKey.detail, /no provider key is set/);

  const neither = await runCheck(assistantCheck({ ...BASE, AI_ENABLED: undefined, ANTHROPIC_API_KEY: undefined }));
  assert.equal(neither.state, "not-configured");

  // AI_ENABLED is exactly "true" and nothing else, which is the existing rule.
  for (const v of ["TRUE", "1", "yes", "on"]) {
    const r = await runCheck(assistantCheck({ ...BASE, AI_ENABLED: v }));
    assert.equal(r.state, "not-configured", v);
  }
  for (const r of [on, off, onNoKey]) {
    assert.match(r.caveat ?? "", /revoked still reads as set/);
  }
  setStatusFetch(null);
});

// ----------------------------------------------------------------------------------- cron check

await t("the scheduled job check says whether the secret is set, never what it is", async () => {
  const set = await runCheck(cronCheck(BASE));
  assert.equal(set.state, "ok");
  assert.deepEqual(set.facts, [{ label: "CRON_SECRET", text: "set" }]);
  assert.ok(!JSON.stringify(set).includes(SECRETS.CRON_SECRET), "the secret is in the result");

  const unset = await runCheck(cronCheck({ ...BASE, CRON_SECRET: undefined }));
  assert.equal(unset.state, "not-configured");
  assert.deepEqual(unset.facts, [{ label: "CRON_SECRET", text: "not set" }]);
  assert.match(unset.caveat ?? "", /does not prove the schedule exists/);
});

// ------------------------------------------------------------------------ rule 4: no secret, ever

await t("no secret appears anywhere in a whole snapshot, nor in any server output", async () => {
  // Rule 4, over all seven at once, with every secret a unique string. Every console channel is
  // captured too — and the capture is proved to work first, because an empty transcript looks
  // exactly like a broken recorder.
  const chunks: string[] = [];
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const grab = (...a: unknown[]) => { chunks.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };

  answering([{ status: 200, headers: { "github-authentication-token-expiration": "2027-01-01 00:00:00 UTC" }, body: {} },
             { status: 200, body: {} },
             { status: 401, body: { name: "restricted_api_key" } }]);
  let snap;
  console.log = grab; console.warn = grab; console.error = grab; console.info = grab; console.debug = grab;
  try {
    snap = await runAll(allChecks(BASE));
  } finally {
    Object.assign(console, real);
    setStatusFetch(null);
  }

  {
    const probe: string[] = [];
    const saved = console.log;
    console.log = (...a: unknown[]) => { probe.push(a.join(" ")); };
    try { console.log(SECRETS.CRON_SECRET); } finally { console.log = saved; }
    assert.equal(probe.length, 1, "the capture records nothing, so this proves nothing");
    assert.ok(probe[0].includes(SECRETS.CRON_SECRET), "the capture does not record content");
  }

  const page = JSON.stringify(snap);
  const transcript = chunks.join("\n");
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!page.includes(value), `${name} is in the page`);
    assert.ok(!transcript.includes(value), `${name} was logged`);
  }
  // the distinctive halves, in case a value were split or partly shown
  for (const frag of ["UNIQUE_RUNNER_TOKEN", "UNIQUE_SENDING_KEY", "UNIQUE_AI_KEY",
                      "UNIQUE_CRON_SECRET", "UNIQUE_DB_PASSWORD", "vercel_blob_rw"]) {
    assert.ok(!page.includes(frag), `${frag} is in the page`);
    assert.ok(!transcript.includes(frag), `${frag} was logged`);
  }
  assert.equal(Object.keys(snap.results).length, 7);
  // The address line prints APP_URL's value on purpose, so prove that is the only kind of
  // setting shown in full: a secret-shaped value must never be.
  assert.ok(page.includes("learn.flexee.invalid"), "the address line should show the address");
  console.log(`      7 lines, ${chunks.length} line(s) of server output, no secret in either`);
});

await t("all seven lines appear, each with a state, a sentence and a time", async () => {
  answering([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 401, body: { name: "restricted_api_key" } }]);
  const snap = await runAll(allChecks(BASE));
  setStatusFetch(null);
  assert.deepEqual(Object.keys(snap.results).sort(),
    ["address", "assistant", "cron", "database", "email", "runner", "storage"]);
  for (const [id, r] of Object.entries(snap.results)) {
    assert.ok(r.state in STATE_WORDS, `${id}: ${r.state}`);
    assert.ok(r.detail.length > 15, `${id}: ${r.detail}`);
    assert.ok(typeof r.ms === "number" && r.ms >= 0, id);
    assert.ok(!r.detail.includes("undefined") && !r.detail.includes("[object"), `${id}: ${r.detail}`);
  }
});

void db; void schema; void eq; void setMailTransport;
console.log(`\n${passed} checks passed`);
