"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_PREFIX,
  isValidSlippageBps,
  loadSettingsFrom,
  normalizeSettings,
  saveSettingsTo,
  settingsStorageKey,
  type TradingSettings,
} from "./settings";

/**
 * Settings are read with `useSyncExternalStore`, which is what makes them
 * work on statically prerendered pages: the server snapshot (and the
 * hydration render) is the default, then React swaps to the client snapshot
 * synchronously after hydration, before paint and before any effect runs.
 * The first quote a user *sees* already carries their saved slippage — no
 * default flash, and no hydration mismatch.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Snapshot cache: `getSnapshot` must return the identical object for
 * unchanged state or `useSyncExternalStore` re-renders forever.
 */
const snapshots = new Map<string, TradingSettings>();

function snapshotFor(key: string): TradingSettings {
  const cached = snapshots.get(key);
  if (cached) return cached;
  const loaded = loadSettingsFrom(key);
  snapshots.set(key, loaded);
  return loaded;
}

function persist(key: string, next: TradingSettings): void {
  snapshots.set(key, next);
  // Best-effort persistence: when storage is unavailable the in-memory value
  // still applies for this session, so we always broadcast.
  saveSettingsTo(key, next);
  emit();
}

if (typeof window !== "undefined") {
  // Another tab changed (or cleared) settings: re-read and re-render.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(SETTINGS_STORAGE_PREFIX)) emit();
  });
}

export type SettingsPatch =
  | Partial<TradingSettings>
  | ((current: TradingSettings) => TradingSettings);

export interface UseSettingsResult {
  settings: TradingSettings;
  /** Validates, persists and broadcasts the update; returns false when storage refused it. */
  update: (patch: SettingsPatch) => boolean;
  setSlippageBps: (slippageBps: number) => boolean;
  setNotifications: (notifications: TradingSettings["notifications"]) => boolean;
}

/**
 * The connected wallet's persisted settings. Pass the wallet address; a
 * disconnected visitor reads and writes the shared anonymous profile.
 */
export function useSettings(address: string | null | undefined): UseSettingsResult {
  const key = settingsStorageKey(address);

  const subscribe = useCallback((onChange: Listener) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const getSnapshot = useCallback(() => snapshotFor(key), [key]);
  const getServerSnapshot = useCallback(() => DEFAULT_SETTINGS, []);

  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback<UseSettingsResult["update"]>(
    (patch) => {
      const current = snapshotFor(key);
      const candidate =
        typeof patch === "function" ? patch(current) : { ...current, ...patch };
      // Refuse invalid input outright: silently resetting a tolerance the
      // user chose would leave trades with protection they didn't ask for.
      if (!isValidSlippageBps(candidate.slippageBps)) return false;
      const next = normalizeSettings(candidate);
      if (JSON.stringify(next) === JSON.stringify(current)) return true;
      persist(key, next);
      return snapshots.get(key) === next;
    },
    [key],
  );

  const setSlippageBps = useCallback(
    (slippageBps: number) => update({ slippageBps }),
    [update],
  );
  const setNotifications = useCallback(
    (notifications: TradingSettings["notifications"]) => update({ notifications }),
    [update],
  );

  return { settings, update, setSlippageBps, setNotifications };
}
