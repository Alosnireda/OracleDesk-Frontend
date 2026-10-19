import type { rpc } from "@stellar/stellar-sdk";
import { marketCore, rpcServer, type OutcomeTag } from "./clients";
import { CONTRACTS, RPC_URL } from "./config";
import { priceYesBps } from "./generated/fpmm";

export interface TradeRow {
  id: string; ledger: number; closedAt: string | null; txHash: string;
  marketId: string; trader: string; outcome: OutcomeTag; isBuy: boolean;
  collateral: bigint; shares: bigint; fee: bigint; yesBpsAfter: number;
  reserveYes: bigint | null; reserveNo: bigint | null; origin: "rpc" | "socket";
}
export interface ChainEvent {
  id: string; ledger: number; closedAt: string; txHash: string;
  name: string; data: Record<string, unknown>;
}
let eventSpec: ReturnType<typeof marketCore>["spec"] | undefined;
const spec = () => eventSpec ??= marketCore().spec;

export function eventTopicFilter(name: string, values: Record<string, unknown> = {}): string[] {
  return spec().eventTopicFilter(name, values);
}
export const tradeTopicFilter = (marketId: bigint) => eventTopicFilter("Trade", { market_id: marketId });

export function decodeEvent(event: rpc.Api.EventResponse): ChainEvent | null {
  if (event.type !== "contract" || event.contractId?.contractId() !== CONTRACTS.marketCore || !event.inSuccessfulContractCall) return null;
  const parsed = spec().parseEvent(event.topic, event.value);
  if (!parsed) return null;
  return { id: event.id, ledger: event.ledger, closedAt: event.ledgerClosedAt, txHash: event.txHash, name: parsed.name, data: parsed.data };
}
/** Typed market-core events used by the price history and analytics layers. */
export type MarketCoreEvent =
  | { kind: "MarketCreated"; marketId: bigint; creator: string; closeTime: bigint; seedAmount: bigint; initialYesBps: number }
  | { kind: "Trade"; marketId: bigint; trader: string; outcome: OutcomeTag; isBuy: boolean; collateral: bigint; shares: bigint; fee: bigint; reserveYes: bigint; reserveNo: bigint }
  | { kind: "MarketResolved"; marketId: bigint; outcome: "Yes" | "No" | null }
  | { kind: "Redeemed"; marketId: bigint; holder: string; payout: bigint };

export interface EventMeta { id: string; ledger: number; ledgerClosedAt: string; txHash: string }
export type DecodedEvent = MarketCoreEvent & { meta: EventMeta };

const isBig = (v: unknown): v is bigint => typeof v === "bigint";
const outcomeOf = (v: unknown): "Yes" | "No" | null | undefined => {
  const tag = (v as { tag?: unknown } | null | undefined)?.tag;
  return tag === "Yes" || tag === "No" ? tag : v === null || v === undefined ? null : undefined;
};

/** Decode one contract event into a typed market-core event, or null for
 * unknown names, wrong contract ids or malformed payloads. */
export function decodeMarketCoreEvent(event: rpc.Api.EventResponse): DecodedEvent | null {
  const decoded = decodeEvent(event);
  if (!decoded) return null;
  const meta: EventMeta = { id: decoded.id, ledger: decoded.ledger, ledgerClosedAt: decoded.closedAt, txHash: decoded.txHash };
  const d = decoded.data;
  switch (decoded.name) {
    case "MarketCreated":
      if (typeof d.creator !== "string" || typeof d.initial_yes_bps !== "number" ||
        !isBig(d.market_id) || !isBig(d.close_time) || !isBig(d.seed_amount)) return null;
      return { kind: "MarketCreated", marketId: d.market_id, creator: d.creator, closeTime: d.close_time, seedAmount: d.seed_amount, initialYesBps: d.initial_yes_bps, meta };
    case "Trade": {
      const row = decodeTrade(event);
      if (!row) return null;
      return { kind: "Trade", marketId: BigInt(row.marketId), trader: row.trader, outcome: row.outcome, isBuy: row.isBuy,
        collateral: row.collateral, shares: row.shares, fee: row.fee, reserveYes: row.reserveYes!, reserveNo: row.reserveNo!, meta };
    }
    case "MarketResolved": {
      if (!isBig(d.market_id)) return null;
      const outcome = outcomeOf(d.outcome);
      if (outcome === undefined) return null;
      return { kind: "MarketResolved", marketId: d.market_id, outcome, meta };
    }
    case "Redeemed":
      if (!isBig(d.market_id) || typeof d.holder !== "string" || !isBig(d.payout)) return null;
      return { kind: "Redeemed", marketId: d.market_id, holder: d.holder, payout: d.payout, meta };
    default:
      return null;
  }
}

/** One contract filter per event name, scoped to a single market.
 * RPC allows at most 5 filters per request. */
export function marketTopicFilter(marketId: bigint, names: readonly string[]): rpc.Api.EventFilter[] {
  return names.map(name => ({
    type: "contract" as const,
    contractIds: [CONTRACTS.marketCore],
    topics: [eventTopicFilter(name, { market_id: marketId })],
  }));
}

