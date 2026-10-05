// Integration test: Spec 22 §6 and rule 7 — what a failed start says, how often it is tried, and
// that the token never appears anywhere.
//
// The last part is the one worth having. A dispatch token with Actions: write on the repository is
// the most dangerous string in the application, and the easy mistake is to put a response body or
// a request into an error message. Every path through dispatchIntake is checked for it, including
// the paths that throw.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { dispatchIntake, dispatchMessage, temporary, DISPATCH_RETRIES,
         setDispatchFetch, retryIntake, getUpload, setStatus } from "@/lib/library";
import { retireBook } from "@/lib/retire";

const { users, identities, libraryUploads } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const TOKEN = "ghp_SUPERSECRET_dispatch_token_0123456789";
const ENV = { GITHUB_DISPATCH_TOKEN: TOKEN, GITHUB_REPO: "OneSmarterInc/Flexee_Wrapper" };
const noWait = async () => {};

/** A fake GitHub that answers with the given statuses in turn, and counts the calls. */
function answering(...statuses: number[]) {
  const calls: { url: string; auth: string | null }[] = [];
  let i = 0;
  setDispatchFetch(async (url: any, init?: any) => {
    calls.push({ url: String(url), auth: (init?.headers?.Authorization as string) ?? null });
    const s = statuses[Math.min(i++, statuses.length - 1)];
    return new Response(s === 204 ? null : `{"message":"something with ${TOKEN} in it"}`, { status: s });
  });
  return calls;
}

await t("a temporary answer is told apart from a settings problem", () => {
  for (const s of [500, 502, 503, 504, 429]) assert.equal(temporary(s), true, String(s));
  for (const s of [401, 403, 404, 422, 400]) assert.equal(temporary(s), false, String(s));

  assert.equal(dispatchMessage(503), "GitHub was briefly unavailable (503); try again.");
  assert.equal(dispatchMessage(429), "GitHub was briefly unavailable (429); try again.");
  for (const s of [401, 403, 404, 422]) {
    assert.match(dispatchMessage(s), /Ask a developer to check the runner settings/, String(s));
    assert.ok(!dispatchMessage(s).includes("briefly unavailable"), String(s));
  }
  // a status in neither family says what happened and claims nothing about why
  assert.equal(dispatchMessage(418), "Could not start the intake (GitHub answered 418).");
});

await t("a 5xx is tried three times, then reported as temporary", async () => {
  const calls = answering(503, 503, 503);
  const r = await dispatchIntake("check", "u1", "sad", ENV, noWait);
  assert.equal(calls.length, DISPATCH_RETRIES, `${calls.length} attempts`);
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(r.retriable, true);
  assert.match((r as { error: string }).error, /briefly unavailable \(503\); try again/);
});

await t("a 5xx that clears on the second attempt succeeds, and stops trying", async () => {
  const calls = answering(503, 204, 204);
  const r = await dispatchIntake("check", "u2", "sad", ENV, noWait);
  assert.deepEqual({ ok: r.ok, status: r.status }, { ok: true, status: 204 });
  assert.equal(calls.length, 2, `${calls.length} attempts — it should stop once it works`);
});

await t("a settings problem is tried once, because it will not clear", async () => {
  for (const s of [401, 403, 404, 422]) {
    const calls = answering(s);
    const r = await dispatchIntake("check", "u3", "sad", ENV, noWait);
    assert.equal(calls.length, 1, `${s}: ${calls.length} attempts`);
    assert.equal(r.ok, false);
    assert.equal(r.retriable, false, String(s));
    assert.match((r as { error: string }).error, /check the runner settings/);
  }
});

await t("a network error is treated as temporary, and retried", async () => {
  let calls = 0;
  setDispatchFetch(async () => { calls++; throw new Error(`socket hang up talking to ${TOKEN}`); });
  const r = await dispatchIntake("check", "u4", "sad", ENV, noWait);
  assert.equal(calls, DISPATCH_RETRIES, `${calls} attempts`);
  assert.equal(r.ok, false);
  assert.equal(r.retriable, true);
  assert.match((r as { error: string }).error, /briefly unavailable \(503\)/);
  assert.ok(!(r as { error: string }).error.includes(TOKEN), "the thrown error's text leaked the token");
});

