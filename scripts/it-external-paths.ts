// Integration test: C2-2 §3 and §5 — the three external paths, and /faculty.html's redirect.
//
// The rewrites are configuration, so they are checked by reading next.config.mjs rather than by
// serving HTTP: a running server would prove the same thing and cost a build. What is checked for
// real is the behaviour behind the one path that has to decide something — /faculty.html?course=,
// which C2-2 §3 requires to redirect an instructor to that class's Simulations page.
//
// `redirect()` throws a NEXT_REDIRECT error carrying the destination, so the page is called and the
// throw is read. That is how Next signals a redirect from a server component.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { db, schema } from "@/db";
import { createSection } from "@/lib/roster";
import { setAdminByEmail } from "@/lib/admin";
import FacultyHome from "@/app/faculty/page";

const { users, identities } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}

/** Where a server component redirected to, or null if it rendered instead. */
async function destinationOf(page: () => Promise<unknown>) {
  try { await page(); return null; }
  catch (e: any) {
    const digest = String(e?.digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[1] ?? "";
  }
}

const config = readFileSync("next.config.mjs", "utf8");

await t("all three external paths are rewritten, to routes that exist", () => {
  for (const [source, destination, file] of [
    ["/session.html", "/session", "src/app/session/page.tsx"],
    ["/open.html", "/open", "src/app/open/page.tsx"],
    ["/faculty.html", "/faculty", "src/app/faculty/page.tsx"],
  ]) {
    assert.ok(config.includes(`source: "${source}"`), `${source} is not rewritten`);
    assert.ok(config.includes(`destination: "${destination}"`), `${source} has no destination`);
    assert.ok(existsSync(file), `${destination} has no page at ${file}`);
  }
});

await t("they are rewrites, not redirects, because the addresses are already printed in sims", () => {
  // A redirect would also move the student off the address the sim sent them to, which is the one
  // thing rapidsims.flexee.org's own forwarding is arranged to avoid.
  assert.match(config, /async rewrites\(\)/);
  assert.ok(!/async redirects\(\)/.test(config), "these three must not be redirects");
});

await t("trailing slashes stay off, or the roster call would meet a 308", () => {
  // C2-2 §1: the sims POST with redirect: 'error'. trailingSlash: true makes Next answer
  // /api/session-enrolments with a 308 to the slashed form, which they refuse to follow.
  // Matched as a setting, not as a word: the config explains this in a comment, and a bare search
  // for "trailingSlash" found that comment and failed on the explanation.
  assert.ok(!/trailingSlash\s*:/.test(config), "trailingSlash must be left at its default");
  // The reason is worth keeping next to the check, because it is not local to this file.
  assert.ok(config.includes("redirect"), "and the config should say why");
});

// ---------------------------------------------------------------- /faculty.html?course=

const prof = await account("Pat Professor", "prof@flexee.org");
const other = await account("Other Prof", "other@flexee.org");
const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");
const cls = await createSection(prof.id, "sad", "Systems Analysis 01", "2027 Spring", { teach: true });

// The same hook test:a11y-pages renders pages through: the next/headers stub holds one settable
// session cookie, so a page can be called as a signed-in reader without a browser.
const headerStub: any = await import("./test-support/next-headers.mjs");

async function signedInAs(userId: string) {
  const id = `test-session-${userId}`;
  await db().insert(schema.sessions)
    .values({ id, userId, expiresAt: new Date(Date.now() + 864e5) }).onConflictDoNothing();
  headerStub.state.session = id;
}
function signedOut() { headerStub.state.session = null; }

await t("C2-2 §3: an instructor with a class is redirected to that class's Simulations page", async () => {
  await signedInAs(prof.id);
  const to = await destinationOf(() => FacultyHome({ searchParams: Promise.resolve({ course: cls.id }) }) as any);
  assert.equal(to, `/teach/${cls.id}/sims`, "where the release controls are");
});

await t("signed out, it signs them in and comes back with the class still named", async () => {
  signedOut();
  const to = await destinationOf(() => FacultyHome({ searchParams: Promise.resolve({ course: cls.id }) }) as any);
  assert.ok(to?.startsWith("/login?next="), to ?? "it should have gone to sign-in");
  const next = decodeURIComponent(to!.split("next=")[1]);
  assert.equal(next, `/faculty?course=${cls.id}`, "the class must survive the round trip");
});

await t("a class they do not teach falls through to their own dashboard", async () => {
  // It must not confirm or deny that the class exists, so a real class they do not teach and a
  // made-up id have to end up in the same place.
  await signedInAs(other.id);
  const real = await destinationOf(() => FacultyHome({ searchParams: Promise.resolve({ course: cls.id }) }) as any);
  const fake = await destinationOf(() => FacultyHome({ searchParams: Promise.resolve({ course: "no-such-class" }) }) as any);
  assert.equal(real, fake, "a stranger learns nothing about whether the class exists");
});

await t("with no class named it behaves exactly as /faculty did before", async () => {
  await signedInAs(prof.id);
  const to = await destinationOf(() => FacultyHome({ searchParams: Promise.resolve({}) }) as any);
  assert.equal(to, null, "the dashboard renders; no redirect");
});

console.log("\n%d checks passed", passed);

