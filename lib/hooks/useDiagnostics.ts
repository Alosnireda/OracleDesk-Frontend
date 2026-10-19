"use client";

import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { API_URL } from "@/lib/api/client";
import { listMarkets, type Market as BackendMarket, type MarketStatus as BackendStatus } from "@/lib/api/markets";
import { usePlatformStats } from "@/lib/hooks/usePortfolio";
import { fetchOnChainMarket, useMarketCount, useTraceCount } from "@/lib/hooks/useStellar";
import { useRealtimeBatch } from "@/lib/realtime/RealtimeProvider";
import { rpcServer } from "@/lib/stellar/clients";
import { describeError, UserFacingError } from "@/lib/stellar/errors";
import type { MarketStatus as ChainStatus } from "@/lib/stellar/generated/market-core";

export interface CountCheck {
  label: string;
  chain: bigint | null;
  backend: number | null;
  ok: boolean;
}

export type MarketDiffKind = "missing-backend" | "missing-chain" | "status" | "price";

export interface MarketDiff {
  onChainId: string;
  backendId: string | null;
  kind: MarketDiffKind;
  chainValue?: string;
  backendValue?: string;
  deltaBps?: number;
  /** The backend had no traded price, so the comparison used initialYesProb. */
  seedOnly?: boolean;
}

export interface Latency {
  rpcMs: number | null;
  backendMs: number | null;
  latestLedger: number | null;
}

const CHAIN_STATUS_LABEL = (status: ChainStatus): string => {
  if (status.tag === "Resolved") return `Resolved ${status.values[0].tag}`;
  return status.tag;
};

/** Chain Open includes a closed-but-unresolved market, which the backend calls
 * RESOLVING. Resolved and Void map to RESOLVED/CANCELLED. PENDING with an
 * on-chain id is itself a mismatch. */
export function compareStatus(chain: ChainStatus, backend: BackendStatus): boolean {
  if (chain.tag === "Open") return backend === "ACTIVE" || backend === "RESOLVING";
  if (chain.tag === "Resolved") return backend === "RESOLVED";
  return backend === "CANCELLED";
}

