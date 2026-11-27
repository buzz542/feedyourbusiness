"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Long enough for Reddit's vendor wait (up to two hours), then the page stops checking. */
export const REFRESH_FOR_MS = 3 * 60 * 60_000;
const FAST_FOR_MS = 10 * 60_000;

/**
 * How long to wait before the next refresh, `elapsedMs` after the page opened, or null to stop.
 * Every 15 seconds for the first 10 minutes, when the free sources store their posts, then every
 * minute while the slower vendor run finishes. Never forever.
 */
export function refreshDelay(elapsedMs: number): number | null {
  if (elapsedMs >= REFRESH_FOR_MS) return null;
  return elapsedMs < FAST_FOR_MS ? 15_000 : 60_000;
}

/**
 * While the first run is active, re-renders the page on the server so posts show as soon as they
 * are stored (the founder, 26 Nov 2026). Skips a refresh while the tab is hidden and refreshes once
 * when it is shown again. Renders nothing;
 * the progress panel says the page updates itself.
 */
export function FirstRunRefresh() {
  const router = useRouter();
  useEffect(() => {
    const opened = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = refreshDelay(Date.now() - opened);
      if (delay === null) return;
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
        schedule();
      }, delay);
    };
    schedule();
    // Back on the tab: show what was stored while it was hidden, without waiting for the timer.
    const onVisible = () => {
      if (document.visibilityState === "visible" && refreshDelay(Date.now() - opened) !== null)
        router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
