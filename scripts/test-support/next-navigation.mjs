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
export function redirect() { throw new Error("redirect() is not available in tests"); }
export function notFound() { throw new Error("notFound() is not available in tests"); }
export function useSearchParams() { return new URLSearchParams(); }
export function usePathname() { return "/"; }
export function useParams() { return {}; }
