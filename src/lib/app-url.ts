/**
 * The Wrapper's own address, in one place.
 *
 * Until now every absolute URL was built from the incoming request's `Host` header, in two places
 * with the same expression copied into both: `src/app/actions.ts`'s `baseUrl()` and
 * `src/app/api/class/links/route.ts`. Everything that leaves the site flows through those two —
 * set-password invites, password resets, email changes, address verification, the copied
 * set-password link, and Spec 19's invitation-links CSV — so the links in them pointed at whatever
 * host the faculty member happened to be on. On a Vercel preview deployment they pointed at the
 * preview. `Host` is also client-supplied, and these are sign-in links.
 *
 * Spec 27 adds a second reason: the sims will set `PLATFORM_URL` to the Wrapper's canonical
 * address, `rapidsims.flexee.org` redirects three paths to it, and `/open` has to build a
 * `next=` round trip through sign-in. One setting, read in one place.
 *
 * `APP_URL` wins when it is set. Without it the `Host` header is still used, so local development
 * and the suites are unaffected and nothing needs configuring to run.
 */

/** A bare host is the likeliest way to mistype this, and https is the only scheme worth assuming. */
const BARE_HOST = /^[a-z0-9.-]+(:\d+)?$/i;

/**
 * `APP_URL` reduced to an origin with no trailing slash, or null when it cannot be used.
 *
 * Lenient about the two near-misses — a trailing slash, and a bare host with no scheme — because
 * both are obviously intended and failing silently back to the `Host` header would hide the
 * mistake. What it concluded is shown on the status page, so leniency is visible rather than
 * magic. A path is kept, since every caller appends an absolute path to this string, but its own
 * trailing slash is not: `https://x/` + `/reset` would otherwise be `https://x//reset`.
 */
export function normaliseAppUrl(raw: string | undefined | null): string | null {
  // Trailing slashes come off before anything else, so that "learn.flexee.org/" is still
  // recognised as the bare host it obviously is rather than failing to parse as a URL.
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  if (!s) return null;
  const withScheme = BARE_HOST.test(s) ? `https://${s}` : s;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return u.origin + path;
}

/**
 * The decision itself, with nothing to mock: what the configured value says, else the request's.
 *
 * Kept separate from the plumbing so the rules can be tested directly. `x-forwarded-proto` is
 * trusted ahead of a guess because every host in front of this one sets it and the scheme cannot
 * be read from the socket here; http is the fallback because the only place without a proxy is a
 * developer's own machine.
 */
export function appUrlFrom(
  configured: string | undefined | null,
  proto: string | undefined | null,
  host: string | undefined | null,
): string {
  const set = normaliseAppUrl(configured);
  if (set) return set;
  return `${proto || "http"}://${host || "localhost:3000"}`;
}

/** The configured address, or null when `APP_URL` is unset or unusable. For the status page. */
export const configuredAppUrl = (env: Record<string, string | undefined> = process.env) =>
  normaliseAppUrl(env.APP_URL);

/**
 * The address to build links from. Pass the `Request` in a route handler; omit it in a server
 * action or component, where the headers come from `next/headers`.
 */
export async function appUrl(req?: Request): Promise<string> {
  if (req) {
    const url = new URL(req.url);
    return appUrlFrom(
      process.env.APP_URL,
      req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", ""),
      req.headers.get("host") ?? url.host,
    );
  }
  const { headers } = await import("next/headers");
  const h = await headers();
  return appUrlFrom(process.env.APP_URL, h.get("x-forwarded-proto"), h.get("host"));
}
