// Stand-in for next/headers in tests. The session cookie is settable, so a test can render a page
// as a signed-in reader without a browser.
export const state = { session: null };
export async function cookies() {
  return {
    get: (name) => (name === "fx_session" && state.session ? { name, value: state.session } : undefined),
    getAll: () => (state.session ? [{ name: "fx_session", value: state.session }] : []),
    has: (name) => name === "fx_session" && !!state.session,
    set: () => {}, delete: () => {},
  };
}
export async function headers() { return new Map(); }
