"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  useCountChecks,
  useDocumentVisible,
  useIndexerLedger,
  useLatency,
  useMarketSample,
  type MarketDiff,
} from "@/lib/hooks/useDiagnostics";
import { usePlatformStats } from "@/lib/hooks/usePortfolio";
import { useTraceCount } from "@/lib/hooks/useStellar";
import { DIAGNOSTICS_TOLERANCE_BPS } from "@/lib/stellar/config";

const SourceTag = ({ source }: { source: "chain" | "backend" }) => (
  <span className={`ml-1 text-[9px] font-bold uppercase px-1 rounded ${source === "chain" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-highest text-on-surface-variant"}`}>
    {source}
  </span>
);

function diffLink(diff: MarketDiff): string {
  if (diff.kind === "missing-backend") return `/markets/quick-view?onChainId=${diff.onChainId}`;
  if (diff.backendId) return `/markets/quick-view?marketId=${diff.backendId}`;
  return `/markets/quick-view?onChainId=${diff.onChainId}`;
}

function value(value: bigint | number | null): string {
  return value === null ? "—" : String(value);
}

export function DiagnosticsPanel() {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [run, setRun] = useState(0);
  const [sampleSize, setSampleSize] = useState(20);
  const [tolerance, setTolerance] = useState(DIAGNOSTICS_TOLERANCE_BPS);
  const visible = useDocumentVisible();

  const counts = useCountChecks();
  const sample = useMarketSample({
    sampleSize,
    toleranceBps: tolerance,
    enabled: run > 0 && visible,
    seed: run,
  });
  const latency = useLatency(run > 0 && visible);
  const indexerLedger = useIndexerLedger();
  const traces = useTraceCount();
  const stats = usePlatformStats();

  useEffect(() => {
    if (!autoRefresh || !visible) return;
    const timer = window.setInterval(() => setRun((previous) => previous + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, visible]);

  const latestLedger = latency.data?.latestLedger ?? null;
  const lag = latestLedger !== null && indexerLedger !== null ? Math.max(0, latestLedger - indexerLedger) : null;
  const diffs = sample.data ?? [];

  const traceGaps = useMemo(() => {
    const chain = traces.data;
    const backend = stats.data?.traceCount;
    if (chain === undefined || backend === undefined || chain <= BigInt(backend)) return [];
    const gap = Math.min(5, Number(chain - BigInt(backend)));
    return Array.from({ length: gap }, (_, index) => (chain - 1n - BigInt(index)).toString());
  }, [traces.data, stats.data?.traceCount]);

  return (
    <section className="bg-white border border-outline-variant rounded-xl p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-headline-sm text-headline-sm flex items-center gap-2">
            Diagnostics
            <span className="text-[10px] font-label-caps uppercase px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">live samples</span>
          </h3>
          <p className="text-sm text-on-surface-variant">
            Compares the backend/indexer with the contracts. Every value is tagged with its source; nothing here is chain data unless it says so.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRun((previous) => previous + 1)}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-label-caps text-label-caps"
          >
            RUN CHECKS
          </button>
          <label className="flex items-center gap-2 text-xs text-on-surface-variant">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            Auto (60 s, visible tab only)
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-outline-variant rounded-lg p-4 space-y-3">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase">Count checks</h4>
          {counts.isLoading ? (
            <p className="text-sm text-on-surface-variant animate-pulse">Reading counts…</p>
          ) : (
            counts.checks.map((check) => (
              <div key={check.label} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{check.label}</p>
                  <p className="text-xs text-on-surface-variant">
                    chain <span className="font-data-mono">{value(check.chain)}</span><SourceTag source="chain" />
                    {" · "}backend <span className="font-data-mono">{value(check.backend)}</span><SourceTag source="backend" />
                  </p>
                </div>
                <span className={check.ok ? "text-secondary" : "text-error"} aria-label={check.ok ? "match" : "mismatch"}>
                  {check.ok ? "✓" : "✗"}
                </span>
              </div>
            ))
          )}
          {traceGaps.length > 0 && (
            <div className="pt-2 border-t border-outline-variant text-xs">
              <p className="text-on-surface-variant">Newest trace ids absent from the backend:</p>
              <p className="flex flex-wrap gap-2 mt-1">
                {traceGaps.map((id) => (
                  <Link key={id} href={`/reasoning/verify?onChainTraceId=${id}`} className="underline text-primary">
                    #{id}
                  </Link>
                ))}
              </p>
            </div>
          )}
        </div>

        <div className="border border-outline-variant rounded-lg p-4 space-y-3">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase">Latency and indexer lag</h4>
          <div className="flex justify-between text-sm">
            <span>RPC round trip</span>
            <span className="font-data-mono">{latency.data?.rpcMs === null || latency.data?.rpcMs === undefined ? "not measured" : `${Math.round(latency.data.rpcMs)} ms`}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Backend /health</span>
            <span className="font-data-mono">{latency.data?.backendMs === null || latency.data?.backendMs === undefined ? "not measured" : `${Math.round(latency.data.backendMs)} ms`}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>RPC latest ledger</span>
            <span className="font-data-mono">{latestLedger === null ? "not measured" : latestLedger}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Indexer lag</span>
            <span className="font-data-mono">
              {lag === null
                ? indexerLedger === null ? "no indexer events observed since page load" : "waiting for RPC ledger"
                : `≥ ${lag} ledgers`}
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            Lag compares the RPC head with the newest socket event this page saw. An idle market does not mean the indexer is behind.
          </p>
        </div>
      </div>

      <div className="border border-outline-variant rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase">Market sample</h4>
          <div className="flex items-center gap-3 text-xs text-on-surface-variant">
            <label className="flex items-center gap-1">
              Size
              <input
                type="number"
                min={10}
                max={200}
                value={sampleSize}
                onChange={(event) => setSampleSize(Math.max(10, Math.min(200, Number(event.target.value) || 20)))}
                className="w-16 bg-surface border border-outline-variant rounded px-2 py-1 font-data-mono"
              />
            </label>
            <label className="flex items-center gap-1">
              Tolerance
              <input
                type="number"
                min={0}
                max={10_000}
                value={tolerance}
                onChange={(event) => setTolerance(Math.max(0, Math.min(10_000, Number(event.target.value) || 0)))}
                className="w-20 bg-surface border border-outline-variant rounded px-2 py-1 font-data-mono"
              />
              bps
            </label>
            <span>Always includes the newest 10; the rest rotates each run.</span>
          </div>
        </div>
        {run === 0 ? (
          <p className="p-6 text-sm text-on-surface-variant">Run checks to sample markets and compare status and YES price.</p>
        ) : sample.isLoading ? (
          <p className="p-6 text-sm text-on-surface-variant animate-pulse">Reading sampled markets (≤10 RPC reads/s, 3 at a time)…</p>
        ) : sample.isError ? (
          <div className="p-6 text-sm text-error">
            <p>Couldn&apos;t sample markets: {sample.error instanceof Error ? sample.error.message : "unknown error"}</p>
            <button type="button" onClick={() => void sample.refetch()} className="mt-2 underline">Retry</button>
          </div>
        ) : diffs.length === 0 ? (
          <p className="p-6 text-sm text-secondary">No discrepancies in the sampled markets (tolerance {tolerance} bps).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">On-chain id</th>
                  <th className="px-4 py-2">Backend id</th>
                  <th className="px-4 py-2">Chain value</th>
                  <th className="px-4 py-2">Backend value</th>
                  <th className="px-4 py-2">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {diffs.map((diff, index) => (
                  <tr key={`${diff.kind}-${diff.onChainId}-${diff.backendId ?? index}`}>
                    <td className="px-4 py-2 font-data-mono text-xs">{diff.kind}</td>
                    <td className="px-4 py-2 font-data-mono">{diff.onChainId}</td>
                    <td className="px-4 py-2 font-data-mono">{diff.backendId ?? "—"}</td>
                    <td className="px-4 py-2">{diff.chainValue ?? "—"}<SourceTag source="chain" /></td>
                    <td className="px-4 py-2">
                      {diff.backendValue ?? "—"}<SourceTag source="backend" />
                      {diff.seedOnly && <span className="ml-1 text-[10px] text-on-surface-variant">(seed only)</span>}
                      {diff.deltaBps !== undefined && <span className="ml-1 text-[10px] text-tertiary">Δ{diff.deltaBps} bps</span>}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={diffLink(diff)} className="underline text-primary">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
