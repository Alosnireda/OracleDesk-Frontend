import { describe, expect, it } from "vitest";
import { BPS, calcBuy, MathError } from "../generated/fpmm";
import { chooseCollateral, maxCollateralForEdge, quoteCopy, type CopyMarket } from "../quote";
import { probabilityToBps, USDC_UNIT } from "../units";

const market: CopyMarket = {
  reserveYes: 4_000n * USDC_UNIT,
  reserveNo: 6_000n * USDC_UNIT,
  feeBps: 30n,
  setsMinted: 10_000n * USDC_UNIT,
};
const ESTIMATE_YES = 6_200n; // agent says 62% YES

/** Small deterministic PRNG so the property checks are repeatable. */
function rng(seed: number) {
  let state = seed >>> 0;
  return (max: bigint) => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return (BigInt(state) * max) / 4_294_967_296n;
  };
}

describe("quoteCopy", () => {
  it("agrees with calcBuy on shares for both sides", () => {
    for (const side of ["Yes", "No"] as const) {
      const [rBought, rOther] = side === "Yes" ? [market.reserveYes, market.reserveNo] : [market.reserveNo, market.reserveYes];
      for (const amount of [USDC_UNIT, 37n * USDC_UNIT, 900n * USDC_UNIT]) {
        expect(quoteCopy(market, side, amount, ESTIMATE_YES).sharesOut).toBe(calcBuy(rBought, rOther, amount, 30n).sharesOut);
      }
    }
  });

  it("rounds the average price up, so the edge is never overstated", () => {
    const quote = quoteCopy(market, "Yes", 100n * USDC_UNIT, ESTIMATE_YES);
    const exact = quote.collateralIn * BPS;
    expect(quote.avgPriceBps * quote.sharesOut).toBeGreaterThanOrEqual(exact);
    expect((quote.avgPriceBps - 1n) * quote.sharesOut).toBeLessThan(exact);
    expect(quote.edgeAfterBps).toBe(ESTIMATE_YES - quote.avgPriceBps);
  });

  it("uses the complementary estimate for the No side", () => {
    const quote = quoteCopy(market, "No", 100n * USDC_UNIT, ESTIMATE_YES);
    expect(quote.edgeAfterBps).toBe(BPS - ESTIMATE_YES - quote.avgPriceBps);
  });

  it("average price never falls as the amount grows", () => {
    let previous = 0n;
    for (let amount = USDC_UNIT; amount <= 2_000n * USDC_UNIT; amount += 25n * USDC_UNIT) {
      const avg = quoteCopy(market, "Yes", amount, ESTIMATE_YES).avgPriceBps;
      expect(avg).toBeGreaterThanOrEqual(previous);
      previous = avg;
    }
  });

  it("refuses an amount that buys no shares", () => {
    expect(() => quoteCopy(market, "Yes", 0n, ESTIMATE_YES)).toThrow(MathError);
  });

  it("refuses a trade that would take the market past its set limit", () => {
    const nearLimit = { ...market, setsMinted: 999_999_999_999_999_000n };
    expect(() => quoteCopy(nearLimit, "Yes", 100n * USDC_UNIT, ESTIMATE_YES)).toThrow(MathError);
  });
});

describe("maxCollateralForEdge", () => {
  it("is maximal: the returned amount keeps the edge, one unit more does not", () => {
    const minEdge = 100n;
    const max = maxCollateralForEdge(market, "Yes", ESTIMATE_YES, minEdge, 5_000n * USDC_UNIT);
    expect(max).toBeGreaterThan(0n);
    expect(quoteCopy(market, "Yes", max, ESTIMATE_YES).edgeAfterBps).toBeGreaterThanOrEqual(minEdge);
    expect(quoteCopy(market, "Yes", max + 1n, ESTIMATE_YES).edgeAfterBps).toBeLessThan(minEdge);
  });

  it("returns the upper bound when even that keeps the edge, and zero when nothing does", () => {
    expect(maxCollateralForEdge(market, "Yes", ESTIMATE_YES, 0n, USDC_UNIT)).toBe(USDC_UNIT);
    expect(maxCollateralForEdge(market, "Yes", 100n, 5_000n, 1_000n * USDC_UNIT)).toBe(0n);
  });
});

describe("chooseCollateral", () => {
  it("never exceeds the balance or the user cap, in any mode", () => {
    const random = rng(7);
    for (let i = 0; i < 500; i++) {
      const balance = random(1_000_000n * USDC_UNIT);
      const cap = i % 3 === 0 ? null : random(1_000_000n * USDC_UNIT);
      const fixed = chooseCollateral({ kind: "fixed", amount: random(2_000_000n * USDC_UNIT) }, { balance, userCap: cap });
      const percent = chooseCollateral({ kind: "percent", bps: random(10_001n) }, { balance, userCap: cap });
      const mirror = chooseCollateral({ kind: "mirror", betFraction: Number(random(10_001n)) / 10_000 }, { balance, userCap: cap });
      for (const choice of [fixed, percent, mirror]) {
        expect(choice.amount).toBeGreaterThanOrEqual(0n);
        expect(choice.amount).toBeLessThanOrEqual(balance);
        if (cap !== null) expect(choice.amount).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("reports what bounded the amount", () => {
    expect(chooseCollateral({ kind: "fixed", amount: 50n }, { balance: 20n, userCap: null })).toEqual({ amount: 20n, limitedBy: "balance" });
    expect(chooseCollateral({ kind: "percent", bps: 5_000n }, { balance: 100n, userCap: 10n })).toEqual({ amount: 10n, limitedBy: "cap" });
    expect(chooseCollateral({ kind: "percent", bps: 1_000n }, { balance: 100n, userCap: null })).toEqual({ amount: 10n, limitedBy: "none" });
  });

  it("mirrors the agent's fraction only when the trace provides a valid one", () => {
    const balance = 1_000n * USDC_UNIT;
    expect(chooseCollateral({ kind: "mirror", betFraction: 0.25 }, { balance, userCap: null }).amount).toBe(250n * USDC_UNIT);
    for (const betFraction of [null, undefined, 0, -0.1, 1.5, Number.NaN]) {
      const choice = chooseCollateral({ kind: "mirror", betFraction }, { balance, userCap: null });
      expect(choice.amount).toBe(0n);
      expect(choice.unavailable).toBeDefined();
    }
  });
});

describe("probabilityToBps", () => {
  it("rounds to integer basis points", () => {
    expect(probabilityToBps(0.62)).toBe(6_200n);
    expect(probabilityToBps(0.123456)).toBe(1_235n);
    expect(probabilityToBps(0)).toBe(0n);
    expect(probabilityToBps(1)).toBe(10_000n);
  });

  it("rejects NaN, infinities and values outside [0, 1]", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(() => probabilityToBps(bad)).toThrow();
    }
  });
});
