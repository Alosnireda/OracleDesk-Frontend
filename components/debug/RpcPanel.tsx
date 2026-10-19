"use client";

import { useSyncExternalStore } from "react";
import { rpcPool } from "@/lib/stellar/clients";
import type { EndpointStats } from "@/lib/stellar/rpc-pool";

const EMPTY: EndpointStats[] = [];
const noop = () => () => {};

export function useRpcPoolStats() {
  const pool = rpcPool();
  const stats = useSyncExternalStore(pool?.subscribe ?? noop, pool?.getSnapshot ?? (() => EMPTY), () => EMPTY);
  return { stats, current: pool?.current() ?? null, pinned: pool?.pinnedUrl() ?? null, degraded: pool?.isDegraded() ?? false };
}

const ms = (v: number | null) => (v === null ? "–" : `${Math.round(v)} ms`);

/** Live pool state: endpoints, latency, errors, 429s, ledger lag, current/pinned. */
export function RpcPanel() {
  const { stats, current, pinned } = useRpcPoolStats();
  if (stats.length === 0) return <p className="text-xs">RPC pool not started (server render).</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-data-mono">
        <thead>
          <tr className="text-left text-outline">
            <th className="pr-2">Endpoint</th><th className="pr-2">State</th><th className="pr-2">p50</th><th className="pr-2">p95</th>
            <th className="pr-2">Err</th><th className="pr-2">429</th><th className="pr-2">Ledger</th><th className="pr-2">Lag</th><th />
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.url} title={s.lastError}>
              <td className="pr-2 break-all">{s.url}</td>
              <td className="pr-2">{s.state}</td>
              <td className="pr-2">{ms(s.p50Ms)}</td>
              <td className="pr-2">{ms(s.p95Ms)}</td>
              <td className="pr-2">{Math.round(s.errorRate * 100)}%</td>
              <td className="pr-2">{s.rateLimited}</td>
              <td className="pr-2">{s.latestLedger ?? "–"}</td>
              <td className="pr-2">{s.lagLedgers ?? "–"}</td>
              <td>{s.url === pinned ? "pinned" : s.url === current ? "current" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shown to everyone when no RPC endpoint is healthy. */
export function RpcDegradedBanner() {
  const { degraded, stats } = useRpcPoolStats();
  if (!degraded) return null;
  const limited = stats.some((s) => s.rateLimited > 0 && s.state === "degraded");
  return (
    <div role="status" className="fixed top-16 inset-x-0 z-40 bg-error-container text-on-error-container text-center text-sm py-1.5 px-4">
      {limited
        ? "Stellar RPC is degraded: the network is rate limiting requests. Prices may be delayed."
        : "Stellar RPC is degraded. Prices and balances may be delayed or unavailable."}
    </div>
  );
}
