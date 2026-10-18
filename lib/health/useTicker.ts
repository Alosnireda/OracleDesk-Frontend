"use client";

import { useSyncExternalStore } from "react";

/**
 * One shared 5-second interval for every mounted freshness tag, so relative
 * times update without giving each tag its own timer. Returns 0 during server
 * render and hydration (deterministic), then the client clock.
 */
const TICK_MS = 5_000;

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

function subscribe(callback: () => void) {
  subscribers.add(callback);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of subscribers) notify();
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => 0;

/** Current time in ms, ticking at most once per 5 s. 0 while prerendering. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
