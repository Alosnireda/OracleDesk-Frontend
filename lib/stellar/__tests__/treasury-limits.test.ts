import { describe, expect, it } from "vitest";
import type { DailyUsage, RiskConfig } from "../generated/treasury";
import { capitalAgreement, computeLimits, formatCountdown, mulDivCeil } from "../treasury-limits";
import { BPS, USDC_UNIT } from "../units";

const config: RiskConfig = {
  agent: "GAGENT",
  collateral: "CUSDC",
  market_core: "CMARKET",
  max_trade: 100n * USDC_UNIT,
  max_market: 500n * USDC_UNIT,
  max_daily: 1_000n * USDC_UNIT,
};
const usage = (amount: bigint, day_start: bigint): DailyUsage => ({ amount, day_start });
const DAY = 86_400n;

describe("mulDivCeil", () => {
  it("rounds up", () => {
    expect(mulDivCeil(1n, 10_000n, 3n)).toBe(3334n);
    expect(mulDivCeil(3n, 10_000n, 3n)).toBe(10_000n);
  });
});

describe("computeLimits", () => {
  it("rounds utilisation up and never shows 99.99% as full headroom", () => {
    // 999.9 of 1000 USDC is exactly 9999 bps; 0.1 USDC of headroom remains.
    const limits = computeLimits(config, usage(9_999_000_000n, 1_000n), 5_000n * USDC_UNIT, 1_100n);
    expect(limits.daily.utilisationBps).toBe(9_999n);
    expect(limits.daily.headroom).toBe(1_000_000n);
    const rounded = computeLimits(config, usage(1n, 1_000n), 0n, 1_100n);
    expect(rounded.daily.utilisationBps).toBe(1n);
  });

  it("caps utilisation at 100% and clamps headroom at zero if usage exceeds the cap", () => {
    const limits = computeLimits(config, usage(2_000n * USDC_UNIT, 1_000n), 0n, 1_100n);
    expect(limits.daily.utilisationBps).toBe(BPS);
    expect(limits.daily.headroom).toBe(0n);
  });

  it("gives the largest passing trade as the minimum of max_trade, headroom and capital", () => {
    const withCapital = (capital: bigint) => computeLimits(config, usage(950n * USDC_UNIT, 1_000n), capital, 1_100n);
    expect(withCapital(5_000n * USDC_UNIT).effectivePerTrade).toBe(50n * USDC_UNIT); // headroom binds
    expect(withCapital(20n * USDC_UNIT).effectivePerTrade).toBe(20n * USDC_UNIT); // capital binds
    expect(withCapital(5_000n * USDC_UNIT).daily.headroom).toBe(50n * USDC_UNIT);
    expect(withCapital(-1n).effectivePerTrade).toBe(0n);
  });

  it("counts down to day_start + 86400 on ledger time", () => {
    const limits = computeLimits(config, usage(0n, 1_000n), 0n, 1_000n + 3_600n);
    expect(limits.resetsAt).toBe(1_000n + DAY);
    expect(limits.resetsInSec).toBe(DAY - 3_600n);
    expect(limits.windowPassed).toBe(false);
  });

  it("treats usage as rolled over once the window has passed", () => {
    const limits = computeLimits(config, usage(900n * USDC_UNIT, 1_000n), 0n, 1_000n + DAY);
    expect(limits.windowPassed).toBe(true);
    expect(limits.daily.used).toBe(0n);
    expect(limits.daily.utilisationBps).toBe(0n);
    expect(limits.resetsInSec).toBe(0n);
  });

  it("shows no utilisation instead of dividing by a zero cap", () => {
    const limits = computeLimits({ ...config, max_daily: 0n }, usage(5n, 1_000n), 0n, 1_100n);
    expect(limits.daily.utilisationBps).toBeNull();
  });
});

describe("capitalAgreement", () => {
  it("agrees within tolerance, differs beyond it, and is unknown without a backend figure", () => {
    expect(capitalAgreement(100n * USDC_UNIT, 100n * USDC_UNIT + 1n)).toBe("agree");
    expect(capitalAgreement(100n * USDC_UNIT, 90n * USDC_UNIT)).toBe("differ");
    expect(capitalAgreement(100n * USDC_UNIT, null)).toBe("unknown");
  });
});

describe("formatCountdown", () => {
  it("formats hours, minutes and seconds compactly", () => {
    expect(formatCountdown(5n * 3600n + 12n * 60n)).toBe("5 h 12 m");
    expect(formatCountdown(42n * 60n)).toBe("42 m");
    expect(formatCountdown(30n)).toBe("30 s");
  });
});