export function decodeTrade(event: rpc.Api.EventResponse): TradeRow | null {
  const decoded = decodeEvent(event);
  if (decoded?.name !== "Trade") return null;
  const d = decoded.data;
  const outcome = d.outcome as { tag?: unknown } | undefined;
  if (typeof d.market_id !== "bigint" || typeof d.trader !== "string" || (outcome?.tag !== "Yes" && outcome?.tag !== "No") ||
    typeof d.is_buy !== "boolean" || ![d.collateral, d.shares, d.fee, d.reserve_yes, d.reserve_no].every(v => typeof v === "bigint" && v >= 0n)) return null;
  const reserveYes = d.reserve_yes as bigint, reserveNo = d.reserve_no as bigint;
  return {
    id: decoded.id, ledger: decoded.ledger, closedAt: decoded.closedAt, txHash: decoded.txHash,
    marketId: String(d.market_id), trader: d.trader, outcome: outcome.tag, isBuy: d.is_buy,
    collateral: d.collateral as bigint, shares: d.shares as bigint, fee: d.fee as bigint,
    reserveYes, reserveNo, yesBpsAfter: Number(priceYesBps(reserveYes, reserveNo)), origin: "rpc",
  };
}

/** Prefer decoded RPC copies over provisional socket rows, keyed by event id. */
export function mergeTrades(existing: readonly TradeRow[], incoming: readonly TradeRow[], max = 2000): TradeRow[] {
  const byId = new Map(existing.map(row => [row.id, row]));
  for (const row of incoming) {
    if (byId.get(row.id)?.origin === "rpc" && row.origin === "socket") continue;
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.ledger - a.ledger || b.id.localeCompare(a.id)).slice(0, max);
}

type EventServer = Pick<rpc.Server, "getHealth" | "getEvents">;

/** SDK 16 separates cursor and ledger-range requests. Stop at the snapshot end
 * even though subsequent cursor pages no longer carry an endLedger. */
export async function fetchEventRange(server: EventServer, topics: string[][], start: number, end: number, signal?: AbortSignal, maxEvents = 2000) {
  const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds: [CONTRACTS.marketCore], topics }];
  const events: rpc.Api.EventResponse[] = [];
  let cursor = "";
  if (start >= end || !topics.length) return { events, cursor };
  const limit = 1000;
  while (true) {
    signal?.throwIfAborted();
    const page = await server.getEvents(cursor ? { filters, cursor, limit } : { filters, startLedger: start, endLedger: end, limit });
    signal?.throwIfAborted();
    events.push(...page.events.filter(event => event.ledger >= start && event.ledger < end));
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    if (page.events.some(event => event.ledger >= end) || page.events.length < limit || !page.cursor || page.cursor === cursor) {
      cursor = page.cursor; break;
    }
    cursor = page.cursor;
  }
  return { events, cursor };
}

interface CachedTrades { trades: TradeRow[]; fromLedger: number; latestLedger: number; cursor: string }
const cache = new Map<string, CachedTrades>();
export function clearTradeCache() { cache.clear(); }

export async function fetchMarketTrades(marketId: bigint, opts: { want: number; signal?: AbortSignal; server?: EventServer }) {
  const server = opts.server ?? rpcServer();
  const want = Math.min(2000, Math.max(1, opts.want));
  const key = `${RPC_URL}:${CONTRACTS.marketCore}:${marketId}`;
  for (let attempt = 0; ; attempt++) {
    const health = await server.getHealth();
    const previous = opts.server ? undefined : cache.get(key);
    let state: CachedTrades = previous && previous.latestLedger <= health.latestLedger
      ? { ...previous, trades: previous.trades.filter(row => row.ledger >= health.oldestLedger) }
      : { trades: [], fromLedger: health.latestLedger + 1, latestLedger: health.latestLedger, cursor: "" };
    const topics = [tradeTopicFilter(marketId)];
    const readWindow = async (start: number, end: number) => {
      const page = await fetchEventRange(server, topics, start, end, opts.signal);
      state.trades = mergeTrades(state.trades, page.events.flatMap(event => {
        const row = decodeTrade(event); return row && row.marketId === marketId.toString() ? [row] : [];
      }));
      state.cursor = page.cursor;
    };
    try {
      if (previous) await readWindow(Math.max(health.oldestLedger, previous.latestLedger + 1), health.latestLedger + 1);
      let window = 2000;
      while (state.trades.length < want && state.fromLedger > health.oldestLedger) {
        const from = Math.max(health.oldestLedger, state.fromLedger - window);
        await readWindow(from, state.fromLedger);
        state.fromLedger = from;
        window *= 4;
      }
      opts.signal?.throwIfAborted();
      state = { ...state, latestLedger: health.latestLedger };
      if (!opts.server) {
        cache.delete(key); cache.set(key, state);
        if (cache.size > 32) cache.delete(cache.keys().next().value!);
      }
      return { trades: state.trades.slice(0, want), reachedRetention: state.fromLedger <= health.oldestLedger && state.trades.length <= want,
        latestLedger: health.latestLedger, cursor: state.cursor };
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (attempt > 0 || !/oldest|retention|startLedger|start ledger/i.test(String(error))) throw error;
      cache.delete(key);
    }
  }
}
