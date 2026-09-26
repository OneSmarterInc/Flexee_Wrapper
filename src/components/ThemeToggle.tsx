"use client";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("fx-theme") : null;
    if (saved) { document.documentElement.dataset.theme = saved; setTheme(saved); }
  }, []);
  function toggle() {
    const cur = document.documentElement.dataset.theme
      || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fx-theme", next); } catch {}
    setTheme(next);
  }
  return (
    <button className="theme-toggle ui" onClick={toggle} aria-label="Toggle light or dark theme">
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
