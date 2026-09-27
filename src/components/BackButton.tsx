"use client";

import { useRouter } from "next/navigation";

type BackButtonProps = {
  fallbackHref?: string;
  label?: string;
  className?: string;
};

export default function BackButton({ fallbackHref = "/", label = "Back", className = "nav-button ghost" }: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window === "undefined") return;

    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      const current = window.location.href;
      const canUseHistory =
        referrer &&
        referrer.origin === window.location.origin &&
        referrer.href !== current &&
        !referrer.pathname.startsWith("/login");

      if (canUseHistory) {
        router.back();
        return;
      }
    } catch {
      // Fall back to the stable route below.
    }

    router.push(fallbackHref);
  }

  return (
    <button type="button" className={className} onClick={handleBack}>
      {label}
    </button>
  );
}
