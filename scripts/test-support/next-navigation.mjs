// Stand-in for next/navigation in tests. The router records where it was asked to go, so a test
// can assert intent without a browser; nothing navigates.
export const pushed = [];
export function useRouter() {
  return {
    push: (href) => { pushed.push(href); },
    replace: (href) => { pushed.push(href); },
    back: () => {},
    forward: () => {},
    prefetch: () => {},
    refresh: () => {},
  };
}
/**
 * Next signals a redirect from a server component by throwing, with the destination carried on the
 * error's `digest`. This does the same, so a test can call a page and read where it was sent —
 * Spec 27 needs that for /faculty.html?course=, which C2-2 §3 defines entirely as a redirect.
 *
 * It used to throw a bare "not available in tests", which meant a page whose whole behaviour is a
 * redirect could not be tested at all. Nothing depended on that message.
 */
export function redirect(href = "") {
  const e = new Error(`NEXT_REDIRECT to ${href}`);
  e.digest = `NEXT_REDIRECT;${href};replace;307;`;
  throw e;
}
export function notFound() { throw new Error("notFound() is not available in tests"); }
export function useSearchParams() { return new URLSearchParams(); }
export function usePathname() { return "/"; }
export function useParams() { return {}; }
