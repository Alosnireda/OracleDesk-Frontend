import { describe, expect, it, vi } from "vitest";
import { Contract, xdr, type rpc } from "@stellar/stellar-sdk";
import { CONTRACTS } from "../config";
import { type DecodedEvent, type EventMeta } from "../events";
import {
  appendEvents,
  buildSeries,
  coverageOf,
  deserializePoints,
  loadPriceHistory,
  readSeriesCache,
  rpcPriceHistorySource,
  seriesCacheKey,
  serializePoints,
  writeSeriesCache,
} from "../price-history";
import { priceYesBps, seedReserves } from "../generated/fpmm";
import rawFixtures from "./fixtures/market-core-events.json";

const TRADER = (rawFixtures[1] as { trader: string }).trader;
const meta = (id: string, ledger: number, closedAt = "2026-01-01T00:00:00Z"): EventMeta =>
  ({ id, ledger, ledgerClosedAt: closedAt, txHash: "ab".repeat(32) });

const created = (id: string, ledger: number, initialYesBps = 6000, seedAmount = 100_000_000n): DecodedEvent =>
  ({ kind: "MarketCreated", marketId: 7n, creator: TRADER, closeTime: 2_000_000_000n, seedAmount, initialYesBps, meta: meta(id, ledger) });

const trade = (id: string, ledger: number, reserveYes: bigint, reserveNo: bigint, closedAt?: string): DecodedEvent =>
  ({ kind: "Trade", marketId: 7n, trader: TRADER, outcome: "Yes", isBuy: true, collateral: 1n, shares: 1n, fee: 0n,
    reserveYes, reserveNo, meta: meta(id, ledger, closedAt) });

const resolved = (id: string, ledger: number, outcome: "Yes" | "No" | null): DecodedEvent =>
  ({ kind: "MarketResolved", marketId: 7n, outcome, meta: meta(id, ledger) });

function fixtureResponse(index: number, ledger: number, idSuffix = "0000000001"): rpc.Api.EventResponse {
  const fixture = rawFixtures[index] as { ledger: number; index: number; ledgerClosedAt: string; txHash: string; topics: string[]; value: string };
  return {
    id: `${String(ledger).padStart(19, "0")}-${idSuffix}`,
    type: "contract", ledger, ledgerClosedAt: fixture.ledgerClosedAt,
    contractId: new Contract(CONTRACTS.marketCore), transactionIndex: 1, operationIndex: 0,
    inSuccessfulContractCall: true, txHash: fixture.txHash,
    topic: fixture.topics.map(topic => xdr.ScVal.fromXDR(topic, "base64")),
    value: xdr.ScVal.fromXDR(fixture.value, "base64"),
  };
}

