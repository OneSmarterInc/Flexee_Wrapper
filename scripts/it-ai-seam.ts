// Integration test: Spec 20 §1 — the provider seam.
//
// The point of the seam is that the assistant cannot tell which provider it is talking to, and
// that nothing can leave without two switches agreeing. Both adapters are driven against a stubbed
// fetch, so this suite makes no network call and needs no key.
import assert from "node:assert/strict";
import { anthropicProvider } from "@/lib/ai/anthropic";
import { openAiProvider } from "@/lib/ai/openai";
import { fakeProvider } from "@/lib/ai/fake";
import {
  aiAvailable, aiConfigured, aiEnabled, provider, setAiProvider,
  estimateCostMicros, priceTable, formatMicros, estimateTokens,
} from "@/lib/ai";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const REQ = {
  system: "You answer from the passages only.",
  messages: [{ role: "user" as const, content: "What is an actor?" }],
  maxTokens: 600,
};

// A stubbed fetch, so the adapters are exercised without a network or a key leaving this file.
type Call = { url: string; init: RequestInit & { headers: Record<string, string>; body: string } };
function stubFetch(reply: { status?: number; body?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as Call["init"] });
    if (reply.throws) throw new Error("ECONNREFUSED 10.0.0.1:443");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

console.log("The switches");

await t("AI_ENABLED is off unless it is exactly 'true'", () => {
  for (const v of [undefined, "", "false", "1", "yes", "TRUE", " true"]) {
    assert.equal(aiEnabled({ AI_ENABLED: v }), false, `${JSON.stringify(v)} must not enable it`);
  }
  assert.equal(aiEnabled({ AI_ENABLED: "true" }), true);
});

