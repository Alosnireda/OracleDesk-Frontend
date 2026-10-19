import { describe, expect, it, vi } from "vitest";
import { Contract, Keypair, nativeToScVal, xdr, type rpc } from "@stellar/stellar-sdk";
import { CONTRACTS } from "../config";
import { decodeTrade, decodeMarketCoreEvent, eventTopicFilter, fetchMarketTrades, marketTopicFilter, tradeTopicFilter, mergeTrades } from "../events";
import { marketCore } from "../clients";
import { priceYesBps } from "../generated/fpmm";
import rawFixtures from "./fixtures/market-core-events.json";

const trader = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
export function tradeFixture(ledger = 100, index = 1): rpc.Api.EventResponse {
  const fields: Record<string, xdr.ScVal> = {
    outcome: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Yes")]), is_buy: nativeToScVal(true),
    collateral: nativeToScVal(10000000n, { type: "i128" }), shares: nativeToScVal(15873015n, { type: "i128" }),
    fee: nativeToScVal(200000n, { type: "i128" }), reserve_yes: nativeToScVal(421n, { type: "i128" }), reserve_no: nativeToScVal(579n, { type: "i128" }),
  };
  return {
    id: `${String(ledger).padStart(19, "0")}-${String(index).padStart(10, "0")}`, type: "contract", ledger,
    ledgerClosedAt: "2026-10-18T12:00:00Z", contractId: new Contract(CONTRACTS.marketCore),
    transactionIndex: 1, operationIndex: 0, inSuccessfulContractCall: true, txHash: "a".repeat(64),
    topic: [xdr.ScVal.scvSymbol("trade"), nativeToScVal(7n, { type: "u64" }), nativeToScVal(trader, { type: "address" })],
    value: xdr.ScVal.scvMap(Object.keys(fields).sort().map(key => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] }))),
  };
}
describe("market contract events", () => {
  it("derives the trade prefix from the pinned spec and encodes market id as scvU64", () => {
    const filter = tradeTopicFilter(7n);
    expect(filter[0]).toBe(tradeFixture().topic[0].toXDR("base64"));
    expect(xdr.ScVal.fromXDR(filter[1], "base64").switch().name).toBe("scvU64");
    expect(filter[2]).toBe("*");
  });
  it("decodes the contract-shaped XDR fixture with exact bigint amounts and implied price", () => {
    const row = decodeTrade(tradeFixture());
    expect(marketCore().spec.parseEvent(tradeFixture().topic, tradeFixture().value)?.name).toBe("Trade");
    expect(row).toMatchObject({ marketId: "7", trader, collateral: 10000000n, shares: 15873015n, fee: 200000n, yesBpsAfter: Number(priceYesBps(421n, 579n)) });
    expect(decodeTrade({ ...tradeFixture(), inSuccessfulContractCall: false })).toBeNull();
  });
  it("widens backward until enough rows are found, using only the selected market topics", async () => {
    const getEvents = vi.fn().mockResolvedValueOnce({ events: [], cursor: "recent" })
      .mockResolvedValueOnce({ events: [tradeFixture(5000), tradeFixture(5001)], cursor: "older" });
    const result = await fetchMarketTrades(7n, { want: 2, server: { getHealth: async () => ({ oldestLedger: 1, latestLedger: 12000, ledgerRetentionWindow: 12000, status: "healthy" }), getEvents } });
    expect(result.trades.map(row => row.ledger)).toEqual([5001, 5000]); expect(result.reachedRetention).toBe(false);
    expect(getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 10001, endLedger: 12001, filters: [{ topics: [tradeTopicFilter(7n)], contractIds: [CONTRACTS.marketCore] }] });
    expect(getEvents.mock.calls[1][0].endLedger).toBe(10001);
  });
  it("reports RPC retention, and aborted reads do not return partial history", async () => {
    const server = { getHealth: async () => ({ oldestLedger: 50, latestLedger: 100, ledgerRetentionWindow: 50, status: "healthy" as const }), getEvents: vi.fn().mockResolvedValue({ events: [], cursor: "end" }) };
    expect((await fetchMarketTrades(7n, { want: 20, server })).reachedRetention).toBe(true);
    const controller = new AbortController(); controller.abort();
    await expect(fetchMarketTrades(7n, { want: 20, server, signal: controller.signal })).rejects.toThrow();
  });
  it("replaces socket copies by event id, retaining separate events from the same transaction", () => {
    const row = decodeTrade(tradeFixture())!;
    const socket = { ...row, origin: "socket" as const, reserveYes: null, reserveNo: null };
    const merged = mergeTrades([socket], [row, decodeTrade(tradeFixture(100, 2))!]);
    expect(merged).toHaveLength(2); expect(merged.every(row => row.origin === "rpc")).toBe(true);
  });
});

