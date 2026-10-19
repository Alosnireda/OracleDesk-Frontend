"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tracks a CSS media query. Returns null on the server so prerendered HTML
 * never depends on the viewport and hydration does not mismatch.
 */
export function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => null,
  );
}
