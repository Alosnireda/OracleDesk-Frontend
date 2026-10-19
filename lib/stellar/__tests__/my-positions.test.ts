import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const decodeValue = vi.fn();
vi.mock("../clients", () => ({
  marketCore: () => ({ spec: { scValToNative: decodeValue } }),
  rpcServer: () => ({ getLedgerEntries: vi.fn() }),
}));

import {
  MAX_POSITION_SCAN_MARKETS,
  positionValue,
  scanHolderPositions,
  withBackendQuestions,
  yesPriceBps,
} from "../my-positions";
import { marketLedgerKey, positionLedgerKey } from "../ledger-entries";

interface FakeEntry {
  key: { toXDR(format: "base64"): string };
  val: { contractData(): { val(): { id: bigint; kind: "Position" | "Market" } } };
  liveUntilLedgerSeq?: number;
}

function fakeEntry(
  key: FakeEntry["key"],
  kind: "Position" | "Market",
  id: bigint,
  liveUntilLedgerSeq?: number,
): FakeEntry {
  return {
    key,
    val: { contractData: () => ({ val: () => ({ kind, id }) }) },
    ...(liveUntilLedgerSeq === undefined ? {} : { liveUntilLedgerSeq }),
  } as FakeEntry;
}

const openMarket = { close_time: 0n, sets_minted: 1n, reserve_yes: 1n, reserve_no: 1n, status: { tag: "Open" } };

describe("my-positions scan", () => {
  beforeEach(() => {
    decodeValue.mockImplementation((value: { id: bigint; kind: string }) =>
      value.kind === "Position"
        ? { yes: 1_000_000n, no: 500_000n }
        : {
            close_time: 0n,
            sets_minted: 1n,
            reserve_yes: 1n,
            reserve_no: 1n,
            status:
              value.id % 2n === 0n
                ? { tag: "Open" }
                : { tag: "Resolved", values: [{ tag: "Yes", values: undefined }] },
          },
    );
  });

  afterEach(() => vi.clearAllMocks());

  it("reads every chunk, keeps non-zero holdings, values them, and sorts newest first", async () => {
    const holder = Keypair.random().publicKey();
    const count = 202n;
    const keyToId = new Map<string, bigint>();
    for (let id = 0n; id < count; id++) {
      keyToId.set(positionLedgerKey(id, holder).toXDR("base64"), id);
      keyToId.set(marketLedgerKey(id).toXDR("base64"), id);
    }
    let requestCount = 0;
    const server = {
      getLedgerEntries: vi.fn(async (...keys: FakeEntry["key"][]) => {
        const isPositionRead = requestCount < 2;
        requestCount += 1;
        const entries = keys
          .map((key) => {
            const id = keyToId.get(key.toXDR("base64"));
            if (id === undefined) return null;
            return fakeEntry(key, isPositionRead ? "Position" : "Market", id);
          })
          .filter((entry): entry is FakeEntry => entry !== null);
        return { entries, latestLedger: 600 };
      }),
    };

    const result = await scanHolderPositions(holder, count, server as never);

    expect(server.getLedgerEntries).toHaveBeenCalledTimes(4);
    expect(server.getLedgerEntries.mock.calls.map(([...keys]) => keys.length)).toEqual([200, 2, 200, 2]);
    expect(result.scannedMarkets).toBe(count);
    expect(result.positions).toHaveLength(Number(count));
    // Newest first.
    expect(result.positions[0].marketId).toBe(201n);
    expect(result.positions[201].marketId).toBe(0n);
    // Odd IDs resolve YES: payout is the 1,000,000 YES shares.
    expect(result.positions[0]).toMatchObject({ settlement: "yes", valueRaw: 1_000_000n, yesBps: null });
    // Even IDs stay open: 666,666 NO + 333,333 YES at reserves (1,1) → bps 5000.
    expect(result.positions[1]).toMatchObject({ settlement: null, yesBps: 5000, valueRaw: 750_000n });
    expect(result.scanLimited).toBe(false);
  });

  it("skips empty positions and marks rows whose market entry is unreadable", async () => {
    const holder = Keypair.random().publicKey();
    const count = 3n;
    const positionIds = new Map<string, bigint>();
    const marketIds = new Map<string, bigint>();
    for (let id = 0n; id < count; id++) {
      positionIds.set(positionLedgerKey(id, holder).toXDR("base64"), id);
      marketIds.set(marketLedgerKey(id).toXDR("base64"), id);
    }
    let requestCount = 0;
    const server = {
      getLedgerEntries: vi.fn(async (...keys: FakeEntry["key"][]) => {
        const map = requestCount === 0 ? positionIds : marketIds;
        const isPositionRead = requestCount === 0;
        requestCount += 1;
        // Only id 1 returns a position entry; id 0 is zeroed, id 2 has no
        // entry. The market read returns nothing for id 1 (unreadable).
        const entries = keys
          .map((key) => {
            const id = map.get(key.toXDR("base64"));
            if (id === undefined) return null;
            if (isPositionRead && id !== 1n) return null;
            if (!isPositionRead) return null;
            return fakeEntry(key, "Position", id);
          })
          .filter((entry): entry is FakeEntry => entry !== null);
        return { entries, latestLedger: 600 };
      }),
    };

    decodeValue.mockImplementation((value: { kind: string }) =>
      value.kind === "Position" ? { yes: 0n, no: 0n } : openMarket,
    );

    const result = await scanHolderPositions(holder, count, server as never);

    // id 1 holds shares but its market entry is missing → row kept, value null.
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({ marketId: 1n, market: null, settlement: null, valueRaw: null });
  });

  it("caps huge scans to the newest market IDs", async () => {
    const server = { getLedgerEntries: vi.fn(async () => ({ entries: [], latestLedger: 1 })) };
    const result = await scanHolderPositions(Keypair.random().publicKey(), 50_000n, server as never);
    expect(result.scannedMarkets).toBe(MAX_POSITION_SCAN_MARKETS);
    expect(result.totalMarkets).toBe(50_000n);
    expect(result.scanLimited).toBe(true);
    expect(server.getLedgerEntries).toHaveBeenCalledTimes(100);
  });
});

