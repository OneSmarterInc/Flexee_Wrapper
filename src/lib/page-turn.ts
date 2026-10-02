// Spec 14: the rules for turning the page with the keyboard, as pure functions.
//
// Kept out of the component so they can be tested without a browser or a React renderer, and so
// the rules read in one place: only the two arrow keys, never with a modifier held, never while
// someone is typing, and never past the first or last page.

export type KeyLike = {
  key: string;
  altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
  target?: EventTarget | null;
};

/** Typing, choosing from a select, or editing: the arrow keys belong to that control. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (s: string) => unknown }) | null;
  if (!el || !el.tagName) return false;
  const tag = String(el.tagName).toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "option") return true;
  if (el.isContentEditable) return true;
  return typeof el.closest === "function" && !!el.closest('[contenteditable="true"]');
}

/**
 * Which page an arrow key should turn to, or null to leave the key alone.
 * Alt+Left stays browser Back, which is why any modifier bows out.
 */
export function keyTarget(e: KeyLike, prevHref: string | null, nextHref: string | null): string | null {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return null;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (isTyping(e.target ?? null)) return null;
  return e.key === "ArrowLeft" ? prevHref : nextHref;
}
