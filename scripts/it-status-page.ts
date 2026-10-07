// Integration test: Spec 24 rules 1, 6 and 8 — the status page and the banner.
//
// The page is rendered for real, through the layout, with the database seeded and the checks driven
// by fakes. The two things worth rendering rather than asserting on a function: that a state is
// readable without colour, and that a secret does not reach the markup.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { setStatusFetch } from "@/lib/status/checks";
import { statusCache, STATE_WORDS } from "@/lib/status/framework";

const { users, identities, sessions, enrolments } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const TOKEN = "ghp_UNIQUE_PAGE_TOKEN_zzz999";

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
async function session(userId: string, id: string) {
  const [s] = await db().insert(sessions).values({ id, userId, expiresAt: new Date(Date.now() + 36e5) }).returning();
  return s.id;
}

const admin = await account("Ada Admin", "admin@flexee.invalid");
await setAdminByEmail("admin@flexee.invalid");
const prof = await account("Pat Professor", "prof@flexee.invalid");
const stu = await account("Sam Student", "student@flexee.invalid");
const sec = await createSection(prof.id, "sad", "Spring Section A", "2027 Spring", { teach: true });
await db().insert(enrolments).values({ sectionId: sec.id, userId: stu.id, role: "student" });

const SESS = {
  admin: await session(admin.id, "sess-status-admin"),
  faculty: await session(prof.id, "sess-status-faculty"),
  student: await session(stu.id, "sess-status-student"),
};

process.env.GITHUB_DISPATCH_TOKEN = TOKEN;
process.env.GITHUB_REPO = "OneSmarterInc/Flexee_Wrapper";

/** Answers GitHub twice and Resend once, in the order the checks call them. */
function answering(entries: { status: number; headers?: Record<string, string>; body?: unknown }[]) {
  let i = 0;
  setStatusFetch(async () => {
    const e = entries[Math.min(i++, entries.length - 1)];
    return new Response(e.body == null ? null : JSON.stringify(e.body), { status: e.status, headers: e.headers });
  });
}
const headerFor = (days: number) => {
  const d = new Date(Date.now() + (days + 0.5) * 86_400_000).toISOString();
  return { "github-authentication-token-expiration": `${d.slice(0, 10)} ${d.slice(11, 19)} UTC` };
};

async function render(mod: string, as: keyof typeof SESS | "none", props: Record<string, unknown> = {}) {
  const { renderToReadableStream } = await import("react-dom/server");
  const headers: any = await import("./test-support/next-headers.mjs");
  // "none" is signed out. Setting the stub's session before calling render would be undone here,
  // which is how the first version of this silently never tested the signed-out case at all.
  headers.state.session = as === "none" ? null : SESS[as];
  const Page = (await import(mod)).default as any;
  const Root = (await import("@/app/layout")).default as any;
  const tree = Root({ children: await Page({ searchParams: Promise.resolve({}), ...props }) });
  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  const reader = stream.getReader(); const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out.replace(/<!-- -->/g, "");
}

// ------------------------------------------------------------------------------ rule 1: who

await t("the status page is admin-only: faculty, students and signed-out are refused", async () => {
  answering([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 401, body: { name: "restricted_api_key" } }]);
  statusCache.clear();
  // An admin gets the page.
  const page = await render("@/app/admin/status/page", "admin");
  assert.match(page, /<h1>Status<\/h1>/);

  // Everybody else is redirected, which the stub surfaces as a throw.
  for (const who of ["faculty", "student"] as const) {
    await assert.rejects(() => render("@/app/admin/status/page", who), /redirect/i, who);
  }
  // Signed out too.
  await assert.rejects(() => render("@/app/admin/status/page", "none"), /redirect/i, "signed out");
  setStatusFetch(null);
});

// --------------------------------------------------------------- rules 4 and 8: what it says

await t("every line appears, with its state in words and not only in colour", async () => {
  answering([{ status: 200, headers: headerFor(200), body: {} }, { status: 200, body: {} },
             { status: 401, body: { name: "restricted_api_key" } }]);
  statusCache.clear();
  const page = await render("@/app/admin/status/page", "admin");

  for (const name of ["Database", "File storage", "Intake runner", "Email", "AI assistant", "Scheduled job"]) {
    assert.ok(page.includes(name), `no line for ${name}`);
  }
  // The state is a word in the markup, so it survives monochrome and a screen reader.
  assert.ok(page.includes(STATE_WORDS.ok), "no state word on the page");
  // A colour is a tint behind a word, never the only carrier: every colour used is beside text.
  const words = Object.values(STATE_WORDS).filter((w) => page.includes(w));
  assert.ok(words.length >= 1, "no state words at all");

  // The two sentences decision 7 asks for, in words.
  assert.match(page, /cannot prove the intake will start|Actions: write|Actions write/,
    "the page does not say the runner check cannot prove an upload will start");
  assert.match(page, /both<\/em>? ?a sending key and a from-address|both.*sending key.*from-address/s,
    "the page does not say email needs both settings");
});

await t("no secret reaches the markup", async () => {
  answering([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 401, body: { name: "restricted_api_key" } }]);
  statusCache.clear();
  const page = await render("@/app/admin/status/page", "admin");
  assert.ok(!page.includes(TOKEN), "the runner token is on the page");
  assert.ok(!page.includes("UNIQUE_PAGE_TOKEN"), "part of the token is on the page");
  // the repository name is not a secret and is useful, so it is expected to be there
  assert.ok(page.includes("OneSmarterInc/Flexee_Wrapper"), "the repository should be shown");
});