interface RawFixture {
  name: string; ledger: number; index: number; ledgerClosedAt: string; txHash: string;
  topics: string[]; value: string; trader: string;
}
const fixtures = rawFixtures as RawFixture[];

function fixtureResponse(fixture: RawFixture, overrides: Partial<rpc.Api.EventResponse> = {}): rpc.Api.EventResponse {
  return {
    id: `${String(fixture.ledger).padStart(19, "0")}-${String(fixture.index).padStart(10, "0")}`,
    type: "contract", ledger: fixture.ledger, ledgerClosedAt: fixture.ledgerClosedAt,
    contractId: new Contract(CONTRACTS.marketCore), transactionIndex: 1, operationIndex: 0,
    inSuccessfulContractCall: true, txHash: fixture.txHash,
    topic: fixture.topics.map(topic => xdr.ScVal.fromXDR(topic, "base64")),
    value: xdr.ScVal.fromXDR(fixture.value, "base64"),
    ...overrides,
  };
}

describe("typed market-core event decoding", () => {
  it("decodes MarketCreated from recorded XDR into the seeded price inputs", () => {
    const decoded = decodeMarketCoreEvent(fixtureResponse(fixtures[0]));
    expect(decoded).toMatchObject({
      kind: "MarketCreated", marketId: 7n, closeTime: 2_000_000_000n,
      seedAmount: 100_000_000n, initialYesBps: 6000,
      meta: { ledger: 100, ledgerClosedAt: fixtures[0].ledgerClosedAt, txHash: fixtures[0].txHash },
    });
    expect(decoded?.kind === "MarketCreated" && decoded.creator).toBe(fixtures[0].trader);
  });

  it("decodes a Trade with exact bigint reserves and derives the same price as priceYesBps", () => {
    const decoded = decodeMarketCoreEvent(fixtureResponse(fixtures[1]));
    expect(decoded).toMatchObject({
      kind: "Trade", marketId: 7n, trader: fixtures[1].trader, outcome: "Yes", isBuy: true,
      collateral: 50_000_000n, shares: 73_529_411n, fee: 12_500n,
      reserveYes: 150_000_000n, reserveNo: 100_000_000n,
    });
    expect(decoded?.kind).toBe("Trade");
    expect(priceYesBps(150_000_000n, 100_000_000n)).toBe(4000n);
  });

  it("decodes resolutions, including the void case as null", () => {
    expect(decodeMarketCoreEvent(fixtureResponse(fixtures[2]))).toMatchObject({ kind: "MarketResolved", outcome: "Yes" });
    expect(decodeMarketCoreEvent(fixtureResponse(fixtures[3]))).toMatchObject({ kind: "MarketResolved", outcome: null });
  });

  it("decodes Redeemed", () => {
    expect(decodeMarketCoreEvent(fixtureResponse(fixtures[4]))).toMatchObject({
      kind: "Redeemed", marketId: 7n, holder: fixtures[4].trader, payout: 73_529_411n,
    });
  });

  it("returns null for other contracts, failed calls and malformed payloads", () => {
    expect(decodeMarketCoreEvent(fixtureResponse(fixtures[1], { inSuccessfulContractCall: false }))).toBeNull();
    const wrongContract = fixtureResponse(fixtures[1], { contractId: new Contract(CONTRACTS.treasury) });
    expect(decodeMarketCoreEvent(wrongContract)).toBeNull();
    const truncated = fixtureResponse(fixtures[1]);
    truncated.value = xdr.ScVal.scvMap([]);
    expect(decodeMarketCoreEvent(truncated)).toBeNull();
  });

  it("builds market-scoped RPC filters for every price-relevant event", () => {
    const filters = marketTopicFilter(7n, ["MarketCreated", "Trade", "MarketResolved"]);
    expect(filters).toHaveLength(3);
    const [created, trade, resolved] = filters.map(filter => filter.topics?.[0]);
    expect(filters[0].contractIds).toEqual([CONTRACTS.marketCore]);
    expect(created).toEqual(eventTopicFilter("MarketCreated", { market_id: 7n }));
    expect(trade).toEqual(tradeTopicFilter(7n));
    expect(resolved).toEqual(eventTopicFilter("MarketResolved", { market_id: 7n }));
  });
});
