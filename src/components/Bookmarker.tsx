"use client";
import { useEffect, useRef } from "react";

// Records the reader's position for this entry: the topmost visible section
// anchor (cNsM) plus a scroll fraction, pinned to the chapter version. Debounced,
// and flushed on page hide so a bookmark survives navigation.
export default function Bookmarker({ bookId, entryId, chapterVersion }: { bookId: string; entryId: string; chapterVersion: number }) {
  const anchor = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>('[id^="c"]'))
      .filter((el) => /^c\d+s\d+$/.test(el.id));
    if (heads.length) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) anchor.current = (e.target as HTMLElement).id;
          schedule();
        },
        { rootMargin: "-10% 0px -80% 0px" },
      );
      heads.forEach((h) => io.observe(h));
    }

    function payload() {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const scroll = max > 0 ? h.scrollTop / max : 0;
      return { bookId, entryId, chapterVersion, sectionAnchor: anchor.current, scroll };
    }
    function send() {
      fetch("/api/bookmark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()), keepalive: true }).catch(() => {});
    }
    function schedule() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(send, 1500);
    }
    function onScroll() { schedule(); }
    function onHide() { if (document.visibilityState === "hidden") send(); }

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bookId, entryId, chapterVersion]);

  return null;
}