export function priceDeltaBps(chainYesBps: number, backendProb: number | null | undefined): number | null {
  if (backendProb === null || backendProb === undefined || !Number.isFinite(backendProb)) return null;
  return Math.abs(chainYesBps - Math.round(backendProb * 10_000));
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Always the newest 10 ids, plus a seeded sample of the rest. A new seed each
 * run rotates coverage without ever missing the newest markets. */
export function sampleMarketIds(total: bigint | number, sampleSize: number, seed: number): bigint[] {
  const count = typeof total === "bigint" ? Number(total) : Math.floor(total);
  if (!Number.isFinite(count) || count <= 0) return [];
  const newest = Math.min(10, count);
  const ids = new Set<bigint>();
  for (let i = 0; i < newest; i++) ids.add(BigInt(count - 1 - i));

  const remaining: number[] = [];
  for (let id = 0; id < count - newest; id++) remaining.push(id);
  const random = mulberry32(seed);
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const extra = Math.max(0, Math.min(Math.floor(sampleSize), remaining.length));
  for (const id of remaining.slice(0, extra)) ids.add(BigInt(id));
  return [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function createConcurrencyLimiter(concurrency = 3) {
  const width = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= width) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

export interface TokenBucket {
  tryTake(cost?: number): boolean;
  readonly tokens: number;
}

/** Pure, clock-injectable token bucket. Used by the RPC gate and testable
 * without timers. Capacity defaults to one second of tokens. */
export function createTokenBucket(opts: {
  ratePerSecond: number;
  capacity?: number;
  now?: () => number;
}): TokenBucket {
  const rate = Math.max(0.001, opts.ratePerSecond);
  const capacity = Math.max(1, opts.capacity ?? rate);
  const now = opts.now ?? (() => Date.now());
  let tokens = capacity;
  let last = now();
  return {
    tryTake(cost = 1) {
      const at = now();
      tokens = Math.min(capacity, tokens + ((at - last) / 1000) * rate);
      last = at;
      if (tokens + 1e-9 < cost) return false;
      tokens -= cost;
      return true;
    },
    get tokens() {
      return tokens;
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The diagnostics view's hard ceiling: at most 10 RPC reads per second and 3
 * in flight, regardless of how many markets a run samples. */
const rpcLimit = createConcurrencyLimiter(3);
const rpcBucket = createTokenBucket({ ratePerSecond: 10 });

async function limitedRpc<T>(fn: () => Promise<T>): Promise<T> {
  while (!rpcBucket.tryTake()) await sleep(50);
  return rpcLimit(fn);
}

export function useCountChecks(): { checks: CountCheck[]; isLoading: boolean } {
  const markets = useMarketCount();
  const traces = useTraceCount();
  const stats = usePlatformStats();
  const chainMarkets = markets.data ?? null;
  const chainTraces = traces.data ?? null;
  const backendMarkets = stats.data?.onChainMarketCount ?? null;
  const backendTraces = stats.data?.traceCount ?? null;
  const checks: CountCheck[] = [
    {
      label: "Markets (on-chain)",
      chain: chainMarkets,
      backend: backendMarkets,
      ok: chainMarkets !== null && backendMarkets !== null && chainMarkets === BigInt(backendMarkets),
    },
    {
      label: "Reasoning traces",
      chain: chainTraces,
      backend: backendTraces,
      ok: chainTraces !== null && backendTraces !== null && chainTraces === BigInt(backendTraces),
    },
  ];
  return { checks, isLoading: markets.isLoading || traces.isLoading || stats.isLoading };
}

export async function loadBackendMarkets(): Promise<{ markets: BackendMarket[]; truncated: boolean }> {
  const markets: BackendMarket[] = [];
  const maxPages = 10;
  let page = 1;
  let totalPages = 1;
  while (page <= Math.min(totalPages, maxPages)) {
    const result = await listMarkets({ onChain: true, limit: 100, page });
    markets.push(...result.markets);
    totalPages = result.meta?.totalPages ?? 1;
    page += 1;
  }
  return { markets, truncated: totalPages > maxPages };
}

export interface MarketSampleOptions {
  sampleSize: number;
  toleranceBps: number;
  enabled?: boolean;
  seed?: number;
}

export function useMarketSample(opts: MarketSampleOptions): UseQueryResult<MarketDiff[]> {
  const count = useMarketCount();
  const total = count.data;
  return useQuery({
    queryKey: ["diagnostics", "markets", total?.toString() ?? "?", opts.sampleSize, opts.toleranceBps, opts.seed ?? 0],
    enabled: (opts.enabled ?? true) && total !== undefined,
    queryFn: async (): Promise<MarketDiff[]> => {
      const snapshot = total as bigint;
      const backend = await loadBackendMarkets();
      const byOnChain = new Map<string, BackendMarket>();
      for (const market of backend.markets) {
        if (market.onChainMarketId) byOnChain.set(market.onChainMarketId, market);
      }

      const diffs: MarketDiff[] = [];
      // A backend id at or beyond the chain count usually means the frontend is
      // pointed at a different network/contract than the backend.
      for (const market of backend.markets) {
        if (market.onChainMarketId && BigInt(market.onChainMarketId) >= snapshot) {
          diffs.push({
            onChainId: market.onChainMarketId,
            backendId: market.id,
            kind: "missing-chain",
            backendValue: market.status,
            chainValue: "id ≥ market_count()",
          });
        }
      }

      const ids = sampleMarketIds(snapshot, opts.sampleSize, opts.seed ?? 0);
      const results = await Promise.all(ids.map(async (id) => {
        try {
          return { id, view: await limitedRpc(() => fetchOnChainMarket(id)) };
        } catch (error) {
          return { id, error };
        }
      }));

      for (const result of results) {
        const onChainId = result.id.toString();
        const backendMarket = byOnChain.get(onChainId);
        if ("error" in result) {
          const described = result.error instanceof UserFacingError ? result.error.described : describeError(result.error);
          if (described.kind === "contract") {
            diffs.push({
              onChainId,
              backendId: backendMarket?.id ?? null,
              kind: "missing-chain",
              chainValue: described.code ?? described.message,
            });
            continue;
          }
          throw result.error;
        }
        const view = result.view;
        if (!backendMarket) {
          diffs.push({
            onChainId,
            backendId: null,
            kind: "missing-backend",
            chainValue: `${CHAIN_STATUS_LABEL(view.market.status)} · ${view.yesBps} bps`,
          });
          continue;
        }
        if (!compareStatus(view.market.status, backendMarket.status)) {
          diffs.push({
            onChainId,
            backendId: backendMarket.id,
            kind: "status",
            chainValue: CHAIN_STATUS_LABEL(view.market.status),
            backendValue: backendMarket.status,
          });
        }
        const backendProb = backendMarket.currentYesProb ?? backendMarket.initialYesProb;
        const delta = priceDeltaBps(view.yesBps, backendProb);
        if (delta !== null && delta > opts.toleranceBps) {
          diffs.push({
            onChainId,
            backendId: backendMarket.id,
            kind: "price",
            chainValue: `${view.yesBps} bps`,
            backendValue: `${Math.round(backendProb * 10_000)} bps`,
            deltaBps: delta,
            seedOnly: backendMarket.currentYesProb === null,
          });
        }
      }
      return diffs;
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

const backendHealthUrl = () => `${API_URL.replace(/\/api\/v1\/?$/, "")}/health`;

async function measure(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

export function useLatency(enabled = true): UseQueryResult<Latency> {
  return useQuery({
    queryKey: ["diagnostics", "latency"],
    enabled,
    queryFn: async (): Promise<Latency> => {
      let latestLedger: number | null = null;
      let rpcMs: number | null = null;
      let backendMs: number | null = null;
      try {
        const times: number[] = [];
        for (let i = 0; i < 3; i++) {
          const result = await measure(async () => {
            const ledger = await rpcServer().getLatestLedger();
            latestLedger = ledger.sequence;
          });
          times.push(result);
        }
        rpcMs = median(times);
      } catch {
        rpcMs = null;
      }
      try {
        const times: number[] = [];
        for (let i = 0; i < 3; i++) {
          times.push(await measure(() => fetch(backendHealthUrl(), { cache: "no-store" })));
        }
        backendMs = median(times);
      } catch {
        backendMs = null;
      }
      return { rpcMs, backendMs, latestLedger };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Highest ledger the indexer's socket has shown since this panel mounted. */
export function useIndexerLedger(): number | null {
  const [ledger, setLedger] = useState<number | null>(null);
  useRealtimeBatch((batch) => {
    let newest = 0;
    for (const event of batch) newest = Math.max(newest, event.payload.ledger);
    if (newest > 0) setLedger((previous) => Math.max(previous ?? 0, newest));
  });
  return ledger;
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => (typeof document === "undefined" ? true : !document.hidden));
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
