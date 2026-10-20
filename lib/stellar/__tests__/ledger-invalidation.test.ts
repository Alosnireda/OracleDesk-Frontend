import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { LedgerInvalidator } from "../ledger-invalidation";
import { CONTRACTS } from "../config";
import type { rpc } from "@stellar/stellar-sdk";

describe("LedgerInvalidator", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries");
  });

  it("handles gap > 120 ledgers by skipping event querying and performing broad invalidation", async () => {
    const getEvents = vi.fn();
    const invalidator = new LedgerInvalidator({
      queryClient,
      server: { getEvents },
      getUserAddress: () => "GUSER123",
    });

    // Initial ledger sets baseline
    await invalidator.handleNewLedger(100);
    expect(invalidator.lastSeen).toBe(100);
    expect(getEvents).not.toHaveBeenCalled();

    // Large jump: 100 -> 300 (> 120 ledgers)
    const result = await invalidator.handleNewLedger(300);
    expect(result.gapTriggered).toBe(true);
    expect(getEvents).not.toHaveBeenCalled();
    expect(invalidator.lastSeen).toBe(300);

    // Broad invalidation verified
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stellar"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["markets"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["positions"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["portfolio"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["traces"] });
  });

  it("ignores older or equal ledger sequences", async () => {
    const getEvents = vi.fn();
    const invalidator = new LedgerInvalidator({
      queryClient,
      server: { getEvents },
    });

    await invalidator.handleNewLedger(100);
    await invalidator.handleNewLedger(100); // equal
    await invalidator.handleNewLedger(90);  // older

    expect(getEvents).not.toHaveBeenCalled();
    expect(invalidator.lastSeen).toBe(100);
  });

  it("queries getEvents for range [lastSeen + 1, current + 1] when gap <= 120", async () => {
    const getEvents = vi.fn().mockResolvedValue({ events: [] });
    const invalidator = new LedgerInvalidator({
      queryClient,
      server: { getEvents },
    });

    await invalidator.handleNewLedger(100);
    await invalidator.handleNewLedger(105);

    expect(getEvents).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledWith({
      startLedger: 101,
      endLedger: 106,
      filters: [
        { type: "contract", contractIds: [CONTRACTS.marketCore] },
        { type: "contract", contractIds: [CONTRACTS.usdc] },
      ],
    });
    expect(invalidator.lastSeen).toBe(105);
  });

  it("invalidates market queries when a trade occurs", () => {
    const invalidator = new LedgerInvalidator({
      queryClient,
      marketCoreId: "CCONTRACT_MARKET",
      usdcId: "CCONTRACT_USDC",
    });

    // Synthetic fallback event with trade keyword
    const syntheticTradeEvent = {
      type: "contract" as const,
      ledger: 101,
      ledgerClosedAt: "2026-05-14T10:00:00Z",
      contractId: "CCONTRACT_MARKET",
      id: "evt-1",
      pagingToken: "token-1",
      inSuccessfulContractCall: true,
      topic: ["Trade", "market_42"],
      value: "",
      txHash: "tx-trade-hash",
    } as unknown as rpc.Api.EventResponse;

    const summary = invalidator.invalidateForEvents([syntheticTradeEvent], "GUSER");
    expect(summary.invalidatedKeys).toContainEqual(["markets"]);
    expect(summary.invalidatedKeys).toContainEqual(["stellar", "markets"]);
  });

  it("invalidates user USDC balance when user address appears in a USDC event", () => {
    const userAddress = "GUSER_ADDRESS_STELLAR";
    const invalidator = new LedgerInvalidator({
      queryClient,
      marketCoreId: "CCONTRACT_MARKET",
      usdcId: "CCONTRACT_USDC",
    });

    const syntheticUsdcEvent = {
      type: "contract" as const,
      ledger: 102,
      ledgerClosedAt: "2026-05-14T10:00:05Z",
      contractId: "CCONTRACT_USDC",
      id: "evt-usdc-1",
      pagingToken: "token-2",
      inSuccessfulContractCall: true,
      topic: ["transfer", "GOTHER_ADDRESS", userAddress],
      value: "1000000",
      txHash: "tx-usdc-hash",
    } as unknown as rpc.Api.EventResponse;

    const summary = invalidator.invalidateForEvents([syntheticUsdcEvent], userAddress);
    expect(summary.invalidatedKeys).toContainEqual(["stellar", "usdcBalance", userAddress]);
    expect(summary.invalidatedKeys).toContainEqual(["usdcBalance", userAddress]);
  });
});
