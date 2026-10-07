// Integration test: Spec 27 commit 2 — APP_URL, the site's own address in one place.
//
// Pure: the two decisions are split out as functions taking plain arguments, so none of this needs
// a request, a database or Next. What it is really guarding is the shape of a string that goes into
// emailed sign-in links, where a wrong answer is a link that points somewhere else.
import assert from "node:assert/strict";
import { normaliseAppUrl, appUrlFrom, configuredAppUrl } from "@/lib/app-url";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

t("a normal address passes through unchanged", () => {
  assert.equal(normaliseAppUrl("https://learn.flexee.org"), "https://learn.flexee.org");
  assert.equal(normaliseAppUrl("http://localhost:3000"), "http://localhost:3000");
});

t("a trailing slash is removed, however many there are", () => {
  // The reason: every caller appends an absolute path, so "https://x/" + "/reset" would be
  // "https://x//reset" — which some hosts serve and some do not, and which looks wrong in an email.
  for (const raw of ["https://learn.flexee.org/", "https://learn.flexee.org//",
                     "  https://learn.flexee.org/  ", "https://learn.flexee.org/////"]) {
    assert.equal(normaliseAppUrl(raw), "https://learn.flexee.org", raw);
  }
});

t("a bare host is read as https, because that is the likeliest way to mistype it", () => {
  assert.equal(normaliseAppUrl("learn.flexee.org"), "https://learn.flexee.org");
  assert.equal(normaliseAppUrl("learn.flexee.org/"), "https://learn.flexee.org");
  assert.equal(normaliseAppUrl("flexee-wrapper.vercel.app"), "https://flexee-wrapper.vercel.app");
  // A host with a port is still a bare host.
  assert.equal(normaliseAppUrl("localhost:3000"), "https://localhost:3000");
});

t("a path is kept, but not its trailing slash", () => {
  assert.equal(normaliseAppUrl("https://example.org/app"), "https://example.org/app");
  assert.equal(normaliseAppUrl("https://example.org/app/"), "https://example.org/app");
});

t("a query or fragment is dropped, since this is an origin and not a link", () => {
  assert.equal(normaliseAppUrl("https://learn.flexee.org/?x=1"), "https://learn.flexee.org");
  assert.equal(normaliseAppUrl("https://learn.flexee.org/#top"), "https://learn.flexee.org");
});

t("an unusable value is null rather than a guess", () => {
  for (const bad of ["", "   ", undefined, null, "not a url at all", "ftp://files.flexee.org",
                     "javascript:alert(1)", "mailto:x@y.z", "://missing", "https://"]) {
    assert.equal(normaliseAppUrl(bad as any), null, String(bad));
  }
});

t("the setting wins over the request's own address", () => {
  assert.equal(appUrlFrom("https://learn.flexee.org", "https", "flexee-wrapper-git-x.vercel.app"),
               "https://learn.flexee.org");
  // This is the whole point: a faculty member on a preview deployment downloads invitation links
  // that work, instead of links into the preview.
  assert.equal(appUrlFrom("learn.flexee.org/", "http", "localhost:3000"), "https://learn.flexee.org");
});

t("with no setting it falls back to the request, so nothing needs configuring to run", () => {
  assert.equal(appUrlFrom(undefined, "https", "flexee.vercel.app"), "https://flexee.vercel.app");
  assert.equal(appUrlFrom("", "http", "localhost:3000"), "http://localhost:3000");
  // An unusable setting falls back too, rather than producing a broken link. The status page is
  // where that is reported, because silence here would hide the typo.
  assert.equal(appUrlFrom("not a url", "https", "flexee.vercel.app"), "https://flexee.vercel.app");
});

t("the fallback's own defaults are sane when a header is missing", () => {
  // x-forwarded-proto is absent only where there is no proxy, which is a developer's machine.
  assert.equal(appUrlFrom(null, null, "localhost:3000"), "http://localhost:3000");
  assert.equal(appUrlFrom(null, null, null), "http://localhost:3000");
});

t("configuredAppUrl reads APP_URL and nothing else", () => {
  assert.equal(configuredAppUrl({ APP_URL: "https://learn.flexee.org/" }), "https://learn.flexee.org");
  assert.equal(configuredAppUrl({}), null);
  assert.equal(configuredAppUrl({ APP_URL: "  " }), null);
  // Not fooled by a neighbouring setting of a similar name.
  assert.equal(configuredAppUrl({ DATABASE_URL: "postgres://x/y" }), null);
});

t("the address never carries credentials into a link", () => {
  // A URL may legally hold a username and password. One pasted in here would end up in every
  // emailed link, so it must not survive: the origin alone is kept.
  const got = normaliseAppUrl("https://admin:hunter2@learn.flexee.org/");
  assert.equal(got, "https://learn.flexee.org");
  assert.ok(!String(got).includes("hunter2"));
  assert.ok(!String(got).includes("admin"));
});

console.log("\n%d checks passed", passed);
