/**
 * Per-wallet trading settings, persisted in the browser's localStorage.
 *
 * Every page is statically prerendered, so settings live only on the client
 * (see `useSettings` for the hydration story). Slippage tolerance directly
 * sets `min_shares_out` on-chain, so it is stored as an integer number of
 * basis points — never a float — and validated against a hard ceiling before
 * it can reach a transaction. A corrupt or oversized stored value falls back
 * to the default instead of being trusted.
 */

export const SETTINGS_STORAGE_PREFIX = "oracledesk:settings:v1:";

/** Minimum slippage: zero tolerance would fail on any price movement. */
export const MIN_SLIPPAGE_BPS = 0;
/**
 * Hard ceiling: 50%. Past this a mis-click is far more likely than a real
 * expectation, and the trade would accept half the quoted value.
 */
export const MAX_SLIPPAGE_BPS = 5_000;
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%

/** Picker presets shared by the settings page and the copy-trade sheet. */
export const SLIPPAGE_PRESET_BPS = [50, 100, 300] as const;

export interface NotificationSettings {
  /** Confirmations and failures of submitted trades. */
  execution: boolean;
  /** New reasoning-trace / market news. */
  news: boolean;
  /** Probability shifts larger than 5%. */
  shifts: boolean;
}

export interface TradingSettings {
  /** Slippage tolerance in basis points (integer). */
  slippageBps: number;
  notifications: NotificationSettings;
}

export const DEFAULT_SETTINGS: TradingSettings = {
  slippageBps: DEFAULT_SLIPPAGE_BPS,
  notifications: { execution: true, news: true, shifts: false },
};

/** True for an integer within [MIN_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS]. */
export function isValidSlippageBps(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SLIPPAGE_BPS &&
    value <= MAX_SLIPPAGE_BPS
  );
}

function normalizeNotifications(raw: unknown): NotificationSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<NotificationSettings>;
  const pick = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    execution: pick(source.execution, DEFAULT_SETTINGS.notifications.execution),
    news: pick(source.news, DEFAULT_SETTINGS.notifications.news),
    shifts: pick(source.shifts, DEFAULT_SETTINGS.notifications.shifts),
  };
}

/**
 * Coerces any stored value into valid settings. Anything unusable (wrong
 * type, non-integer bps, above the ceiling) falls back to the default so a
 * tampered localStorage entry can never loosen or tighten a trade silently.
 */
export function normalizeSettings(raw: unknown): TradingSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<TradingSettings>;
  return {
    slippageBps: isValidSlippageBps(source.slippageBps)
      ? source.slippageBps
      : DEFAULT_SLIPPAGE_BPS,
    notifications: normalizeNotifications(source.notifications),
  };
}

/** Settings for a wallet address; `null`/empty maps to the anonymous profile. */
export function settingsStorageKey(address: string | null | undefined): string {
  return `${SETTINGS_STORAGE_PREFIX}${address?.trim() || "anonymous"}`;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): SettingsStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null; // storage disabled (privacy mode, blocked cookies)
  }
}

/** Reads and validates the settings stored under `key`. */
export function loadSettingsFrom(
  key: string,
  storage: SettingsStorage | null = browserStorage(),
): TradingSettings {
  if (!storage) return { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } };
  }
}

/**
 * Validates and writes settings under `key`. Returns false when the value is
 * invalid or storage is unavailable; the previous stored value is kept.
 */
export function saveSettingsTo(
  key: string,
  settings: TradingSettings,
  storage: SettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const normalized = normalizeSettings(settings);
  if (
    !isValidSlippageBps(normalized.slippageBps) ||
    normalized.slippageBps !== settings.slippageBps
  ) {
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify(normalized));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled
  }
}

export function loadSettings(address: string | null | undefined): TradingSettings {
  return loadSettingsFrom(settingsStorageKey(address));
}

export function saveSettings(address: string | null | undefined, settings: TradingSettings): boolean {
  return saveSettingsTo(settingsStorageKey(address), settings);
}

/**
 * Parses a percentage typed by a human ("0.5", "1", ".5") into integer basis
 * points. Rejects exponents, signs, more than two decimal places (which
 * cannot be integer bps), and anything outside the allowed range.
 */
export function parseSlippagePercent(input: string): number | null {
  const trimmed = input.trim();
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, whole = "", frac = ""] = match;
  if (!whole && !frac) return null;
  const bps = Number(whole || "0") * 100 + Number((frac || "").padEnd(2, "0") || "0");
  return isValidSlippageBps(bps) ? bps : null;
}
