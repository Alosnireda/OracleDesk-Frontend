import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  MIN_SLIPPAGE_BPS,
  SETTINGS_STORAGE_PREFIX,
  type SettingsStorage,
  isValidSlippageBps,
  loadSettingsFrom,
  normalizeSettings,
  parseSlippagePercent,
  saveSettingsTo,
  settingsStorageKey,
} from "../settings";

function fakeStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("settingsStorageKey", () => {
  it("scopes settings per wallet address", () => {
    const a = settingsStorageKey("GABC");
    const b = settingsStorageKey("GDEF");
    expect(a).not.toBe(b);
    expect(a.startsWith(SETTINGS_STORAGE_PREFIX)).toBe(true);
  });

  it("maps a missing address to the shared anonymous profile", () => {
    expect(settingsStorageKey(null)).toBe(settingsStorageKey(undefined));
    expect(settingsStorageKey(null)).toBe(settingsStorageKey("   "));
    expect(settingsStorageKey(null)).toContain("anonymous");
  });
});

describe("isValidSlippageBps", () => {
  it("accepts integers inside the range", () => {
    expect(isValidSlippageBps(MIN_SLIPPAGE_BPS)).toBe(true);
    expect(isValidSlippageBps(DEFAULT_SLIPPAGE_BPS)).toBe(true);
    expect(isValidSlippageBps(MAX_SLIPPAGE_BPS)).toBe(true);
  });

  it("rejects non-integers, out-of-range values and non-numbers", () => {
    for (const value of [0.5, 100.001, -1, MAX_SLIPPAGE_BPS + 1, NaN, Infinity]) {
      expect(isValidSlippageBps(value)).toBe(false);
    }
    for (const value of ["100", null, undefined, {}, 10n]) {
      expect(isValidSlippageBps(value)).toBe(false);
    }
  });
});

describe("normalizeSettings", () => {
  it("keeps valid settings", () => {
    const settings = { slippageBps: 250, notifications: { execution: false, news: true, shifts: true } };
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it("falls back to defaults for garbage input", () => {
    for (const raw of [null, undefined, "nope", 42, [], { slippageBps: "50" }]) {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("rejects a slippage above the hard ceiling and a fractional one", () => {
    expect(normalizeSettings({ slippageBps: MAX_SLIPPAGE_BPS + 1 }).slippageBps).toBe(DEFAULT_SLIPPAGE_BPS);
    expect(normalizeSettings({ slippageBps: 12.5 }).slippageBps).toBe(DEFAULT_SLIPPAGE_BPS);
    expect(normalizeSettings({ slippageBps: -10 }).slippageBps).toBe(DEFAULT_SLIPPAGE_BPS);
  });

  it("fills missing notification flags with defaults and ignores non-booleans", () => {
    const settings = normalizeSettings({ slippageBps: 100, notifications: { news: false, execution: "yes" } });
    expect(settings.notifications).toEqual({ execution: true, news: false, shifts: false });
    expect(normalizeSettings({ slippageBps: 100, notifications: null }).notifications).toEqual(
      DEFAULT_SETTINGS.notifications,
    );
  });
});

describe("loadSettingsFrom / saveSettingsTo", () => {
  it("round-trips settings through storage", () => {
    const storage = fakeStorage();
    const settings = { slippageBps: 300, notifications: { execution: false, news: false, shifts: true } };
    expect(saveSettingsTo("k", settings, storage)).toBe(true);
    expect(loadSettingsFrom("k", storage)).toEqual(settings);
  });

  it("returns defaults when storage is empty, unavailable or corrupt", () => {
    expect(loadSettingsFrom("missing", fakeStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettingsFrom("k", null)).toEqual(DEFAULT_SETTINGS);
    const corrupt = fakeStorage({ k: "{not json" });
    expect(loadSettingsFrom("k", corrupt)).toEqual(DEFAULT_SETTINGS);
  });

  it("sanitizes corrupt stored JSON instead of trusting it", () => {
    const storage = fakeStorage({ k: JSON.stringify({ slippageBps: 99_999 }) });
    expect(loadSettingsFrom("k", storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("refuses to persist an invalid slippage", () => {
    const storage = fakeStorage();
    expect(saveSettingsTo("k", { ...DEFAULT_SETTINGS, slippageBps: 5_001 }, storage)).toBe(false);
    expect(saveSettingsTo("k", { ...DEFAULT_SETTINGS, slippageBps: 1.5 }, storage)).toBe(false);
    expect(storage.data).toEqual({});
  });

  it("returns false when storage throws on write", () => {
    const throwing: SettingsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(saveSettingsTo("k", DEFAULT_SETTINGS, throwing)).toBe(false);
  });
});

describe("parseSlippagePercent", () => {
  it("parses percentages into integer bps", () => {
    expect(parseSlippagePercent("0.5")).toBe(50);
    expect(parseSlippagePercent("1")).toBe(100);
    expect(parseSlippagePercent("1.0")).toBe(100);
    expect(parseSlippagePercent("3")).toBe(300);
    expect(parseSlippagePercent("0.01")).toBe(1);
    expect(parseSlippagePercent(".5")).toBe(50);
    expect(parseSlippagePercent(" 0.5 ")).toBe(50);
    expect(parseSlippagePercent("0")).toBe(0);
    expect(parseSlippagePercent(String(MAX_SLIPPAGE_BPS / 100))).toBe(MAX_SLIPPAGE_BPS);
  });

  it("rejects values that cannot be integer bps or exceed the ceiling", () => {
    for (const input of ["0.005", "abc", "", ".", "-", "-1", "1e2", "1,5", "50.01", "51", "NaN", "Infinity"]) {
      expect(parseSlippagePercent(input), input).toBeNull();
    }
  });
});
