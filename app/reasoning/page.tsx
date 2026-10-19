"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useInfiniteTraces } from "@/lib/hooks/useTraces";
import { mergeTracePages } from "@/lib/hooks/trace-feed";
import type { ReasoningTrace } from "@/lib/api/traces";

interface ReasoningCardProps {
  trace: ReasoningTrace;
}

const ReasoningCard = ({ trace }: ReasoningCardProps) => {
  const { id, marketId, verified, decisionType, edge, probabilityEstimate, previewSources } = trace;
  const yesProb = Math.round(probabilityEstimate * 100);
  const sources = previewSources ?? [];
  const synthesis = sources[0]?.signal ?? null;

  return (
    <div className={`reasoning-card rounded-lg overflow-hidden flex flex-col ${!verified ? 'opacity-90 grayscale-[0.2]' : ''}`}>
      <div className="p-6 border-b border-outline-variant flex flex-col md:flex-row justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="bg-surface-container-high px-2 py-0.5 rounded font-label-caps text-[10px] text-primary">ID: {id.substring(0, 8).toUpperCase()}</span>
            <div className={`flex items-center gap-1 ${verified ? 'text-secondary' : 'text-on-surface-variant'} font-bold`}>
              <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: verified ? "'FILL' 1" : "" }}>
                {verified ? 'verified' : 'pending'}
              </span>
              <span className="font-label-caps text-label-caps">{verified ? 'Verified' : 'Pending'}</span>
            </div>
          </div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface mb-1 uppercase tracking-tight">{trace.market?.question ?? "Market Analysis"}</h2>
          <p className="font-body-md text-on-surface-variant italic">&quot;{decisionType}&quot;</p>
        </div>
        <div className="flex items-center gap-6 md:border-l md:pl-6 border-outline-variant">
          <div className="text-center">
            <div className="font-label-caps text-[10px] text-outline uppercase mb-1">Confidence</div>
            <div className="font-data-mono text-headline-sm text-primary">{yesProb}%</div>
          </div>
          <div className="text-center">
            <div className="font-label-caps text-[10px] text-outline uppercase mb-1">Edge</div>
            <div className="font-data-mono text-headline-sm text-secondary">+{Math.round(edge * 100)}%</div>
          </div>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="ai-tint p-6"
      >
        {sources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined">analytics</span> Reasoning Preview
              </h3>
              <div className="space-y-3 font-body-md text-on-surface leading-relaxed">
                <p>{synthesis}</p>
              </div>
            </div>
            <div>
              <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined">balance</span> Source Weighting
              </h3>
              <div className="space-y-2">
                {sources.map((source, i) => (
                  <div key={`${source.source}:${i}`}>
                    <div className="flex items-center justify-between text-xs font-label-caps mt-3 first:mt-0">
                      <span>{source.source}</span>
                      <span className="font-data-mono">{Math.round(source.weight * 100)}%</span>
                    </div>
                    <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.round(source.weight * 100)}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-on-surface-variant font-body-md">
            <span className="material-symbols-outlined">lock</span>
            <p>No public preview for this trace — unlock the full reasoning via Premium or the per-trace flow.</p>
          </div>
        )}
        
        <div className="mt-8">
          <div className="flex justify-between mb-2">
            <span className="font-label-caps text-label-caps text-secondary uppercase">Yes: {yesProb}%</span>
            <span className="font-label-caps text-label-caps text-tertiary uppercase">No: {100 - yesProb}%</span>
          </div>
          <div className="h-4 w-full flex rounded-full overflow-hidden bg-surface-container">
            <div className="probability-yes h-full" style={{ width: `${yesProb}%` }}></div>
            <div className="probability-no h-full" style={{ width: `${100 - yesProb}%` }}></div>
          </div>
        </div>
      </motion.div>

      <div className="p-6 bg-surface border-t border-outline-variant flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2">
          <Link href={`/reasoning/verify?traceId=${id}`} className="px-4 py-2 bg-surface-container-low border border-outline text-on-surface rounded font-label-caps text-label-caps hover:bg-surface-variant transition-all">Verify</Link>
          <Link
            href={`/copy-trade?traceId=${id}&marketId=${marketId}`}
            className="px-4 py-2 bg-primary-container text-white rounded font-label-caps text-label-caps hover:opacity-90 active:opacity-80 transition-all"
          >
            Copy Trade
          </Link>
          <Link
            href={`/agent/${encodeURIComponent(id)}`}
            className="px-4 py-2 bg-surface-container-low border border-outline text-on-surface rounded font-label-caps text-label-caps hover:bg-surface-variant transition-all"
          >
            View Agent Profile
          </Link>
        </div>
        <Link href="/premium/trace" className="flex items-center gap-2 text-primary font-bold font-label-caps text-label-caps border border-primary px-4 py-2 rounded hover:bg-primary-fixed-dim/10">
          <span className="material-symbols-outlined">lock_open</span>
          Unlock Premium Trace
        </Link>
      </div>
    </div>
  );
};

export default function ReasoningFeedPage() {
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteTraces();
  const traces = useMemo(() => mergeTracePages(data?.pages.map((page) => page.traces) ?? []), [data]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto">
      {/* Header Section */}
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display-lg text-display-lg text-on-surface">AI Reasoning Feed</h1>
          <p className="text-on-surface-variant mt-2 max-w-2xl font-body-lg text-body-lg">
            Real-time inference logs and predictive analysis for global prediction markets. 
            Verifiable trust through on-chain reasoning traces.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-surface-container rounded border border-outline-variant">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse motion-reduce:animate-none"></span>
            <span className="font-data-mono text-data-mono text-on-surface">{traces.length} TRACES</span>
          </div>
        </div>
      </div>

      {/* Main Feed */}
      <div className="space-y-6">
        {isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="h-64 bg-surface-container-low animate-pulse motion-reduce:animate-none rounded-lg border border-outline-variant"></div>
          ))
        ) : error ? (
          <div className="p-12 text-center bg-surface-container-low rounded-xl border border-error/20">
            <span className="material-symbols-outlined text-error text-4xl mb-4">error</span>
            <p>Failed to load reasoning traces.</p>
          </div>
        ) : traces.length > 0 ? (
          <>
            {traces.map((t) => (
              <ReasoningCard key={t.id} trace={t} />
            ))}
            <div ref={sentinelRef} aria-hidden className="h-px" />
            {isFetchingNextPage ? (
              <div className="h-24 bg-surface-container-low animate-pulse motion-reduce:animate-none rounded-lg border border-outline-variant"></div>
            ) : hasNextPage ? (
              <button
                onClick={() => fetchNextPage()}
                className="w-full py-4 border border-outline-variant rounded-lg font-label-caps text-label-caps text-primary hover:bg-surface-container-low transition-colors"
              >
                LOAD MORE TRACES
              </button>
            ) : (
              <p className="text-center text-on-surface-variant font-body-md">End of available traces.</p>
            )}
          </>
        ) : (
          <div className="p-12 text-center bg-surface-container-low rounded-xl">
            <p>No reasoning traces available yet.</p>
          </div>
        )}
      </div>
    </main>
  );
}