describe("buildSeries", () => {
  it("orders same-ledger trades by event id and de-duplicates by id", () => {
    const events = [trade("0010-0000000002", 10, 800n, 200n), trade("0010-0000000001", 10, 600n, 400n), trade("0010-0000000001", 10, 600n, 400n)];
    const points = buildSeries(events);
    expect(points.map(point => point.eventId)).toEqual(["0010-0000000001", "0010-0000000002"]);
    expect(points[0].yesBps).toBe(4000n);
    expect(points[1].yesBps).toBe(2000n);
  });

  it("matches priceYesBps exactly on post-trade reserves", () => {
    const points = buildSeries([trade("t1", 5, 421n, 579n)]);
    expect(points).toHaveLength(1);
    expect(points[0].yesBps).toBe(priceYesBps(421n, 579n));
    expect(typeof points[0].yesBps).toBe("bigint");
    expect(points[0].kind).toBe("trade");
  });

  it("starts at the seeded price when MarketCreated is present", () => {
    const points = buildSeries([created("m1", 1)]);
    const seed = seedReserves(100_000_000n, 6000n);
    expect(points).toHaveLength(1);
    expect(points[0].kind).toBe("open");
    expect(points[0].yesBps).toBe(priceYesBps(seed.reserveYes, seed.reserveNo));
  });

  it("falls back to the raw initial price when the seed math throws", () => {
    const points = buildSeries([created("m1", 1, 6000, 0n)]);
    expect(points[0].yesBps).toBe(6000n);
  });

  it("renders a void resolution as 5000 bps and keeps resolutions out of trade counts", () => {
    const points = buildSeries([resolved("r1", 9, null), resolved("r2", 10, "Yes"), resolved("r3", 11, "No")]);
    expect(points.map(point => [point.kind, point.yesBps])).toEqual([["resolved", 5000n], ["resolved", 10_000n], ["resolved", 0n]]);
  });

  it("skips a zero-reserve trade instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const points = buildSeries([trade("t1", 5, 0n, 0n), trade("t2", 6, 300n, 700n)]);
    expect(points).toHaveLength(1);
    expect(points[0].eventId).toBe("t2");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("takes point times from ledger close time", () => {
    const points = buildSeries([trade("t1", 5, 300n, 700n, "2026-03-10T12:34:56.789Z")]);
    expect(points[0].time).toBe(Date.parse("2026-03-10T12:34:56Z") / 1000);
  });
});

describe("appendEvents", () => {
  it("de-duplicates by event id and returns the same array when nothing is new", () => {
    const base = buildSeries([created("m1", 1), trade("t1", 5, 300n, 700n)]);
    const merged = appendEvents(base, [trade("t1", 5, 300n, 700n), trade("t2", 6, 400n, 600n)]);
    expect(merged).toHaveLength(3);
    expect(merged[2].eventId).toBe("t2");
    expect(appendEvents(merged, [trade("t2", 6, 400n, 600n)])).toBe(merged);
  });

  it("keeps ledger-then-id order across an out-of-order append", () => {
    const base = buildSeries([trade("b2", 8, 300n, 700n)]);
    const merged = appendEvents(base, [trade("a1", 3, 500n, 500n)]);
    expect(merged.map(point => point.eventId)).toEqual(["a1", "b2"]);
  });
});

describe("coverageOf", () => {
  it("is partial when the opening event is missing and complete when it is present", () => {
    expect(coverageOf(buildSeries([trade("t1", 5, 300n, 700n)]), { toLedger: 100 }))
      .toMatchObject({ complete: false, reason: "partial", fromLedger: 5, toLedger: 100 });
    expect(coverageOf(buildSeries([created("m1", 1), trade("t1", 5, 300n, 700n)]), { toLedger: 100 }))
      .toMatchObject({ complete: true, fromLedger: 1 });
  });

  it("reports retention gaps", () => {
    expect(coverageOf(buildSeries([created("m1", 1)]), { toLedger: 100, retention: true }))
      .toMatchObject({ complete: false, reason: "retention" });
  });
});

describe("serialization", () => {
  it("round-trips bigint prices through strings", () => {
    const points = buildSeries([created("m1", 1), trade("t1", 5, 421n, 579n)]);
    expect(deserializePoints(serializePoints(points))).toEqual(points);
  });

  it("keys the cache by network passphrase and market-core contract id", () => {
    const key = seriesCacheKey(7n);
    expect(key).toContain(CONTRACTS.marketCore);
    expect(key.split("|")).toHaveLength(3);
    expect(seriesCacheKey("7")).toBe(key);
  });

  it("degrades to memory when IndexedDB is unavailable", async () => {
    await expect(readSeriesCache(seriesCacheKey(7n))).resolves.toBeNull();
    await expect(writeSeriesCache(seriesCacheKey(7n), { v: 1, points: [], cursor: null, toLedger: 0, coverage: { fromLedger: 0, toLedger: 0, complete: true } })).resolves.toBe(false);
  });
});

interface FakePage { events: rpc.Api.EventResponse[]; cursor: string }
interface GetEventsParams { cursor?: string; startLedger?: number; endLedger?: number; filters?: unknown; limit?: number }

function fakeServer(pages: FakePage[], oldestLedger = 1, latestLedger = 1000) {
  let cursorSeen = "";
  const getEvents = vi.fn().mockImplementation(async (params: GetEventsParams) => {
    const index = cursorSeen === "" ? 0 : pages.findIndex(page => page.cursor === cursorSeen) + 1;
    const page = pages[Math.min(index, pages.length - 1)] ?? { events: [], cursor: "end" };
    cursorSeen = page.cursor;
    if (params.cursor && params.cursor === "stale-cursor") throw new Error("startLedger must be within the ledger range: oldest is 1000");
    return page;
  });
  return {
    getHealth: async () => ({ oldestLedger, latestLedger, ledgerRetentionWindow: latestLedger - oldestLedger, status: "healthy" as const }),
    getEvents,
  };
}

describe("rpcPriceHistorySource", () => {
  it("pages from the retention edge and decodes only this market's events", async () => {
    const server = fakeServer([{ events: [fixtureResponse(1, 10), fixtureResponse(1, 11, "0000000002")], cursor: "c1" }]);
    const source = rpcPriceHistorySource(server);
    const batch = await source.load(7n);
    expect(server.getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 1, endLedger: 1001 });
    expect(batch.events).toHaveLength(2);
    expect(batch.events[0].kind).toBe("Trade");
    expect(batch.cursor).toBe("c1");
    expect(batch.coverage).toMatchObject({ complete: true, fromLedger: 10, toLedger: 1000 });
  });

  it("clamps a cursor below the retention edge, restarts at oldestLedger and reports the gap", async () => {
    const server = fakeServer([{ events: [], cursor: "fresh" }]);
    const source = rpcPriceHistorySource(server);
    const batch = await source.load(7n, { cursor: "stale-cursor", toLedger: 10 });
    const lastCall = server.getEvents.mock.calls.at(-1)![0];
    expect(lastCall).toMatchObject({ startLedger: 1, endLedger: 1001 });
    expect(lastCall.cursor).toBeUndefined();
    expect(batch.coverage).toMatchObject({ complete: false, reason: "retention" });
  });

  it("treats a cached cursor that merely points at no new events as complete", async () => {
    const server = fakeServer([{ events: [], cursor: "same" }]);
    server.getEvents.mockResolvedValueOnce({ events: [], cursor: "same" });
    const source = rpcPriceHistorySource(server);
    const batch = await source.load(7n, { cursor: "same", toLedger: 1000 });
    expect(batch.coverage).toMatchObject({ complete: true });
  });

  it("stops at the page cap and returns the last cursor", async () => {
    const server = fakeServer([
      { events: [fixtureResponse(1, 10)], cursor: "p1" },
      { events: [fixtureResponse(1, 11, "0000000002")], cursor: "p2" },
      { events: [fixtureResponse(1, 12, "0000000003")], cursor: "p3" },
    ]);
    const source = rpcPriceHistorySource(server, { pageLimit: 1, maxPages: 2 });
    const batch = await source.load(7n);
    expect(server.getEvents).toHaveBeenCalledTimes(2);
    expect(batch.events).toHaveLength(2);
    expect(batch.cursor).toBe("p2");
  });

  it("uses the cursor instead of a ledger range once resuming", async () => {
    const server = fakeServer([{ events: [], cursor: "next" }]);
    server.getEvents.mockResolvedValueOnce({ events: [], cursor: "next" });
    const source = rpcPriceHistorySource(server);
    await source.load(7n, { cursor: "next", toLedger: 1000 });
    expect(server.getEvents.mock.calls[0][0]).toMatchObject({ cursor: "next" });
    expect(server.getEvents.mock.calls[0][0].startLedger).toBeUndefined();
  });
});

