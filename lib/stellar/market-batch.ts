import { xdr } from "@stellar/stellar-sdk";
import type { Spec } from "@stellar/stellar-sdk/contract";
import { priceYesBps } from "./generated/fpmm";
import type { Market } from "./generated/market-core";
import { marketKey } from "./ledger-keys";

/** The subset of the market view the batcher produces. Kept structural so the
 * hook layer can re-use its own OnChainMarketView without a cycle. */
export interface BatchedMarketView {
  id: string;
  market: Market;
  yesBps: number;
  ledger: number | null;
}

export interface BatchedMarket {
  view: BatchedMarketView;
  /** Ledger the entry (or fallback simulation) was read at. */
  ledger: number;
  /** Persistent-entry TTL from getLedgerEntries, when the RPC supplied it. */
  liveUntil: number | null;
  via: "ledger-entry" | "simulation";
}

interface LedgerEntryServer {
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{
    entries: Array<{
      key: xdr.LedgerKey | string;
      val: xdr.LedgerEntryData;
      liveUntilLedgerSeq?: number;
    }>;
    latestLedger: number;
  }>;
}

export interface MarketBatcherDeps {
  server: LedgerEntryServer;
  spec: Spec;
  /** The existing simulation read, used for missing/archived entries and the
   * binding's own MarketNotFound error. */
  fallback: (id: bigint) => Promise<BatchedMarketView>;
  maxKeys?: number;
}

export interface MarketBatcher {
  load(id: bigint): Promise<BatchedMarket>;
  loadMany(ids: readonly bigint[]): Promise<Map<string, BatchedMarket | Error>>;
}

const MARKET_FIELDS = [
  "category",
  "close_time",
  "creator",
  "fee_bps",
  "fees_accrued",
  "lp_claimed",
  "meta_uri",
  "question_hash",
  "reserve_no",
  "reserve_yes",
  "resolution_hash",
  "sets_minted",
  "status",
] as const;

/** Decode one contract-data entry as market-core's Market. Throws when the
 * shape no longer matches the binding rather than returning undefined reserves. */
export function decodeMarket(spec: Spec, entry: xdr.LedgerEntryData): Market {
  const value = entry.contractData().val();
  const market = spec.scValToNative<Market>(value, specUdt("Market"));
  if (!market || typeof market !== "object") throw new Error("Decoded Market is not an object");
  const record = market as unknown as Record<string, unknown>;
  const missing = MARKET_FIELDS.filter((field) => !(field in record));
  if (missing.length) throw new Error(`Decoded Market is missing ${missing.join(", ")}`);
  return market;
}

function specUdt(name: string) {
  return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
}

const keyOf = (key: xdr.LedgerKey | string): string =>
  typeof key === "string" ? key : key.toXDR("base64");

/** Resolved/void markets can have zero reserves; that has no YES price, but it
 * must not fail the whole batch. */
function yesBpsOrZero(market: Market): number {
  const total = market.reserve_yes + market.reserve_no;
  if (total <= 0n) return 0;
  return Number(priceYesBps(market.reserve_yes, market.reserve_no));
}

/**
 * Coalesces `load(id)` calls made in the same tick into getLedgerEntries
 * requests of at most 200 keys. RPC responses are matched by LedgerKey, not by
 * order, and entries the RPC omits fall back to simulation.
 */
export function createMarketBatcher(deps: MarketBatcherDeps): MarketBatcher {
  const maxKeys = Math.min(200, Math.max(1, deps.maxKeys ?? 200));
  const waiting = new Map<string, { id: bigint; resolve(value: BatchedMarket): void; reject(error: unknown): void }>();
  const inFlight = new Map<string, Promise<BatchedMarket>>();
  let queue: bigint[] = [];
  let scheduled = false;

  const settle = (id: bigint, result: { ok: true; value: BatchedMarket } | { ok: false; error: unknown }) => {
    const item = waiting.get(id.toString());
    if (!item) return;
    waiting.delete(id.toString());
    if (result.ok) item.resolve(result.value);
    else item.reject(result.error);
  };

  async function flush() {
    scheduled = false;
    const batch = queue;
    queue = [];
    const unique = [...new Map(batch.map((id) => [id.toString(), id])).values()];

    for (let start = 0; start < unique.length; start += maxKeys) {
      const ids = unique.slice(start, start + maxKeys);
      const keys = ids.map((id) => ({ id, key: marketKey(deps.spec, id) }));
      let response: Awaited<ReturnType<LedgerEntryServer["getLedgerEntries"]>>;
      try {
        response = await deps.server.getLedgerEntries(...keys.map(({ key }) => key));
      } catch (error) {
        for (const id of ids) settle(id, { ok: false, error });
        continue;
      }

      const requested = new Map(keys.map(({ id, key }) => [key.toXDR("base64"), id]));
      const decoded = new Map<bigint, { market: Market; liveUntil: number | null }>();
      const failed = new Map<bigint, unknown>();

      for (const entry of response.entries) {
        const id = requested.get(keyOf(entry.key));
        if (id === undefined) continue;
        try {
          decoded.set(id, {
            market: decodeMarket(deps.spec, entry.val),
            liveUntil: entry.liveUntilLedgerSeq ?? null,
          });
        } catch (error) {
          failed.set(id, error);
        }
      }

      for (const id of ids) {
        const error = failed.get(id);
        if (error !== undefined) {
          settle(id, { ok: false, error });
          continue;
        }
        const found = decoded.get(id);
        if (found) {
          settle(id, {
            ok: true,
            value: {
              view: {
                id: id.toString(),
                market: found.market,
                yesBps: yesBpsOrZero(found.market),
                ledger: response.latestLedger,
              },
              ledger: response.latestLedger,
              liveUntil: found.liveUntil,
              via: "ledger-entry",
            },
          });
          continue;
        }
        try {
          const view = await deps.fallback(id);
          settle(id, {
            ok: true,
            value: {
              view: { ...view, ledger: view.ledger ?? response.latestLedger },
              ledger: view.ledger ?? response.latestLedger,
              liveUntil: null,
              via: "simulation",
            },
          });
        } catch (fallbackError) {
          settle(id, { ok: false, error: fallbackError });
        }
      }
    }
  }

  function load(id: bigint): Promise<BatchedMarket> {
    const key = id.toString();
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = new Promise<BatchedMarket>((resolve, reject) => {
      waiting.set(key, { id, resolve, reject });
      queue.push(id);
      if (!scheduled) {
        scheduled = true;
        if (typeof queueMicrotask === "function") queueMicrotask(() => void flush());
        else setTimeout(() => void flush(), 0);
      }
    });
    inFlight.set(key, promise);
    void promise.finally(() => inFlight.delete(key)).catch(() => {});
    return promise;
  }

  async function loadMany(ids: readonly bigint[]): Promise<Map<string, BatchedMarket | Error>> {
    const unique = [...new Map(ids.map((id) => [id.toString(), id])).values()];
    const results = await Promise.all(
      unique.map(async (id): Promise<[string, BatchedMarket | Error]> => {
        try {
          return [id.toString(), await load(id)];
        } catch (error) {
          return [id.toString(), error instanceof Error ? error : new Error(String(error))];
        }
      }),
    );
    return new Map(results);
  }

  return { load, loadMany };
}
