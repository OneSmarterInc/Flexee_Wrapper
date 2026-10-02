"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Neighbour } from "@/lib/content";
import { keyTarget } from "@/lib/page-turn";

/**
 * Spec 14: turning the page without scrolling to the bottom — side arrows in the margins, the
 * left and right arrow keys, a horizontal swipe on a touch screen, and a fixed Previous/Next bar
 * where there is no margin room. Reading pages only.
 *
 * Every one of these is a real link with an accessible name, so it works without JavaScript and
 * reads correctly to a screen reader; the key and swipe handlers are conveniences on top.
 */
export default function PageTurn({ bookId, prev, next }: { bookId: string; prev: Neighbour; next: Neighbour }) {
  const router = useRouter();
  const href = (n: Neighbour) => (n ? `/${bookId}/${n.ref}` : null);
  const prevHref = href(prev), nextHref = href(next);

  // keyboard: left and right turn the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const to = keyTarget(e, prevHref, nextHref);
      if (!to) return;
      e.preventDefault();
      router.push(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);

  // touch: a deliberate horizontal swipe, not a scroll, not a pinch, not inside something that
  // scrolls sideways of its own (a wide table or figure)
  const start = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { start.current = null; return; }    // zooming or two-finger
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, ok: !inSideScroller(e.target) };
    };
    const onEnd = (e: TouchEvent) => {
      const s = start.current; start.current = null;
      if (!s || !s.ok) return;
      if (zoomed()) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.abs(dx) < 60) return;                                  // too small to mean it
      if (Math.abs(dx) < Math.abs(dy) * 2) return;                    // mostly vertical: a scroll
      if (dx > 0 && prevHref) router.push(prevHref);
      if (dx < 0 && nextHref) router.push(nextHref);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [prevHref, nextHref, router]);

  return (
    <>
      {prev && prevHref && (
        <Link className="page-turn side prev" href={prevHref} aria-label={`Previous: ${prev.label}`} title={prev.label}>
          <span aria-hidden="true">‹</span>
        </Link>
      )}
      {next && nextHref && (
        <Link className="page-turn side next" href={nextHref} aria-label={`Next: ${next.label}`} title={next.label}>
          <span aria-hidden="true">›</span>
        </Link>
      )}
      <nav className="page-turn-bar ui" aria-label="Page">
        {prev && prevHref ? (
          <Link className="nav-button secondary" href={prevHref} aria-label={`Previous: ${prev.label}`}>‹ Previous</Link>
        ) : <span />}
        {next && nextHref ? (
          <Link className="nav-button secondary" href={nextHref} aria-label={`Next: ${next.label}`}>Next ›</Link>
        ) : <span />}
      </nav>
    </>
  );
}

/** A wide table or figure that scrolls sideways owns the horizontal gesture. */
function inSideScroller(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const ov = getComputedStyle(el).overflowX;
      if (ov === "auto" || ov === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

function zoomed(): boolean {
  const vv = (window as any).visualViewport;
  return !!vv && vv.scale > 1.05;
}