describe("loadPriceHistory", () => {
  it("serves the second open from the cursor with a single getEvents call", async () => {
    const server = fakeServer([{ events: [fixtureResponse(0, 1), fixtureResponse(1, 10)], cursor: "c1" },
      { events: [], cursor: "c2" }]);
    const source = rpcPriceHistorySource(server);
    const first = await loadPriceHistory(7n, { source, cacheKey: "memory-test" });
    expect(first.points[0].kind).toBe("open");
    expect(first.points[1].kind).toBe("trade");
    const callsAfterFirst = server.getEvents.mock.calls.length;

    const second = await loadPriceHistory(7n, { source, cacheKey: "memory-test" });
    expect(server.getEvents.mock.calls.length - callsAfterFirst).toBe(1);
    expect(second.points).toEqual(first.points);
    expect(second.coverage).toMatchObject({ complete: true });
  });

  it("keeps the opening point across an incremental append", async () => {
    const server = fakeServer([{ events: [fixtureResponse(0, 1), fixtureResponse(1, 10)], cursor: "c1" },
      { events: [fixtureResponse(1, 11, "0000000009")], cursor: "c2" }]);
    const source = rpcPriceHistorySource(server);
    const first = await loadPriceHistory(7n, { source, cacheKey: "memory-test-2" });
    expect(first.points).toHaveLength(2);
    const second = await loadPriceHistory(7n, { source, cacheKey: "memory-test-2" });
    expect(second.points).toHaveLength(3);
    expect(second.points[0].kind).toBe("open");
  });
});
