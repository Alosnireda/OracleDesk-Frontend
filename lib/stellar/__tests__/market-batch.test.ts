import { describe, expect, it, vi } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { marketCore } from "../clients";
import { CONTRACTS } from "../config";
import { createMarketBatcher, decodeMarket, type BatchedMarketView } from "../market-batch";
import { marketKey } from "../ledger-keys";
import type { Market } from "../generated/market-core";

const spec = marketCore().spec;
const CREATOR = "GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF";

function market(overrides: Partial<Market> = {}): Market {
  return {
    category: { tag: "Crypto", values: undefined },
    close_time: 2_000n,
    creator: CREATOR,
    fee_bps: 30,
    fees_accrued: 0n,
    lp_claimed: false,
    meta_uri: "ipfs://question",
    question_hash: Buffer.alloc(32, 1),
    reserve_no: 300n,
    reserve_yes: 100n,
    resolution_hash: Buffer.alloc(32, 2),
    sets_minted: 400n,
    status: { tag: "Open", values: undefined },
    ...overrides,
  };
}

function marketScVal(value: Market): xdr.ScVal {
  return spec.nativeToScVal(value, xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "Market" })));
}

interface FakeLedgerEntry {
  key: xdr.LedgerKey;
  val: xdr.LedgerEntryData;
  liveUntilLedgerSeq?: number;
}

function fakeEntry(key: xdr.LedgerKey, value: xdr.ScVal, liveUntil?: number): FakeLedgerEntry {
  return {
    key,
    val: { contractData: () => ({ val: () => value }) },
    ...(liveUntil === undefined ? {} : { liveUntilLedgerSeq: liveUntil }),
  } as unknown as FakeLedgerEntry;
}

function fallbackView(id: bigint): BatchedMarketView {
  return { id: id.toString(), market: market(), yesBps: 2_500, ledger: 12 };
}

const idsFromRequest = (keys: xdr.LedgerKey[]): bigint[] => {
  const byKey = new Map<string, bigint>();
  for (let id = 0n; id <= 1_000n; id++) {
    byKey.set(marketKey(spec, id, CONTRACTS.marketCore).toXDR("base64"), id);
  }
  return keys.map((key) => {
    const id = byKey.get(key.toXDR("base64"));
    if (id === undefined) throw new Error("unexpected key");
    return id;
  });
};

describe("market ledger-entry batcher", () => {
  it("coalesces same-tick loads into one getLedgerEntries request", async () => {
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => {
      const ids = idsFromRequest(keys);
      return {
        entries: ids.map((id) => fakeEntry(marketKey(spec, id, CONTRACTS.marketCore), marketScVal(market()), 9_000)),
        latestLedger: 777,
      };
    });
    const batcher = createMarketBatcher({
      server: { getLedgerEntries },
      spec,
      fallback: async (id) => fallbackView(id),
    });

    const [a, b] = await Promise.all([batcher.load(0n), batcher.load(1n)]);
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries.mock.calls[0]).toHaveLength(2);
    expect(a.via).toBe("ledger-entry");
    expect(a.ledger).toBe(777);
    expect(a.liveUntil).toBe(9_000);
    expect(a.view.yesBps).toBe(7_500);
    expect(b.view.market.creator).toBe(CREATOR);
  });

  it("splits 450 ids into 200/200/50-key requests", async () => {
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: keys.map((key) => fakeEntry(key, marketScVal(market()))),
      latestLedger: 100,
    }));
    const batcher = createMarketBatcher({
      server: { getLedgerEntries },
      spec,
      fallback: async (id) => fallbackView(id),
    });
    const ids = Array.from({ length: 450 }, (_, index) => BigInt(index));
    const results = await batcher.loadMany(ids);

    expect(results.size).toBe(450);
    expect(getLedgerEntries).toHaveBeenCalledTimes(3);
    const sizes = getLedgerEntries.mock.calls.map((call) => call.length);
    expect(sizes).toEqual([200, 200, 50]);
  });

  it("maps unordered responses by key and decodes Resolved(Yes)", async () => {
    const resolved = market({
      reserve_yes: 0n,
      reserve_no: 0n,
      status: { tag: "Resolved", values: [{ tag: "Yes", values: undefined }] },
    });
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => {
      const ids = idsFromRequest(keys);
      return {
        entries: [...ids]
          .reverse()
          .map((id) => fakeEntry(marketKey(spec, id, CONTRACTS.marketCore), marketScVal(resolved))),
        latestLedger: 555,
      };
    });
    const batcher = createMarketBatcher({
      server: { getLedgerEntries },
      spec,
      fallback: async (id) => fallbackView(id),
    });
    const results = await batcher.loadMany([0n, 1n, 2n]);
    for (const id of ["0", "1", "2"]) {
      const item = results.get(id);
      expect(item).not.toBeInstanceOf(Error);
      if (item && !(item instanceof Error)) {
        expect(item.view.market.status).toEqual({ tag: "Resolved", values: [{ tag: "Yes", values: undefined }] });
        expect(item.view.yesBps).toBe(0);
        expect(item.ledger).toBe(555);
      }
    }
  });

  it("falls back to simulation for entries the RPC omits", async () => {
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: [fakeEntry(keys[0], marketScVal(market()))],
      latestLedger: 50,
    }));
    const fallback = vi.fn(async (id: bigint) => fallbackView(id));
    const batcher = createMarketBatcher({ server: { getLedgerEntries }, spec, fallback });

    const [found, missing] = await Promise.all([batcher.load(0n), batcher.load(1n)]);
    expect(found.via).toBe("ledger-entry");
    expect(missing.via).toBe("simulation");
    expect(fallback).toHaveBeenCalledWith(1n);
    expect(missing.ledger).toBe(12);
  });

  it("rejects an entry whose decoded market is malformed", async () => {
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: [fakeEntry(keys[0], xdr.ScVal.scvVoid())],
      latestLedger: 1,
    }));
    const batcher = createMarketBatcher({
      server: { getLedgerEntries },
      spec,
      fallback: async (id) => fallbackView(id),
    });
    await expect(batcher.load(0n)).rejects.toThrow();
  });

  it("shares one key and one promise for duplicate ids", async () => {
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: [fakeEntry(keys[0], marketScVal(market()))],
      latestLedger: 1,
    }));
    const batcher = createMarketBatcher({
      server: { getLedgerEntries },
      spec,
      fallback: async (id) => fallbackView(id),
    });
    const first = batcher.load(5n);
    const second = batcher.load(5n);
    expect(first).toBe(second);
    await first;
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries.mock.calls[0]).toHaveLength(1);
  });
});

describe("decodeMarket", () => {
  it("requires every field from the generated Market interface", () => {
    const partial = xdr.ScVal.scvMap([]);
    const entry = { contractData: () => ({ val: () => partial }) } as unknown as xdr.LedgerEntryData;
    expect(() => decodeMarket(spec, entry)).toThrow(/missing|Market/i);
  });
});
