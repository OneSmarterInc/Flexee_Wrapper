// Integration test: Spec 24 §3 and rule 7 — the optional Reply-To.
//
// The real transport is reached by capturing fetch, because the point of the rule is what goes into
// the request body: Resend's field is `reply_to`, and with the setting unset the body must be
// exactly what it was before this existed.
import assert from "node:assert/strict";
import { sendMail, replyTo, setMailTransport, mailConfigured, NOT_CONFIGURED } from "@/lib/mail";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const MSG = { to: "student@example.invalid", subject: "Set your password", text: "A link." };

/** Capture the one request the adapter makes, and answer as Resend does. */
function capture(status = 200) {
  const sent: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    sent.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      auth: init?.headers?.authorization,
    });
    return new Response(status === 200 ? JSON.stringify({ id: "re_123" }) : "no", { status });
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

await t("the setting is read into a list, and junk in it is dropped", () => {
  assert.deepEqual(replyTo({}), []);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "" }), []);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "   " }), []);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "support@osiwrapper.com" }), ["support@osiwrapper.com"]);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "  support@osiwrapper.com  " }), ["support@osiwrapper.com"]);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "a@x.invalid,b@y.invalid" }), ["a@x.invalid", "b@y.invalid"]);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "a@x.invalid, b@y.invalid ," }), ["a@x.invalid", "b@y.invalid"]);
  // A malformed Reply-To can make a provider refuse the whole message, and losing an invitation is
  // worse than losing the reply address — so these are dropped rather than sent.
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "not-an-address" }), []);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "Flexee Support <support@osiwrapper.com>" }), []);
  assert.deepEqual(replyTo({ MAIL_REPLY_TO: "good@x.invalid,bad" }), ["good@x.invalid"]);
});

await t("with MAIL_REPLY_TO set, the message carries reply_to", async () => {
  setMailTransport(null);
  const saved = { ...process.env };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  process.env.MAIL_REPLY_TO = "support@osiwrapper.com";
  const cap = capture();
  try {
    const r = await sendMail(MSG);
    assert.deepEqual(r, { ok: true, id: "re_123" });
    assert.equal(cap.sent.length, 1);
    // Resend's own field name, and its array form
    assert.deepEqual(cap.sent[0].body.reply_to, ["support@osiwrapper.com"]);
    assert.equal(cap.sent[0].url, "https://api.resend.com/emails");
  } finally {
    cap.restore();
    process.env = saved;
  }
});

await t("two addresses arrive as two, which is the form Resend documents", async () => {
  const saved = { ...process.env };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  process.env.MAIL_REPLY_TO = "support@osiwrapper.com, books@osiwrapper.com";
  const cap = capture();
  try {
    await sendMail(MSG);
    assert.deepEqual(cap.sent[0].body.reply_to, ["support@osiwrapper.com", "books@osiwrapper.com"]);
  } finally { cap.restore(); process.env = saved; }
});

await t("with it unset, the body is exactly what it was before this existed", async () => {
  const saved = { ...process.env };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  delete process.env.MAIL_REPLY_TO;
  const cap = capture();
  try {
    await sendMail(MSG);
    const body = cap.sent[0].body;
    assert.ok(!("reply_to" in body), "an empty reply_to was sent");
    assert.deepEqual(Object.keys(body).sort(), ["from", "subject", "text", "to"]);
    assert.deepEqual(body.to, ["student@example.invalid"]);
  } finally { cap.restore(); process.env = saved; }
});

await t("a setting that is all junk adds no field, rather than an empty one", async () => {
  const saved = { ...process.env };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  process.env.MAIL_REPLY_TO = "not-an-address";
  const cap = capture();
  try {
    await sendMail(MSG);
    assert.ok(!("reply_to" in cap.sent[0].body), "a junk setting became a field");
  } finally { cap.restore(); process.env = saved; }
});

await t("the html form still carries both html and reply_to", async () => {
  const saved = { ...process.env };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  process.env.MAIL_REPLY_TO = "support@osiwrapper.com";
  const cap = capture();
  try {
    await sendMail({ ...MSG, html: "<p>A link.</p>" });
    const body = cap.sent[0].body;
    assert.equal(body.html, "<p>A link.</p>");
    assert.deepEqual(body.reply_to, ["support@osiwrapper.com"]);
  } finally { cap.restore(); process.env = saved; }
});

await t("Reply-To changes nothing about the rules the adapter already keeps", async () => {
  const saved = { ...process.env };
  process.env.MAIL_REPLY_TO = "support@osiwrapper.com";

  // No key: still not configured, still nothing sent, still no throw.
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  setMailTransport(null);
  assert.equal(mailConfigured(), false, "a Reply-To must not look like a configured provider");
  const cap = capture();
  try {
    assert.deepEqual(await sendMail(MSG), { ok: false, error: NOT_CONFIGURED });
    assert.equal(cap.sent.length, 0, "it called the provider with no key");
  } finally { cap.restore(); }

  // A refusal still reports the status only, with no address in it.
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  const cap2 = capture(422);
  try {
    const r = await sendMail(MSG);
    assert.deepEqual(r, { ok: false, error: "provider error 422" });
    assert.ok(!JSON.stringify(r).includes("osiwrapper"), "the error names the reply address");
    assert.ok(!JSON.stringify(r).includes("example.invalid"), "the error names the recipient");
  } finally { cap2.restore(); process.env = saved; }
});

await t("the key never reaches anything but the authorization header", async () => {
  const saved = { ...process.env };
  const KEY = "re_UNIQUE_SENDING_KEY_0123456789";
  process.env.RESEND_API_KEY = KEY;
  process.env.MAIL_FROM = "no-reply@flexee.invalid";
  process.env.MAIL_REPLY_TO = "support@osiwrapper.com";
  const cap = capture();
  try {
    const r = await sendMail(MSG);
    assert.equal(cap.sent[0].auth, `Bearer ${KEY}`, "the key is not sent in the header");
    assert.ok(!cap.sent[0].url.includes(KEY), "the key is in the URL");
    assert.ok(!JSON.stringify(cap.sent[0].body).includes(KEY), "the key is in the body");
    assert.ok(!JSON.stringify(r).includes(KEY), "the key is in the result");
  } finally { cap.restore(); process.env = saved; }
});

await t("an installed transport is unaffected, so every other suite is too", async () => {
  const seen: unknown[] = [];
  setMailTransport((m) => { seen.push(m); return { ok: true, id: "fake" }; });
  const saved = { ...process.env };
  process.env.MAIL_REPLY_TO = "support@osiwrapper.com";
  try {
    assert.deepEqual(await sendMail(MSG), { ok: true, id: "fake" });
    // The transport is handed the message, not the transport-level headers — Reply-To is a
    // provider concern, and a fake that asserted on it would be asserting on Resend's API.
    assert.deepEqual(seen, [MSG]);
  } finally { setMailTransport(null); process.env = saved; }
});

console.log(`\n${passed} checks passed`);