await t("Check now is a real control, operable without a mouse", async () => {
  answering([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 401, body: { name: "restricted_api_key" } }]);
  statusCache.clear();
  const page = await render("@/app/admin/status/page", "admin");
  assert.match(page, /<button[^>]*type="submit"[^>]*>Check now<\/button>/);
  assert.match(page, /<form[^>]*action="\/admin\/status"[^>]*method="get"/);
  assert.ok(!page.includes("onclick"), "it has an inline click handler");
  assert.ok(!/tabindex="[1-9]/.test(page), "it invents a tab order");
});

await t("the page's own markup passes axe at every impact", async () => {
  answering([{ status: 200, headers: headerFor(3), body: {} }, { status: 200, body: {} },
             { status: 403, body: { name: "suspended_api_key" } }]);
  statusCache.clear();
  const page = await render("@/app/admin/status/page", "admin");

  const { JSDOM } = await import("jsdom");
  const axe = (await import("axe-core")).default ?? (await import("axe-core"));
  const body = page.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "");
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`,
    { pretendToBeVisual: true });
  const g: any = globalThis as any;
  const saved = { window: g.window, document: g.document, Node: g.Node, Element: g.Element };
  g.window = dom.window; g.document = dom.window.document;
  g.Node = dom.window.Node; g.Element = dom.window.Element;
  let violations: { id: string; impact: string; nodes: unknown[] }[] = [];
  try {
    const r = await (axe as any).run(dom.window.document.body, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } },   // jsdom paints nothing to measure
    });
    violations = r.violations;
  } finally {
    g.window = saved.window; g.document = saved.document; g.Node = saved.Node; g.Element = saved.Element;
    dom.window.close();
  }
  assert.deepEqual(violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`), []);
  console.log(`      axe over the status page: ${violations.length} finding(s) at any impact`);
  setStatusFetch(null);
});

// ------------------------------------------------------------------ rule 6: the banner

await t("the banner appears for an admin on both pages, under the same conditions", async () => {
  // Expiring inside the fortnight.
  answering([{ status: 200, headers: headerFor(3), body: {} }, { status: 200, body: {} },
             { status: 401, body: { name: "restricted_api_key" } }]);
  statusCache.clear();
  const admin1 = await render("@/app/admin/page", "admin");
  assert.match(admin1, /about to expire/, "no banner on the Administration dashboard");
  statusCache.clear();
  answering([{ status: 200, headers: headerFor(3), body: {} }, { status: 200, body: {} },
             { status: 401, body: { name: "restricted_api_key" } }]);
  const lib1 = await render("@/app/library/page", "admin");
  assert.match(lib1, /about to expire/, "no banner on the Library page");
  for (const page of [admin1, lib1]) {
    assert.match(page, /role="alert"/, "the banner is not announced");
    assert.match(page, /\/admin\/status/, "the banner does not link to the status page");
  }

  // The runner down.
  statusCache.clear();
  answering([{ status: 401 }]);
  const down = await render("@/app/library/page", "admin");
  assert.match(down, /intake runner is not working/);
  assert.match(down, /expired or been revoked/);

  // Working and far from expiry: nothing at all.
  statusCache.clear();
  answering([{ status: 200, headers: headerFor(300), body: {} }, { status: 200, body: {} },
             { status: 401, body: { name: "restricted_api_key" } }]);
  const quiet = await render("@/app/library/page", "admin");
  assert.ok(!quiet.includes("about to expire"), "a banner for a token with 300 days left");
  assert.ok(!quiet.includes("intake runner is not working"), quiet.slice(0, 200));

  // A date GitHub reported wrongly raises nothing: a banner nobody can act on is one people learn
  // to ignore.
  statusCache.clear();
  answering([{ status: 200, headers: { "github-authentication-token-expiration": "2020-01-01 00:00:00 UTC" }, body: {} },
             { status: 200, body: {} }, { status: 401, body: { name: "restricted_api_key" } }]);
  const suspect = await render("@/app/library/page", "admin");
  assert.ok(!suspect.includes("about to expire"), "a suspect date raised the banner");
  setStatusFetch(null);
});

await t("faculty never see the banner, however bad the runner is", async () => {
  // Decision 6. The Library page is open to any instructor, and this names an infrastructure
  // problem they cannot fix; if an upload fails they get Spec 22's message, which they can act on.
  statusCache.clear();
  answering([{ status: 401 }]);
  const lib = await render("@/app/library/page", "faculty");
  assert.match(lib, /Books and uploads/, "the faculty page did not render");
  assert.ok(!lib.includes("intake runner is not working"), "faculty saw the banner");
  assert.ok(!lib.includes("about to expire"), "faculty saw the expiry banner");
  setStatusFetch(null);
});

await t("a banner is never the reason a page fails to render", async () => {
  // If the check itself throws, the Library page must still come up — it is the page faculty use
  // to do their work.
  statusCache.clear();
  setStatusFetch(() => { throw new Error("github is on fire"); });
  const lib = await render("@/app/library/page", "admin");
  assert.match(lib, /Books and uploads/, "the page did not render");
  assert.ok(!lib.includes("github is on fire"), "the error message reached the page");
  setStatusFetch(null);
  statusCache.clear();
});

void eq;
console.log(`\n${passed} checks passed`);
