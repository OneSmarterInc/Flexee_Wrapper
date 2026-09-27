"use client";
import { useEffect, useState } from "react";

export default function ProgressBar() {
  const [w, setW] = useState(0);
  useEffect(() => {
    function onScroll() {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setW(max > 0 ? (h.scrollTop / max) * 100 : 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <div className="progress" style={{ width: `${w}%` }} aria-hidden="true" />;
}
