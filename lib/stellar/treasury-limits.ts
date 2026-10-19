import type { DailyUsage, RiskConfig } from "./generated/treasury";
import { BPS, USDC_UNIT } from "./units";

/**
 * Pure math for the treasury risk panel. Inputs are the contract's own reads
 * (get_config, daily_usage, available_capital) and a ledger timestamp, so the
 * panel shows what the contract would enforce, not the backend's copy.
 */

/** The treasury's rolling window (contract DAY_SECONDS). */
export const DAY_SECONDS = 86_400n;

/** Direct and backend capital figures within this many base units count as agreeing (the reads happen at different times). */
export const CAPITAL_TOLERANCE = USDC_UNIT;

export interface CapUsage {
  cap: bigint;
  used: bigint;
  headroom: bigint;
  /** Rounded up, so 99.99% never shows as full headroom. Null when the cap is zero. */
  utilisationBps: bigint | null;
}

export interface TreasuryLimits {
  maxTrade: bigint;
  maxMarket: bigint;
  daily: CapUsage;
  capital: bigint;
  /** The largest single agent trade that could pass the checks right now (per-market exposure isn't readable). */
  effectivePerTrade: bigint;
  resetsAt: bigint;
  /** Seconds until the window resets, or 0 once it has passed (the next trade rolls it over). */
  resetsInSec: bigint;
  /** True when the stored window has already passed, so usage counts as zero until the next trade. */
  windowPassed: boolean;
}

/** ceil(a × b / c) for non-negative bigints, c > 0. */
export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b + c - 1n) / c;
}

const min = (...values: bigint[]) => values.reduce((lowest, v) => (v < lowest ? v : lowest));

/**
 * Derives the panel's numbers. `now` is the latest ledger's close time, in
 * seconds, the same clock the contract uses for day_start.
 */
export function computeLimits(config: RiskConfig, usage: DailyUsage, capital: bigint, now: bigint): TreasuryLimits {
  const resetsAt = usage.day_start + DAY_SECONDS;
  const windowPassed = now >= resetsAt;
  // Mirrors the contract's rolled_daily_usage: a passed window counts as unused.
  const used = windowPassed ? 0n : usage.amount;
  const cap = config.max_daily;
  const headroom = cap > used ? cap - used : 0n;
  const utilisationBps = cap <= 0n ? null : used <= 0n ? 0n : min(BPS, mulDivCeil(used, BPS, cap));
  const spendable = capital > 0n ? capital : 0n;

  return {
    maxTrade: config.max_trade,
    maxMarket: config.max_market,
    daily: { cap, used, headroom, utilisationBps },
    capital,
    effectivePerTrade: min(config.max_trade, headroom, spendable),
    resetsAt,
    resetsInSec: windowPassed ? 0n : resetsAt - now,
    windowPassed,
  };
}

/** Compares the direct capital read with the backend's figure. Null when the backend had no figure. */
export function capitalAgreement(direct: bigint, backend: bigint | null): "agree" | "differ" | "unknown" {
  if (backend === null) return "unknown";
  const gap = direct > backend ? direct - backend : backend - direct;
  return gap <= CAPITAL_TOLERANCE ? "agree" : "differ";
}

/** "5 h 12 m", "42 m", "30 s": a compact countdown for a number of seconds. */
export function formatCountdown(seconds: bigint): string {
  const total = Number(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m`;
  return `${s} s`;
}
