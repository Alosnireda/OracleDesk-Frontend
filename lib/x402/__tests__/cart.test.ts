import { describe, expect, it, vi } from "vitest";
import { requestRequirements, unlockTrace } from "../client";
import {
  NOT_ON_CHAIN,
  addToCart,
  planCheckout,
  quoteCart,
  receiptToJson,
  runCheckout,
  type CartItem,
  type CheckoutDeps,
  type PriceChangeChoice,
} from "../cart";
import { OTHER_PAY_TO, PAYER, fakeDeps } from "./fakes";

const trace = (id: string, onChainTraceId: string | null = id) => ({ id: `backend-${id}`, onChainTraceId, market: { question: `Q${id}?` } });

/** A quoted cart over the fake service, plus checkout deps using the real journaled unlock. */
async function setup(prices: Record<string, string>, opts: { decide?: PriceChangeChoice; policy?: CheckoutDeps["policy"] } = {}) {
  const env = fakeDeps();
  let items: CartItem[] = [];
  for (const [id, price] of Object.entries(prices)) {
    env.service.setPrice(id, price);
    items = addToCart(items, trace(id)).items;
  }
  items = await quoteCart(
    items,
    { requestRequirements: (id) => requestRequirements(id, env.deps.transport), network: "stellar:testnet" },
    () => {},
  );
  const decide = vi.fn(async () => opts.decide ?? "accept");
  const checkout: CheckoutDeps = {
    wallet: PAYER,
    network: "stellar:testnet",
    unlock: (item, evaluate) => unlockTrace({ onChainTraceId: item.onChainTraceId, wallet: PAYER, evaluate, payAgainIfExpired: true }, env.deps),
    confirmedTotalRaw: planCheckout(items, { remainingTodayRaw: null, dailyPassPriceRaw: null }).totalRaw,
    decidePriceChange: decide,
    policy: opts.policy,
  };
  return { ...env, items, checkout, decide };
}

describe("unlock cart", () => {
  it("dedupes items by on-chain trace id", () => {
    let items = addToCart([], trace("1")).items;
    items = addToCart(items, { ...trace("1"), id: "another-backend-row" }).items;
    expect(items).toHaveLength(1);
  });

  it("rejects traces without an on-chain id", () => {
    const result = addToCart([], trace("2", null));
    expect(result.error).toBe(NOT_ON_CHAIN);
    expect(result.items).toHaveLength(0);
  });

  it("quotes from the live 402, not the backend hint", async () => {
    const { items } = await setup({ "1": "100000" });
    expect(items[0]).toMatchObject({ status: "ready", quote: { amountRaw: 100_000n } });
  });

  it("recommends the daily pass when the total reaches its price", async () => {
    const { items } = await setup({ "1": "3000000", "2": "3000000" });
    expect(planCheckout(items, { remainingTodayRaw: null, dailyPassPriceRaw: 5_000_000n })).toMatchObject({
      totalRaw: 6_000_000n,
      recommendDailyPass: true,
    });
    expect(planCheckout(items, { remainingTodayRaw: null, dailyPassPriceRaw: 7_000_000n }).recommendDailyPass).toBe(false);
    const split = planCheckout(items, { remainingTodayRaw: 3_000_000n, dailyPassPriceRaw: null });
    expect([split.affordable.length, split.overLimit.length]).toEqual([1, 1]);
  });

  it("pauses on a price increase and resumes after acceptance", async () => {
    const { items, checkout, decide, service } = await setup({ "1": "100000", "2": "100000" });
    service.setPrice("1", "150000");

    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);

    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ onChainTraceId: "1", reason: "price-increased" }), 100_000n, 150_000n);
    expect(receipt.lines.map((l) => [l.status, l.quotedRaw, l.paidRaw])).toEqual([
      ["unlocked", 100_000n, 150_000n],
      ["unlocked", 100_000n, 100_000n],
    ]);
  });

  it("skips an item when the user declines a price increase", async () => {
    const { items, checkout, service, signs } = await setup({ "1": "100000" }, { decide: "skip" });
    service.setPrice("1", "150000");
    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);
    expect(receipt.lines[0]).toMatchObject({ status: "skipped", reason: "price-increased", paidRaw: 0n });
    expect(signs).toHaveLength(0);
  });

  it("never auto-accepts a payTo change", async () => {
    const { items, checkout, decide, service, signs } = await setup({ "1": "100000" });
    service.setPrice("1", "100000", OTHER_PAY_TO);
    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);
    expect(receipt.lines[0]).toMatchObject({ status: "failed", reason: "terms-changed" });
    expect(decide).not.toHaveBeenCalled();
    expect(signs).toHaveLength(0);
  });

  it("skips the remaining items when the policy denies over-daily", async () => {
    let calls = 0;
    const { items, checkout } = await setup(
      { "1": "100000", "2": "100000", "3": "100000" },
      { policy: () => (++calls === 2 ? { allow: false, reason: "over-daily" } : { allow: true }) },
    );
    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);
    expect(receipt.lines.map((l) => [l.status, l.reason])).toEqual([
      ["unlocked", undefined],
      ["skipped", "over-daily"],
      ["skipped", "over-daily"],
    ]);
  });

  it("marks an item failed on hash mismatch after payment and flags it", async () => {
    const { items, checkout, service } = await setup({ "1": "100000" });
    service.paid.push("tampered");
    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);
    expect(receipt.lines[0]).toMatchObject({ status: "failed", reason: "hash-mismatch", paidRaw: 100_000n, needsSupport: true });
    expect(receipt.needsSupport).toBe(true);
  });

  it("treats a 200 on re-request as unlocked without paying", async () => {
    const { items, checkout, service, signs } = await setup({ "1": "100000" });
    service.setFree("1", true);
    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);
    expect(receipt.lines[0]).toMatchObject({ status: "unlocked", paidRaw: 0n });
    expect(signs).toHaveLength(0);
  });

  it("stops after the current item when aborted", async () => {
    const controller = new AbortController();
    const { items, checkout, service } = await setup({ "1": "100000", "2": "100000" });
    service.onPaidRequest = () => controller.abort();
    const receipt = await runCheckout(items, checkout, () => {}, controller.signal);
    expect(receipt.lines.map((l) => [l.status, l.reason])).toEqual([
      ["unlocked", undefined],
      ["skipped", "cancelled"],
    ]);
  });

  it("totals the receipt as the sum of paid amounts in base units", async () => {
    const { items, checkout, service } = await setup({ "1": "100000", "2": "250000", "3": "1" });
    service.paid.push("ok", "502", "502", "502", "502");
    const receipt = await runCheckout(items, checkout, () => {}, new AbortController().signal);
    expect(receipt.lines.map((l) => l.status)).toEqual(["unlocked", "failed", "unlocked"]);
    expect(receipt.totalPaidRaw).toBe(receipt.lines.reduce((sum, l) => sum + l.paidRaw, 0n));
    expect(receipt.totalPaidRaw).toBe(100_001n);
    expect(JSON.parse(receiptToJson(receipt)).totalPaidRaw).toBe("100001");
  });
});