await t("the token is sent as a header and appears in nothing that comes back", async () => {
  const seen: string[] = [];
  // Every failing path, including the one where the response body contains the token.
  for (const statuses of [[503, 503, 503], [404], [422], [500, 204]] as number[][]) {
    const calls = answering(...statuses);
    const r = await dispatchIntake("check", "u5", "sad", ENV, noWait);
    seen.push(JSON.stringify(r));
    for (const c of calls) {
      assert.equal(c.auth, `Bearer ${TOKEN}`, "the token must be sent in the header");
      assert.ok(!c.url.includes(TOKEN), "the token is in the URL");
      assert.ok(!c.url.includes("ghp_"), c.url);
    }
  }
  for (const s of seen) {
    assert.ok(!s.includes(TOKEN), `a result carried the token: ${s}`);
    assert.ok(!s.includes("ghp_"), `a result carried a token-shaped string: ${s}`);
    assert.ok(!s.includes("Bearer"), `a result carried the header: ${s}`);
  }
});

await t("with no token or repository set, nothing is called at all", async () => {
  let calls = 0;
  setDispatchFetch(async () => { calls++; return new Response(null, { status: 204 }); });
  const r = await dispatchIntake("check", "u6", "sad", {}, noWait);
  assert.equal(calls, 0, "it called GitHub without a token");
  assert.equal(r.ok, false);
  assert.equal(r.retriable, false);
  assert.match((r as { error: string }).error, /not set up/);
});

// ------------------------------------------------------------------ the Retry button's library
//
// retryIntake reaches dispatchIntake through its default env, so the runner has to look set up for
// these checks; the fake fetch above decides what GitHub answers.
process.env.GITHUB_DISPATCH_TOKEN = TOKEN;
process.env.GITHUB_REPO = "OneSmarterInc/Flexee_Wrapper";

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const admin = await account("Ada Admin", "admin@flexee.invalid");
await setAdminByEmail("admin@flexee.invalid");
const prof = await account("Pat Professor", "prof@flexee.invalid");
const other = await account("Other Professor", "prof2@flexee.invalid");

async function record(status: string, bookId = "sad") {
  const [row] = await db().insert(libraryUploads).values({
    bookId, uploadedBy: prof.id, blobPath: `uploads/${bookId}/x.zip`,
    fileName: "x.zip", sizeBytes: 2048, status, message: "GitHub was briefly unavailable (503); try again.",
  }).returning();
  return row;
}

await t("Retry starts the check again and clears the old message", async () => {
  const row = await record("failed");
  answering(204);
  assert.deepEqual(await retryIntake(prof.id, row.id), { ok: true });
  const after = await getUpload(row.id);
  assert.equal(after!.status, "checking");
  assert.equal(after!.message, null, "the old failure message is still on the record");
});

await t("a failed retry puts the record back to failed, with the new message", async () => {
  const row = await record("failed");
  answering(404);
  const r = await retryIntake(admin.id, row.id);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /check the runner settings/);
  const after = await getUpload(row.id);
  assert.equal(after!.status, "failed", "it was left mid-flight");
  assert.match(after!.message!, /check the runner settings/);
  assert.ok(!after!.message!.includes(TOKEN), "the record's message carries the token");
});

await t("a stopped record is not retried; it has a report to fix first", async () => {
  const row = await record("stopped");
  let calls = 0;
  setDispatchFetch(async () => { calls++; return new Response(null, { status: 204 }); });
  const r = await retryIntake(admin.id, row.id);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Fix the book and upload it again/);
  assert.equal(calls, 0, "it started the intake anyway");
  assert.equal((await getUpload(row.id))!.status, "stopped");
});

await t("a record already in the library, or still running, is not retried", async () => {
  for (const status of ["published", "checking", "publishing", "ready"]) {
    const row = await record(status);
    const r = await retryIntake(admin.id, row.id);
    assert.equal(r.ok, false, status);
    assert.equal((await getUpload(row.id))!.status, status, status);
  }
});

await t("only the uploader or an admin may retry", async () => {
  const row = await record("failed");
  const r = await retryIntake(other.id, row.id);
  assert.deepEqual(r, { ok: false,
    error: "Only the person who uploaded it, or an administrator, can start it again." });
  assert.equal((await getUpload(row.id))!.status, "failed");
});

await t("a retired book is not started again by Retry either", async () => {
  const row = await record("failed", "mis3000");
  await retireBook(admin.id, "mis3000");
  let calls = 0;
  setDispatchFetch(async () => { calls++; return new Response(null, { status: 204 }); });
  const r = await retryIntake(admin.id, row.id);
  assert.deepEqual(r, { ok: false, error: "This book is retired; restore it first." });
  assert.equal(calls, 0);
  assert.equal((await getUpload(row.id))!.status, "failed", "it was moved to checking anyway");
});

await t("a record that has gone is reported, not thrown", async () => {
  const r = await retryIntake(admin.id, "11111111-2222-3333-4444-555555555555");
  assert.deepEqual(r, { ok: false, error: "That upload record no longer exists." });
  void setStatus; void eq;
});

console.log(`\n${passed} checks passed`);