describe("my-positions valuation", () => {
  it("prices YES from reserves, clamps to [0, 10000], and returns null when empty", () => {
    expect(yesPriceBps({ reserve_yes: 1n, reserve_no: 3n })).toBe(7_500n);
    expect(yesPriceBps({ reserve_yes: 0n, reserve_no: 0n })).toBeNull();
  });

  it("marks open positions at the live price and settled positions at their payout", () => {
    const open = { ...openMarket, reserve_yes: 1n, reserve_no: 3n };
    expect(positionValue({ yes: 2n, no: 2n }, open)).toEqual({ valueRaw: 2_500n, yesBps: 7500 });
    const resolvedNo = { ...openMarket, status: { tag: "Resolved", values: [{ tag: "No", values: undefined }] } };
    expect(positionValue({ yes: 2n, no: 2n }, resolvedNo)).toEqual({ valueRaw: 2n, yesBps: null });
    const voided = { ...openMarket, status: { tag: "Void" } };
    expect(positionValue({ yes: 2n, no: 2n }, voided)).toEqual({ valueRaw: 2n, yesBps: null });
  });
});

describe("my-positions backend join", () => {
  it("joins question text by decimal on-chain id and leaves unknown ids null", () => {
    const rows = withBackendQuestions(
      [{ marketId: 7n }, { marketId: 8n }],
      [{ onChainMarketId: "7", question: "Will it ship?" }],
    );
    expect(rows).toEqual([
      { marketId: 7n, question: "Will it ship?" },
      { marketId: 8n, question: null },
    ]);
  });
});