await t("available needs the switch and a key, and either alone is not enough", () => {
  assert.equal(aiAvailable({ AI_ENABLED: "true" }), false, "no key");
  assert.equal(aiAvailable({ ANTHROPIC_API_KEY: "sk-x" }), false, "no switch");
  assert.equal(aiAvailable({ AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-x" }), true);
  assert.equal(aiAvailable({ AI_ENABLED: "true", AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x" }), true);
  assert.equal(aiAvailable({ AI_ENABLED: "true", AI_PROVIDER: "openai" }), false);
  // A self-hosted server needs no key, only somewhere to send to.
  assert.equal(aiConfigured({ AI_PROVIDER: "openai", AI_BASE_URL: "http://localhost:8000/v1" }), true);
});

await t("AI_PROVIDER chooses the adapter, and anthropic is the default", () => {
  assert.equal(provider({}).name, "anthropic");
  assert.equal(provider({ AI_PROVIDER: "openai" }).name, "openai");
  assert.equal(provider({ AI_PROVIDER: "OpenAI" }).name, "openai", "case does not matter");
  assert.equal(provider({ AI_PROVIDER: "something-else" }).name, "anthropic", "an unknown name is not a third adapter");
});

await t("an installed fake wins over the environment, and is itself available", () => {
  const fake = fakeProvider();
  setAiProvider(fake.provider);
  try {
    assert.equal(provider({ AI_PROVIDER: "openai" }).name, "fake");
    assert.equal(aiAvailable({ AI_ENABLED: "true" }), true, "no key needed for a fake");
  } finally { setAiProvider(null); }
  assert.equal(provider({}).name, "anthropic", "and it is put back");
});

console.log("The Anthropic adapter");

await t("it sends the documented shape and reads the usage back", async () => {
  const f = stubFetch({ body: { model: "claude-sonnet-5-5", content: [{ type: "text", text: "An actor is a role." }], usage: { input_tokens: 1234, output_tokens: 56 } } });
  try {
    const p = anthropicProvider({ ANTHROPIC_API_KEY: "sk-test", AI_MODEL: "claude-sonnet-5-5" });
    const r = await p.complete(REQ);
    assert.ok(r.ok);
    assert.equal(r.text, "An actor is a role.");
    assert.equal(r.tokensIn, 1234);
    assert.equal(r.tokensOut, 56);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(f.calls[0].init.headers["x-api-key"], "sk-test");
    assert.equal(f.calls[0].init.headers["anthropic-version"], "2023-06-01");
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.system, REQ.system, "the system prompt is its own field here");
    assert.deepEqual(body.messages, [{ role: "user", content: "What is an actor?" }]);
    assert.equal(body.temperature, 0, "reading a passage back, not writing prose");
    assert.equal(body.max_tokens, 600);
  } finally { f.restore(); }
});

await t("with no key it does not call out at all", async () => {
  const f = stubFetch({});
  try {
    const r = await anthropicProvider({}).complete(REQ);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, "not configured");
    assert.equal(f.calls.length, 0, "nothing was sent");
  } finally { f.restore(); }
});

console.log("The OpenAI-compatible adapter");

await t("it folds the system prompt into the messages and asks for nothing to be stored", async () => {
  const f = stubFetch({ body: { model: "gpt-4.1-mini", choices: [{ message: { content: "An actor is a role." } }], usage: { prompt_tokens: 999, completion_tokens: 12 } } });
  try {
    const r = await openAiProvider({ OPENAI_API_KEY: "sk-test" }).complete(REQ);
    assert.ok(r.ok);
    assert.equal(r.text, "An actor is a role.");
    assert.equal(r.tokensIn, 999);
    assert.equal(r.tokensOut, 12);
    assert.equal(f.calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(f.calls[0].init.headers.authorization, "Bearer sk-test");
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.store, false);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, REQ.system);
    assert.equal(body.messages[1].content, "What is an actor?");
  } finally { f.restore(); }
});

await t("a self-hosted base URL is honoured, with no key", async () => {
  const f = stubFetch({ body: { choices: [{ message: { content: "ok" } }] } });
  try {
    const r = await openAiProvider({ AI_BASE_URL: "http://localhost:8000/v1/" }).complete(REQ);
    assert.ok(r.ok);
    assert.equal(f.calls[0].url, "http://localhost:8000/v1/chat/completions", "no doubled slash");
    assert.equal(f.calls[0].init.headers.authorization, undefined, "no key, no header");
  } finally { f.restore(); }
});

console.log("Failure, and what is said about it");

await t("an HTTP error and a dead socket both come back as data, never as an exception", async () => {
  for (const [label, reply, expect] of [
    ["429", { status: 429 }, "provider error 429"],
    ["500", { status: 500 }, "provider error 500"],
    ["socket", { throws: true }, "could not reach the provider"],
  ] as const) {
    for (const make of [anthropicProvider, openAiProvider]) {
      const f = stubFetch(reply);
      try {
        const r = await make({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }).complete(REQ);
        assert.equal(r.ok, false, `${label} must not throw`);
        assert.equal(r.ok === false && r.error, expect);
        assert.equal(r.tokensIn, 0);
        assert.equal(r.tokensOut, 0);
      } finally { f.restore(); }
    }
  }
});

await t("a failure logs a status code and nothing else", async () => {
  const real = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  const f = stubFetch({ status: 422, body: { error: { message: "the prompt mentions What is an actor?" } } });
  try {
    console.log = grab; console.warn = grab; console.error = grab;
    await anthropicProvider({ ANTHROPIC_API_KEY: "sk-secret-key-value" }).complete(REQ);
  } finally { Object.assign(console, real); f.restore(); }
  const text = lines.join("\n");
  assert.match(text, /HTTP 422/);
  for (const needle of ["What is an actor", "sk-secret-key-value", REQ.system, "the prompt mentions"]) {
    assert.ok(!text.includes(needle), `must not log: ${needle}`);
  }
});

console.log("The fake, and the price table");

await t("the fake keeps every request, which is how the privacy tests see one", async () => {
  const fake = fakeProvider();
  await fake.provider.complete({ ...REQ, messages: [{ role: "user", content: "[1] Actors (/sad/ch03#s3-2)\n\nQ" }] });
  assert.equal(fake.captured.length, 1);
  assert.equal(fake.last().system, REQ.system);
  assert.match(fake.last().messages[0].content, /\/sad\/ch03#s3-2/);
  const r = await fake.provider.complete(REQ);
  assert.ok(r.ok && r.tokensIn > 0 && r.tokensOut > 0, "it counts tokens like a provider would");
  fake.reset();
  assert.equal(fake.captured.length, 0);
});

await t("the fake can fail on demand, so a provider outage is testable", async () => {
  const fake = fakeProvider({ fail: "provider error 503" });
  const r = await fake.provider.complete(REQ);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "provider error 503");
});

await t("the price table turns tokens into an estimate, and is only ever an estimate", () => {
  assert.deepEqual(priceTable({}), { inPerM: 3, outPerM: 15 }, "a default, so the meter works before anything is set");
  assert.deepEqual(priceTable({ AI_PRICE_IN_PER_MTOK: "1", AI_PRICE_OUT_PER_MTOK: "5" }), { inPerM: 1, outPerM: 5 });
  assert.deepEqual(priceTable({ AI_PRICE_IN_PER_MTOK: "nonsense" }), { inPerM: 3, outPerM: 15 }, "a bad value falls back");
  // 2,000 in and 400 out at $3/$15 per million = $0.006 + $0.006 = $0.012
  assert.equal(estimateCostMicros(2000, 400, { AI_PRICE_IN_PER_MTOK: "3", AI_PRICE_OUT_PER_MTOK: "15" } as never), 12000);
  assert.equal(formatMicros(12000), "$0.0120");
  assert.equal(formatMicros(2_500_000), "$2.50");
  assert.equal(estimateTokens("four"), 1);
});

console.log(`\n${passed} checks passed`);
