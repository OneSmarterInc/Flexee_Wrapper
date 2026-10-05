import "./globals.css";
import "./ui-polish.css";
import type { Metadata } from "next";
import ThemeToggle from "@/components/ThemeToggle";

// Spec 21 rule 4. The template is the second half of every title in the app; a page supplies only
// the part in front of it, through the helpers in @/lib/page-title. "Flexee" alone is the default
// for the two routes that are pure redirects and never render.
export const metadata: Metadata = {
  title: { default: "Flexee", template: "%s — Flexee" },
  description: "Manifest-driven reader for Flexee books.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Rule 3: the first thing a keyboard reaches on every page, hidden until it has focus.
            Every page that renders anything has a <main id="main">, so this always has somewhere
            to go — test:a11y-pages checks that over all of them rather than trusting it. */}
        <a className="skip-link" href="#main">Skip to content</a>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
