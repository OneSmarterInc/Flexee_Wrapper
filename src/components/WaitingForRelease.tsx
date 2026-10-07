"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * C2-2 §4 step 7, plus Addendum B §2: re-check every 5 seconds, and stop after 10 minutes with a
 * "Check again" button.
 *
 * It stops for a reason. A student who leaves this tab open over a weekend would otherwise poll a
 * server endlessly, and a page that has been re-checking silently for an hour tells them nothing —
 * at that point a button is more honest than a spinner. The state is announced through the parent's
 * live region, not by moving focus, because the student has not asked to be interrupted.
 *
 * `router.refresh()` re-runs the server component, which re-reads the release and redirects of its
 * own accord as soon as it is granted. Nothing here decides anything.
 */
export default function WaitingForRelease({
  everyMs = 5000,
  stopAfterMs = 10 * 60 * 1000,
}: { everyMs?: number; stopAfterMs?: number }) {
  const router = useRouter();
  const [givenUp, setGivenUp] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (givenUp) return;
    const tick = setInterval(() => {
      if (Date.now() - started.current >= stopAfterMs) { setGivenUp(true); return; }
      router.refresh();
    }, everyMs);
    return () => clearInterval(tick);
  }, [givenUp, everyMs, stopAfterMs, router]);

  if (!givenUp) {
    return (
      <p className="ui" style={{ color: "var(--muted)" }}>
        This page is checking every few seconds. You do not need to do anything.
      </p>
    );
  }
  return (
    <>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Still waiting after ten minutes, so this page has stopped checking on its own.
      </p>
      <button
        className="nav-button primary"
        type="button"
        onClick={() => { started.current = Date.now(); setGivenUp(false); router.refresh(); }}
      >
        Check again
      </button>
    </>
  );
}
