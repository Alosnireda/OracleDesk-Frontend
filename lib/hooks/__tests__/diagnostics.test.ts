import { describe, expect, it } from "vitest";
import {
  compareStatus,
  createConcurrencyLimiter,
  createTokenBucket,
  priceDeltaBps,
  sampleMarketIds,
} from "../useDiagnostics";
import type { MarketStatus as ChainStatus } from "@/lib/stellar/generated/market-core";

const open: ChainStatus = { tag: "Open", values: undefined };
const resolvedYes: ChainStatus = { tag: "Resolved", values: [{ tag: "Yes", values: undefined }] };
const voided: ChainStatus = { tag: "Void", values: undefined };

describe("compareStatus", () => {
  it("maps chain Open to backend ACTIVE or RESOLVING", () => {
    expect(compareStatus(open, "ACTIVE")).toBe(true);
    expect(compareStatus(open, "RESOLVING")).toBe(true);
    expect(compareStatus(open, "PENDING")).toBe(false);
    expect(compareStatus(open, "RESOLVED")).toBe(false);
  });

  it("maps Resolved to RESOLVED and Void to CANCELLED", () => {
    expect(compareStatus(resolvedYes, "RESOLVED")).toBe(true);
    expect(compareStatus(resolvedYes, "ACTIVE")).toBe(false);
    expect(compareStatus(voided, "CANCELLED")).toBe(true);
    expect(compareStatus(voided, "RESOLVED")).toBe(false);
  });
});

describe("priceDeltaBps", () => {
  it("compares chain bps with backend probability rounded once", () => {
    expect(priceDeltaBps(5_319, 0.5319)).toBe(0);
    expect(priceDeltaBps(5_319, 0.532)).toBe(1);
    expect(priceDeltaBps(5_319, 0.5)).toBe(319);
  });

  it("ignores missing backend prices", () => {
    expect(priceDeltaBps(5_319, null)).toBeNull();
    expect(priceDeltaBps(5_319, undefined)).toBeNull();
    expect(priceDeltaBps(5_319, Number.NaN)).toBeNull();
  });
});

describe("sampleMarketIds", () => {
  it("always includes the newest ten ids", () => {
    const ids = sampleMarketIds(1_000n, 20, 7);
    const set = new Set(ids.map(String));
    for (let id = 990; id < 1_000; id++) expect(set.has(String(id))).toBe(true);
  });

  it("returns every id when the market is smaller than the sample", () => {
    expect(sampleMarketIds(4n, 20, 1).map(String).sort()).toEqual(["0", "1", "2", "3"]);
    expect(sampleMarketIds(0n, 20, 1)).toEqual([]);
  });

  it("rotates the non-newest ids between seeds", () => {
    const first = sampleMarketIds(1_000n, 20, 1);
    const second = sampleMarketIds(1_000n, 20, 2);
    expect(first).not.toEqual(second);
    // Newest ten survive rotation.
    for (const id of first.slice(0, 10)) expect(second).toContain(id);
  });
});

describe("token bucket", () => {
  it("never exceeds the configured rate", () => {
    let now = 0;
    const bucket = createTokenBucket({ ratePerSecond: 10, capacity: 10, now: () => now });
    for (let i = 0; i < 10; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now = 100;
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now = 1_100;
    for (let i = 0; i < 10; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });
});

describe("concurrency limiter", () => {
  it("keeps at most three reads in flight", async () => {
    const limit = createConcurrencyLimiter(3);
    let active = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        limit(async () => {
          active += 1;
          max = Math.max(max, active);
          await new Promise((resolve) => setTimeout(resolve, (index % 4) * 5));
          active -= 1;
        }),
      ),
    );
    expect(max).toBeLessThanOrEqual(3);
  });
});
