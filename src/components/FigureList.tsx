"use client";
import { useState } from "react";
import type { FigureEntry } from "@/lib/render";

/**
 * Spec 14: the chapter's figures and tables, each jumping to its own stable address.
 *
 * The heading follows what the chapter holds: "Figures" when it registers no tables, "Figures and
 * tables" when it registers any. Nothing is rendered when the chapter has neither.
 *
 * Clicking an entry moves focus to the target as well as scrolling to it, so a screen reader
 * announces where it landed. The brief highlight is a class the stylesheet can animate or, under
 * reduced motion, simply show and leave.
 */
export default function FigureList({ figures }: { figures: FigureEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!figures.length) return null;
  const hasTables = figures.some((f) => f.isTable);
  const heading = hasTables ? "Figures and tables" : "Figures";

  const jump = (e: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
    const el = document.getElementById(anchor);
    if (!el) return;                       // let the browser try the href
    e.preventDefault();
    history.replaceState(null, "", `#${anchor}`);
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
    el.classList.remove("fx-target");
    void el.offsetWidth;                   // restart the highlight if it is already on
    el.classList.add("fx-target");
    window.setTimeout(() => el.classList.remove("fx-target"), 2000);
  };

  return (
    <nav className={`fx-list ui${open ? " open" : ""}`} aria-label={heading}>
      <button
        type="button"
        className="fx-list-toggle"
        aria-expanded={open}
        aria-controls="fx-list-items"
        onClick={() => setOpen((v) => !v)}
      >
        {heading}
      </button>
      <h2 className="fx-list-heading">{heading}</h2>
      <ol id="fx-list-items">
        {figures.map((f) => (
          <li key={f.anchor}>
            <a href={`#${f.anchor}`} onClick={(e) => jump(e, f.anchor)}>
              <span className="fx-num">{f.word} {f.number}</span>
              {f.isTable && f.word === "Figure" && <span className="fx-tag">table</span>}
              {f.caption && <span className="fx-cap">{f.caption}</span>}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
