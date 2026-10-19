import { describe, expect, it } from "vitest";
import type { Market } from "@/lib/api/markets";
import { formatLiquidity, pickFeaturedMarket, yesProb } from "../featured";
import { tickerItem, tickerItems } from "../ticker";

const market = (overrides: Partial<Market>): Market => ({
  id: "m1",
  question: "Will the US Federal Reserve lower rates by 50bps in Q4?",
  category: "FED",
  contractCategory: "Macro",
  status: "ACTIVE",
  settlementCurrency: "USDC",
  initialYesProb: 0.5,
  currentYesProb: null,
  confidenceInterval: { lower: 0.4, upper: 0.7 },
  totalLiquidity: 10_000,
  expiryTimestamp: "2026-12-31T00:00:00Z",
  onChainMarketId: "7",
  creationTxHash: null,
  seedAmountRaw: null,
  questionHash: null,
  metaUri: null,
  resolutionHash: null,
  resolutionSpec: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("pickFeaturedMarket", () => {
  it("returns null for an empty list", () => {
    expect(pickFeaturedMarket([])).toBeNull();
  });

  it("ignores markets that are not ACTIVE", () => {
    const markets = [
      market({ id: "a", status: "RESOLVED", totalLiquidity: 99_000 }),
      market({ id: "b", status: "PENDING", totalLiquidity: 50_000 }),
    ];
    expect(pickFeaturedMarket(markets)).toBeNull();
  });

  it("picks the most liquid ACTIVE market", () => {
    const markets = [
      market({ id: "a", totalLiquidity: 12_000 }),
      market({ id: "b", totalLiquidity: 48_000 }),
      market({ id: "c", status: "RESOLVED", totalLiquidity: 90_000 }),
    ];
    expect(pickFeaturedMarket(markets)?.id).toBe("b");
  });

  it("breaks liquidity ties by id so the choice never flaps", () => {
    const markets = [market({ id: "b", totalLiquidity: 5_000 }), market({ id: "a", totalLiquidity: 5_000 })];
    expect(pickFeaturedMarket(markets)?.id).toBe("a");
  });

  it("is deterministic: same input, same output", () => {
    const markets = [market({ id: "a", totalLiquidity: 1 }), market({ id: "b", totalLiquidity: 2 })];
    expect(pickFeaturedMarket(markets)).toBe(pickFeaturedMarket(markets));
  });
});

describe("yesProb", () => {
  it("prefers the current estimate and falls back to the seed", () => {
    expect(yesProb(market({ currentYesProb: 0.64, initialYesProb: 0.5 }))).toBe(0.64);
    expect(yesProb(market({ currentYesProb: null, initialYesProb: 0.5 }))).toBe(0.5);
  });
});

describe("formatLiquidity", () => {
  it("formats thousands with one decimal and small amounts as dollars", () => {
    expect(formatLiquidity(14_100)).toBe("$14.1K");
    expect(formatLiquidity(950)).toBe("$950");
    expect(formatLiquidity(0)).toBe("$0");
    expect(formatLiquidity(-1)).toBe("—");
    expect(formatLiquidity(Number.NaN)).toBe("—");
  });
});

describe("ticker", () => {
  it("renders 'QUESTION: PROB%' from the live probability", () => {
    expect(tickerItem(market({ currentYesProb: 0.642 }))).toBe("WILL THE US FEDERAL RESERVE LO: 64%");
  });

  it("uses the seeded probability before the first estimate", () => {
    expect(tickerItem(market({ currentYesProb: null, initialYesProb: 0.5 }))).toContain(": 50%");
  });

  it("lists one line per market, or an honest empty state", () => {
    expect(tickerItems([])).toEqual(["NO LIVE MARKETS YET"]);
    const items = tickerItems([market({ id: "a" }), market({ id: "b", currentYesProb: 0.3 })]);
    expect(items).toHaveLength(2);
    expect(items[1]).toContain(": 30%");
  });
});
