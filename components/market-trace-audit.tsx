"use client";

import React, { useRef, useState } from "react";
import {
  runMarketTraceAudit,
  type AuditedTraceItem,
  type AuditProgress,
  type MarketAuditSummary,
} from "@/lib/stellar/market-audit";
import { SafeTraceViewer } from "@/components/safe-trace-viewer";

export interface MarketTraceAuditProps {
  onChainMarketId: string;
  marketId?: string | null;
  marketQuestion?: string;
  className?: string;
}

export function MarketTraceAudit({
  onChainMarketId,
  marketId,
  marketQuestion,
  className = "",
}: MarketTraceAuditProps) {
  const [items, setItems] = useState<AuditedTraceItem[]>([]);
  const [summary, setSummary] = useState<MarketAuditSummary | null>(null);
  const [progress, setProgress] = useState<AuditProgress>({
    phase: "idle",
    total: 0,
    verified: 0,
    mismatches: 0,
    unavailable: 0,
  });
  const [selectedTrace, setSelectedTrace] = useState<AuditedTraceItem | null>(null);
  const [filter, setFilter] = useState<"all" | "verified" | "mismatch" | "disagreements" | "unavailable">("all");

  const abortControllerRef = useRef<AbortController | null>(null);
  const itemsMapRef = useRef<Map<string, AuditedTraceItem>>(new Map());

  const isRunning = progress.phase === "enumerating" || progress.phase === "verifying";

  const startOrResumeAudit = async () => {
    if (isRunning) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await runMarketTraceAudit({
        onChainMarketId,
        marketId,
        signal: controller.signal,
        existingItems: itemsMapRef.current,
        onProgress: (prog, updatedItems) => {
          setProgress(prog);
          setItems([...updatedItems]);
          for (const it of updatedItems) {
            itemsMapRef.current.set(it.onChainTraceId, it);
          }
        },
      });

      setSummary(res.summary);
      setItems(res.items);
      for (const it of res.items) {
        itemsMapRef.current.set(it.onChainTraceId, it);
      }
    } catch (err) {
      setProgress((prev) => ({
        ...prev,
        phase: "error",
        error: err instanceof Error ? err.message : "Audit encountered an error",
      }));
    } finally {
      abortControllerRef.current = null;
    }
  };

  const pauseAudit = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setProgress((prev) => ({ ...prev, phase: "paused" }));
  };

  const resetAudit = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    itemsMapRef.current.clear();
    setItems([]);
    setSummary(null);
    setSelectedTrace(null);
    setProgress({
      phase: "idle",
      total: 0,
      verified: 0,
      mismatches: 0,
      unavailable: 0,
    });
  };

  // Filtered traces
  const filteredItems = items.filter((item) => {
    if (filter === "verified") return item.status === "verified";
    if (filter === "mismatch") return item.status === "mismatch";
    if (filter === "unavailable") return item.status === "unavailable";
    if (filter === "disagreements") return item.disagreements.length > 0;
    return true;
  });

  const progressPercent = progress.total > 0
    ? Math.round(((progress.verified + progress.mismatches + progress.unavailable) / progress.total) * 100)
    : 0;

  return (
    <div className={`rounded-xl border border-outline-variant bg-surface overflow-hidden ${className}`}>
      {/* Header Bar */}
      <div className="p-6 bg-surface-container-low border-b border-outline-variant flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-xl">fact_check</span>
            <span className="font-label-caps text-label-caps text-primary font-bold">
              MARKET INTEGRITY AUDIT · ON-CHAIN #{onChainMarketId}
            </span>
          </div>
          <h2 className="font-headline-md text-headline-md text-on-surface">
            {marketQuestion ? marketQuestion : `Market #${onChainMarketId} Trace Verification`}
          </h2>
          <p className="text-body-md text-on-surface-variant mt-1">
            Enumerates all reasoning traces recorded in reasoning-registry, verifies IPFS contents against on-chain hashes, and reconciles with the backend view.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 shrink-0">
          {isRunning ? (
            <button
              type="button"
              onClick={pauseAudit}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-label-caps text-label-caps font-bold transition-all flex items-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">pause</span>
              Pause Audit
            </button>
          ) : progress.phase === "paused" ? (
            <button
              type="button"
              onClick={startOrResumeAudit}
              className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg font-label-caps text-label-caps font-bold transition-all flex items-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">play_arrow</span>
              Resume Audit
            </button>
          ) : (
            <button
              type="button"
              onClick={startOrResumeAudit}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg font-label-caps text-label-caps font-bold transition-all flex items-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">security_update_good</span>
              {progress.phase === "completed" ? "Re-run Audit" : "Begin Batch Audit"}
            </button>
          )}

          {items.length > 0 && !isRunning && (
            <button
              type="button"
              onClick={resetAudit}
              className="px-4 py-2.5 bg-surface border border-outline-variant rounded-lg font-label-caps text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {isRunning && (
        <div className="p-4 bg-surface-container-lowest border-b border-outline-variant space-y-2">
          <div className="flex justify-between items-center text-xs font-label-caps">
            <span className="text-primary font-bold flex items-center gap-1.5">
              <span className="animate-spin material-symbols-outlined text-sm">sync</span>
              {progress.phase === "enumerating"
                ? "Reading on-chain index from reasoning-registry…"
                : `Verifying trace #${progress.currentTraceId ?? ""} (${progress.verified + progress.mismatches + progress.unavailable} of ${progress.total})`}
            </span>
            <span className="font-data-mono text-primary font-bold">{progressPercent}%</span>
          </div>
          <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Critical Disagreements Banner */}
      {summary && summary.criticalDisagreementsCount > 0 && (
        <div
          role="alert"
          className="p-4 bg-error-container/20 border-b border-error text-error flex items-start gap-3"
        >
          <span className="material-symbols-outlined text-xl shrink-0 mt-0.5 animate-pulse">warning</span>
          <div className="space-y-1">
            <h4 className="font-headline-sm text-sm font-bold uppercase tracking-wide">
              Critical Integrity Warning: {summary.criticalDisagreementsCount} Disagreement{summary.criticalDisagreementsCount > 1 ? "s" : ""} Found
            </h4>
            <p className="text-xs leading-relaxed opacity-90">
              The backend claims one or more traces are verified, but local cryptographic verification failed or hash commitments differ from the blockchain. Do not trust backend claims without verification!
            </p>
            <ul className="text-xs list-disc list-inside space-y-0.5 mt-2">
              {summary.criticalDisagreements.slice(0, 3).map((d, i) => (
                <li key={i}>
                  <span className="font-data-mono font-bold">Trace #{d.onChainTraceId}:</span> {d.description}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Summary KPI Tiles */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-5 border-b border-outline-variant bg-surface-container-lowest">
          <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span className="font-label-caps text-[10px] text-on-surface-variant block mb-1">ON-CHAIN TRACES</span>
            <span className="font-data-mono text-xl font-bold text-on-surface">{summary.onChainCount}</span>
          </div>

          <div className="p-3 bg-secondary/10 rounded-lg border border-secondary/20">
            <span className="font-label-caps text-[10px] text-secondary font-bold block mb-1">VERIFIED</span>
            <span className="font-data-mono text-xl font-bold text-secondary">{summary.verifiedCount}</span>
          </div>

          <div className={`p-3 rounded-lg border ${summary.mismatchCount > 0 ? "bg-error/10 border-error/30 text-error" : "bg-surface-container-low border-outline-variant/60"}`}>
            <span className="font-label-caps text-[10px] block mb-1 font-bold">MISMATCHES</span>
            <span className="font-data-mono text-xl font-bold">{summary.mismatchCount}</span>
          </div>

          <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span className="font-label-caps text-[10px] text-on-surface-variant block mb-1">UNAVAILABLE</span>
            <span className="font-data-mono text-xl font-bold text-on-surface-variant">{summary.unavailableCount}</span>
          </div>

          <div className={`p-3 rounded-lg border ${summary.disagreementsCount > 0 ? "bg-tertiary/10 border-tertiary/30 text-tertiary font-bold" : "bg-surface-container-low border-outline-variant/60"}`}>
            <span className="font-label-caps text-[10px] block mb-1">DISAGREEMENTS</span>
            <span className="font-data-mono text-xl font-bold">{summary.disagreementsCount}</span>
          </div>

          <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span className="font-label-caps text-[10px] text-on-surface-variant block mb-1">AGENTS INVOLVED</span>
            <span className="font-data-mono text-xl font-bold text-on-surface">{summary.agentsInvolved.length}</span>
          </div>
        </div>
      )}

      {/* Time Span & Metadata Strip */}
      {summary && (
        <div className="px-6 py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between text-xs text-on-surface-variant gap-4 font-data-mono">
          <div>
            <span className="font-bold uppercase tracking-wider text-outline mr-2">TIME SPAN:</span>
            {summary.timeSpan.formatted}
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-outline mr-2">AGENTS:</span>
            {summary.agentsInvolved.map((a) => `${a.slice(0, 4)}…${a.slice(-4)}`).join(", ") || "None"}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      {items.length > 0 && (
        <div className="px-6 py-3 border-b border-outline-variant flex flex-wrap gap-2 items-center justify-between bg-surface">
          <div className="flex gap-1 p-1 bg-surface-container rounded-lg">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-3 py-1 text-xs font-label-caps rounded ${filter === "all" ? "bg-surface text-primary font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("verified")}
              className={`px-3 py-1 text-xs font-label-caps rounded ${filter === "verified" ? "bg-surface text-secondary font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              Verified ({items.filter((i) => i.status === "verified").length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("mismatch")}
              className={`px-3 py-1 text-xs font-label-caps rounded ${filter === "mismatch" ? "bg-surface text-error font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              Mismatches ({items.filter((i) => i.status === "mismatch").length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("disagreements")}
              className={`px-3 py-1 text-xs font-label-caps rounded ${filter === "disagreements" ? "bg-surface text-tertiary font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              Disagreements ({items.filter((i) => i.disagreements.length > 0).length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("unavailable")}
              className={`px-3 py-1 text-xs font-label-caps rounded ${filter === "unavailable" ? "bg-surface text-on-surface font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              Unavailable ({items.filter((i) => i.status === "unavailable").length})
            </button>
          </div>
          <span className="text-xs text-on-surface-variant">
            Showing {filteredItems.length} of {items.length} traces
          </span>
        </div>
      )}

      {/* Traces Table */}
      {filteredItems.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-data-mono">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant">
                <th className="px-4 py-3 font-normal">#</th>
                <th className="px-4 py-3 font-normal">Trace ID</th>
                <th className="px-4 py-3 font-normal">Agent</th>
                <th className="px-4 py-3 font-normal">Action</th>
                <th className="px-4 py-3 font-normal">Published</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal">Backend Agreement</th>
                <th className="px-4 py-3 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60">
              {filteredItems.map((item) => (
                <tr
                  key={item.onChainTraceId}
                  className={`hover:bg-surface-container/50 transition-colors ${item.isCriticalDisagreement ? "bg-error-container/10" : ""}`}
                >
                  <td className="px-4 py-3 text-on-surface-variant font-bold">{item.index + 1}</td>
                  <td className="px-4 py-3 font-bold text-on-surface">#{item.onChainTraceId}</td>
                  <td className="px-4 py-3 text-on-surface truncate max-w-[120px]" title={item.agent}>
                    {item.agent.length > 10 ? `${item.agent.slice(0, 4)}…${item.agent.slice(-4)}` : item.agent}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-surface-container font-label-caps text-[10px]">
                      {item.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {item.publishedAt > 0 ? new Date(item.publishedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {item.status === "verified" ? (
                      <span className="inline-flex items-center gap-1 text-secondary font-bold">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        Verified
                      </span>
                    ) : item.status === "mismatch" ? (
                      <span className="inline-flex items-center gap-1 text-error font-bold">
                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                        Mismatch
                      </span>
                    ) : item.status === "unavailable" ? (
                      <span className="inline-flex items-center gap-1 text-on-surface-variant">
                        <span className="material-symbols-outlined text-[14px]">cloud_off</span>
                        Unavailable
                      </span>
                    ) : item.status === "running" ? (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <span className="animate-spin material-symbols-outlined text-[14px]">sync</span>
                        Checking…
                      </span>
                    ) : (
                      <span className="text-outline">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.disagreements.length === 0 ? (
                      <span className="text-secondary text-[11px]">Agrees</span>
                    ) : (
                      <div className="space-y-0.5">
                        {item.disagreements.map((d, di) => (
                          <p
                            key={di}
                            className={`text-[10px] leading-tight ${item.isCriticalDisagreement ? "text-error font-bold" : "text-amber-600 dark:text-amber-400"}`}
                          >
                            {d}
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.content ? (
                      <button
                        type="button"
                        onClick={() => setSelectedTrace(selectedTrace?.onChainTraceId === item.onChainTraceId ? null : item)}
                        className="px-2.5 py-1 bg-surface border border-outline-variant hover:bg-surface-container rounded text-[11px] font-label-caps text-primary"
                      >
                        {selectedTrace?.onChainTraceId === item.onChainTraceId ? "Hide Content" : "View Content"}
                      </button>
                    ) : (
                      <span className="text-outline text-[11px]">No content</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : items.length === 0 && !isRunning ? (
        <div className="p-12 text-center text-on-surface-variant space-y-3">
          <span className="material-symbols-outlined text-4xl text-outline">fact_check</span>
          <p className="font-medium text-sm">No trace audit run yet for this market.</p>
          <p className="text-xs text-outline max-w-md mx-auto">
            Click &ldquo;Begin Batch Audit&rdquo; to query reasoning-registry and verify all published traces against IPFS.
          </p>
        </div>
      ) : null}

      {/* Expanded SafeTraceViewer Modal / Drawer for selected trace */}
      {selectedTrace && selectedTrace.content && (
        <div className="p-6 border-t border-outline-variant bg-surface-container-low">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">
              Trace Content: #{selectedTrace.onChainTraceId} ({selectedTrace.agent})
            </h3>
            <button
              type="button"
              onClick={() => setSelectedTrace(null)}
              className="px-3 py-1 bg-surface border border-outline-variant rounded font-label-caps text-xs text-on-surface-variant hover:text-on-surface"
            >
              Close
            </button>
          </div>
          <SafeTraceViewer
            content={selectedTrace.content}
            verified={selectedTrace.status === "verified"}
            ipfsCid={selectedTrace.ipfsCid}
            traceHash={selectedTrace.onChainHash}
            title={`${selectedTrace.action} by ${selectedTrace.agent}`}
          />
        </div>
      )}
    </div>
  );
}
