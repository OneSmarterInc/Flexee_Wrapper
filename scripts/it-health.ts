// Integration test: C2-2 v1.1 §5 step 1 — /api/health.
//
// Pure: no database, which is the point — a liveness endpoint that needs Postgres is no use when
// Postgres is the problem. Driven through the route handler, because the requirement is an HTTP
// one: answer at exactly that path, with no redirect, and reveal nothing without the secret.
import assert from "node:assert/strict";
import { GET, HEAD, POST, PUT, DELETE } from "@/app/api/health/route";
import { diagnosticBody, fingerprint, mayDiagnose, publicBody } from "@/lib/health";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const SECRET = "UNIQUE_HEALTH_SECRET_aaa111";
const LAUNCH = "UNIQUE_LAUNCH_SECRET_bbb222";
const DB = "postgresql://user:UNIQUE_DB_PASSWORD_ccc333@db.invalid/flexee";

/** The route reads process.env, so a check sets what it needs and puts it back. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]!; }
  try { return await fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!;
    }
  }
}
const call = async (key: string | null, method = "GET") => {
  const req = new Request("https://learn.flexee.org/api/health", {
    method, headers: key == null ? {} : { "x-health-key": key },
  });
  const res = await ({ GET, HEAD, POST, PUT, DELETE } as any)[method](req);
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
};

const LIVE = { HEALTH_SECRET: SECRET, LAUNCH_SECRET: LAUNCH, DATABASE_URL: DB,
               APP_URL: "https://learn.flexee.org", VERCEL_GIT_COMMIT_SHA: "abc1234def", VERCEL_GIT_COMMIT_REF: "main" };

await t("with no key it answers 200 and says only that it is up", async () => {
  const { res, body } = await withEnv(LIVE, () => call(null));
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, service: "flexee-wrapper" });
  assert.deepEqual(Object.keys(body).sort(), ["ok", "service"]);
  assert.equal(res.headers.get("cache-control"), "no-store, max-age=0, must-revalidate");
});

await t("the public body is the same whatever is configured, so it cannot be read for configuration", async () => {
  // Three very different deployments, one answer. If this ever differs, the endpoint has become a
  // way to ask an unauthenticated question about a live site.
  const a = (await withEnv(LIVE, () => call(null))).text;
  const b = (await withEnv({ ...LIVE, DATABASE_URL: undefined, LAUNCH_SECRET: undefined, APP_URL: undefined },
                           () => call(null))).text;
  const c = (await withEnv({ HEALTH_SECRET: undefined, LAUNCH_SECRET: undefined, DATABASE_URL: undefined,
                             APP_URL: undefined, VERCEL_GIT_COMMIT_SHA: undefined, VERCEL_GIT_COMMIT_REF: undefined },
                           () => call(null))).text;
  assert.equal(a, b);
  assert.equal(b, c);
});

await t("a wrong key, of any length, gets the public body and nothing more", async () => {
  for (const bad of ["", "wrong", SECRET + "x", SECRET.slice(0, -1), SECRET.toUpperCase(),
                     SECRET.replace("_", "-"), "a".repeat(1000)]) {
    const { res, body } = await withEnv(LIVE, () => call(bad));
    assert.equal(res.status, 200, bad);
    assert.deepEqual(body, { ok: true, service: "flexee-wrapper" }, `"${bad.slice(0, 20)}" got through`);
  }
  // The comparison itself is exact: no trimming, no case folding, no prefix match.
  assert.equal(mayDiagnose(" " + SECRET, LIVE), false, "the check does not trim");
  assert.equal(mayDiagnose(SECRET.toUpperCase(), LIVE), false);
  assert.equal(mayDiagnose(SECRET.slice(0, 10), LIVE), false);
  assert.equal(mayDiagnose(SECRET, LIVE), true);
});

await t("but a key sent with surrounding whitespace still works, because HTTP strips it", async () => {
  // Found by this suite expecting the opposite. Header values are trimmed in transit — the Fetch
  // spec normalises them — so a key with a leading space or a trailing newline arrives as the
  // bare key, and there is nothing for the comparison to reject. Written down rather than
  // asserted away, because it is the behaviour an operator meets: a key pasted out of a
  // terminal gets in, which is helpful, and no *different* string is ever accepted.
  for (const padded of [" " + SECRET, SECRET + " ", "  " + SECRET + "  ", SECRET + String.fromCharCode(10)]) {
    const { body } = await withEnv(LIVE, () => call(padded));
    assert.equal(body.diagnostic, true, `${JSON.stringify(padded)} should have been trimmed to the key`);
  }
  // The proof that it is the transport and not the check: the same strings fail the check directly.
  for (const padded of [" " + SECRET, SECRET + " "]) {
    assert.equal(mayDiagnose(padded, LIVE), false);
  }
});

await t("with HEALTH_SECRET unset, nothing unlocks it — not even an empty key", async () => {
  // The default. A deployment nobody has configured cannot be interrogated at all.
  for (const key of [null, "", "anything", "undefined"]) {
    const { body } = await withEnv({ ...LIVE, HEALTH_SECRET: undefined }, () => call(key));
    assert.deepEqual(body, { ok: true, service: "flexee-wrapper" }, String(key));
  }
  assert.equal(mayDiagnose("", { HEALTH_SECRET: undefined }), false);
  assert.equal(mayDiagnose("", { HEALTH_SECRET: "" }), false);
});

await t("the right key opens the diagnostic body", async () => {
  const { res, body } = await withEnv(LIVE, () => call(SECRET));
  assert.equal(res.status, 200);
  assert.equal(body.diagnostic, true);
  assert.equal(body.ok, true);
  assert.equal(body.service, "flexee-wrapper");
  assert.equal(body.database, "configured");
  assert.equal(body.launchSecret, "configured");
  assert.equal(body.build, "abc1234 on main");
  assert.equal(body.appUrl, "https://learn.flexee.org");
});

await t("no secret value appears in either body, whichever one you get", async () => {
  // The same rule as /admin/status: report that a thing is set, never what it is.
  for (const key of [null, SECRET]) {
    const { text } = await withEnv(LIVE, () => call(key));
    for (const secret of [SECRET, LAUNCH, DB, "UNIQUE_DB_PASSWORD_ccc333", "UNIQUE_LAUNCH_SECRET_bbb222",
                          "UNIQUE_HEALTH_SECRET_aaa111"]) {
      assert.ok(!text.includes(secret), `${secret.slice(0, 24)} leaked with key=${key ? "right" : "none"}`);
    }
  }
});

await t("the key comparison is constant-time over equal-length operands", async () => {
  // Asserted on the source, and it is worth saying why. Replacing the comparison with
  // `want === given` passes every other check in this file: equality is equality, and a test can
  // observe neither the timing difference nor the length leak. So the implementation choice is
  // pinned directly, because that is the only defence a test can offer for a property it cannot
  // see. I ran that sabotage before writing this, and nothing caught it.
  //
  // Hashing both sides first is what removes the length leak. timingSafeEqual throws on a length
  // mismatch, so the old platform guarded it with `want.length === given.length` — which answers
  // "how long is the secret" to anyone who asks. Two SHA-256 digests are always 32 bytes.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/lib/health.ts", "utf8");
  const fn = src.slice(src.indexOf("export function mayDiagnose"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes("timingSafeEqual"), "the comparison must be constant-time");
  assert.ok(/createHash\(["']sha256["']\)/.test(body), "and over hashes, so there is no length to leak");
  assert.ok(!/\bwant\s*===|\bwant\s*==|\.length\s*===/.test(body),
    "no direct string compare and no length check");
  // Both operands must be hashed: hashing one side only would be the same leak wearing a hat.
  // Matched as a shape rather than counted — counting "h(" finds three, because createHash( ends
  // in one, which is the sort of brittle assertion that passes for the wrong reason later.
  assert.match(body, /timingSafeEqual\(\s*h\([^)]*\)\s*,\s*h\(/,
    "both operands of timingSafeEqual must be hashes");
});

await t("the fingerprint identifies the launch secret without being it", async () => {
  const f = fingerprint(LAUNCH)!;
  assert.match(f, /^[0-9a-f]{8}$/, "eight hex characters, short enough to read aloud");
  assert.equal(fingerprint(LAUNCH), f, "the same secret always gives the same fingerprint");
  assert.notEqual(fingerprint(LAUNCH + "x"), f, "a different secret gives a different one");
  assert.ok(!LAUNCH.includes(f) && !f.includes(LAUNCH.slice(0, 8)), "and it is not a piece of the secret");
  assert.equal(fingerprint(undefined), null);
  assert.equal(fingerprint(""), null);

  // It is what the body carries, so two deployments can be compared by it.
  const { body } = await withEnv(LIVE, () => call(SECRET));
  assert.equal(body.launchSecretFingerprint, f);
});

await t("a missing launch secret reads as MISSING with no fingerprint", async () => {
  // The switch-over failure this is for: if the Wrapper has no secret at all, every pass fails and
  // the fingerprints cannot be compared because there is nothing to compare.
  const { body } = await withEnv({ ...LIVE, LAUNCH_SECRET: undefined }, () => call(SECRET));
  assert.equal(body.launchSecret, "MISSING");
  assert.equal(body.launchSecretFingerprint, null);
});

await t("it reports the two addresses that matter at switch-over, and when they disagree", async () => {
  // appUrl is what the sims must be pointed at; linksWillUse is what an emailed link would say.
  // They differ exactly when APP_URL is unset, which is the state that silently sends people to a
  // preview deployment.
  let body = (await withEnv(LIVE, () => call(SECRET))).body;
  assert.equal(body.appUrl, "https://learn.flexee.org");
  assert.equal(body.linksWillUse, "https://learn.flexee.org", "with APP_URL set, they agree");

  body = (await withEnv({ ...LIVE, APP_URL: undefined }, () => call(SECRET))).body;
  assert.equal(body.appUrl, "not set");
  assert.equal(body.linksWillUse, "https://learn.flexee.org",
    "without it, links follow the request — here the test's own host");
});

await t("it never reads the database, so it still answers when the database is the problem", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/lib/health.ts", "src/app/api/health/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!src.includes("@/db"), `${f} must not import the database`);
    assert.ok(!/\bdb\(\)/.test(src), `${f} must not query`);
  }
  // A nonsense DATABASE_URL still answers, both ways.
  const pub = await withEnv({ ...LIVE, DATABASE_URL: "postgres://nowhere.invalid/x" }, () => call(null));
  assert.equal(pub.res.status, 200);
  const diag = await withEnv({ ...LIVE, DATABASE_URL: "postgres://nowhere.invalid/x" }, () => call(SECRET));
  assert.equal(diag.res.status, 200);
  assert.equal(diag.body.database, "configured", "it reports the setting, not a round trip");
});

await t("it reads no cookie, so a signed-in browser gets no more than a stranger", async () => {
  const req = new Request("https://learn.flexee.org/api/health", {
    headers: { cookie: "fx_session=a-real-looking-session" },
  });
  const body = await (await GET(req)).json();
  assert.deepEqual(body, { ok: true, service: "flexee-wrapper" });
});

await t("HEAD answers with the same status and headers, and no body", async () => {
  const { res, text } = await withEnv(LIVE, () => call(null, "HEAD"));
  assert.equal(res.status, 200);
  assert.equal(text, "");
  assert.equal(res.headers.get("cache-control"), "no-store, max-age=0, must-revalidate");
});

await t("anything that is not GET or HEAD is 405, and says which are allowed", async () => {
  for (const m of ["POST", "PUT", "DELETE"]) {
    const { res, body } = await withEnv(LIVE, () => call(SECRET, m));
    assert.equal(res.status, 405, m);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
    assert.deepEqual(body, { error: "GET only" });
  }
});

await t("nothing about the route can produce a redirect, which is the contract's whole requirement", async () => {
  // C2-2 v1.1 §5 step 1: learn.flexee.org must answer this with no redirect, because the sims'
  // roster call refuses to follow one and the switch-over order depends on this path being
  // reachable first. The three ways it could acquire one are checked here by reading the source.
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("src/app/api/health/route.ts", "utf8");
  // Matched as calls, not as words. A bare search for "redirect" finds this route's own comment
  // explaining the requirement — the second time in this branch that a config check failed on its
  // own explanation, so both are now written as the thing they mean rather than the word.
  assert.ok(!/redirect\s*\(/.test(route), "the handler must never call redirect()");
  assert.ok(!/currentUser\s*\(/.test(route) && !/cookies\s*\(/.test(route),
    "and never ask who you are");
  const config = readFileSync("next.config.mjs", "utf8");
  assert.ok(!/api\/health/.test(config), "no rewrite or redirect may be configured for this path");
  // Every status this route can return is 200 or 405 — never a 3xx.
  for (const [key, method] of [[null, "GET"], [SECRET, "GET"], [null, "HEAD"], [SECRET, "POST"]] as const) {
    const { res } = await withEnv(LIVE, () => call(key, method));
    assert.ok(res.status === 200 || res.status === 405, `${method} returned ${res.status}`);
  }
});

await t("the diagnostic body's shape is fixed, so a new setting cannot leak by accident", async () => {
  const { body } = await withEnv(LIVE, () => call(SECRET));
  assert.deepEqual(Object.keys(body).sort(), [
    "appUrl", "build", "database", "diagnostic", "launchSecret", "launchSecretFingerprint",
    "linksWillUse", "ok", "service",
  ], "if this list grows, check the new field is a state and not a value");
  // Belt and braces on the helper, independent of the route.
  assert.deepEqual(Object.keys(publicBody()).sort(), ["ok", "service"]);
  assert.ok(Object.keys(diagnosticBody(LIVE)).length > 2);
});

console.log("\n%d checks passed", passed);
