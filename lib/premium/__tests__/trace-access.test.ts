import { describe, expect, it } from "vitest";
import type { PaymentEvent } from "@/lib/api/traces";
import {
  DAILY_PASS_DURATION_MS,
  deriveDailyPassExpiry,
  deriveUnlockRoutes,
  formatLockedFields,
  formatRoutePrice,
} from "../trace-access";

const NOW = new Date("2026-06-01T12:00:00Z");

function payment(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    type: "DAILY_PASS",
    amountRaw: "5000000",
    txHash: "a".repeat(64),
    createdAt: "2026-06-01T10:00:00Z",
    ...overrides,
  };
}

describe("deriveUnlockRoutes", () => {
  it("always offers the daily pass, using the backend's quoted price", () => {
    const routes = deriveUnlockRoutes(
      { accessLevel: "FREE_PREVIEW", dailyPassPriceRaw: "5000000" },
      { x402Url: "" },
    );
    const daily = routes.find((r) => r.kind === "DAILY_PASS");
    expect(daily).toEqual({ kind: "DAILY_PASS", priceRaw: 5_000_000n, available: true });
  });

  it("falls back to the configured price when the backend quoted none", () => {
    const routes = deriveUnlockRoutes({}, { x402Url: "", fallbackDailyPassPriceRaw: 250_000n });
    expect(routes[0].priceRaw).toBe(250_000n);
  });

  it("reports a null price instead of inventing one", () => {
    const routes = deriveUnlockRoutes({}, { x402Url: "https://x402.example" });
    expect(routes[0].priceRaw).toBeNull();
  });

  it("marks the per-trace route unavailable when the x402 service is not configured", () => {
    const routes = deriveUnlockRoutes(
      { unlockPriceRaw: "20000000", onChainTraceId: "7" },
      { x402Url: "" },
    );
    const perTrace = routes.find((r) => r.kind === "PER_TRACE");
    expect(perTrace?.available).toBe(false);
    expect(perTrace?.priceRaw).toBe(20_000_000n);
    expect(perTrace?.reason).toMatch(/x402/);
  });

  it("marks the per-trace route unavailable when the trace is not published on-chain", () => {
    const routes = deriveUnlockRoutes(
      { unlockPriceRaw: "20000000", onChainTraceId: null },
      { x402Url: "https://x402.example" },
    );
    const perTrace = routes.find((r) => r.kind === "PER_TRACE");
    expect(perTrace?.available).toBe(false);
    expect(perTrace?.reason).toMatch(/on-chain/);
  });

  it("offers the per-trace route when the service is configured and the trace is published", () => {
    const routes = deriveUnlockRoutes(
      { unlockPriceRaw: "20000000", onChainTraceId: "7" },
      { x402Url: "https://x402.example" },
    );
    expect(routes.find((r) => r.kind === "PER_TRACE")).toEqual({
      kind: "PER_TRACE",
      priceRaw: 20_000_000n,
      available: true,
    });
  });

  it("rejects malformed price strings without throwing", () => {
    const routes = deriveUnlockRoutes(
      { dailyPassPriceRaw: "1.5", unlockPriceRaw: "-5" },
      { x402Url: "https://x402.example", fallbackDailyPassPriceRaw: 1n },
    );
    expect(routes[0].priceRaw).toBe(1n);
    expect(routes[1].priceRaw).toBeNull();
  });
});

describe("deriveDailyPassExpiry", () => {
  it("expires 24h after the newest DAILY_PASS payment", () => {
    const events = [
      payment({ createdAt: "2026-05-31T09:00:00Z", txHash: "1".repeat(64) }),
      payment({ createdAt: "2026-06-01T10:00:00Z", txHash: "2".repeat(64) }),
      payment({ type: "PER_TRACE", createdAt: "2026-06-01T11:00:00Z", txHash: "3".repeat(64) }),
    ];
    const expiry = deriveDailyPassExpiry(events, NOW);
    expect(expiry?.toISOString()).toBe(new Date(Date.parse("2026-06-01T10:00:00Z") + DAILY_PASS_DURATION_MS).toISOString());
  });

  it("returns null once the newest pass has expired", () => {
    const events = [payment({ createdAt: "2026-05-31T09:00:00Z" })];
    expect(deriveDailyPassExpiry(events, NOW)).toBeNull();
  });

  it("returns null with no payments or only unusable entries", () => {
    expect(deriveDailyPassExpiry([], NOW)).toBeNull();
    expect(
      deriveDailyPassExpiry(
        [
          payment({ createdAt: "not-a-date" }),
          payment({ type: "PER_TRACE", createdAt: "2026-06-01T11:00:00Z" }),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("tolerates malformed events without throwing", () => {
    const events = [null, undefined, {} as unknown as PaymentEvent, payment()].filter(Boolean) as PaymentEvent[];
    expect(deriveDailyPassExpiry(events, NOW)).not.toBeNull();
  });
});

describe("formatRoutePrice / formatLockedFields", () => {
  it("formats base units with two decimals and an em dash for null", () => {
    expect(formatRoutePrice(5_000_000n)).toBe("0.50 USDC");
    expect(formatRoutePrice(20_000_000n)).toBe("2.00 USDC");
    expect(formatRoutePrice(null)).toBe("—");
  });

  it("keeps only non-empty string locked fields", () => {
    expect(formatLockedFields(["sourcesUsed", "betSizeUsdc"])).toEqual(["sourcesUsed", "betSizeUsdc"]);
    expect(formatLockedFields(["a", "", 42 as unknown as string])).toEqual(["a"]);
    expect(formatLockedFields(undefined)).toEqual([]);
    expect(formatLockedFields("nope" as unknown as string[])).toEqual([]);
  });
});
