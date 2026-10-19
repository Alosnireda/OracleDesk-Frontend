"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getTrace, type ReasoningTrace } from "@/lib/api/traces";
import { fetchAndVerifyTrace } from "@/lib/stellar/trace";
import { SafeTraceViewer } from "@/components/safe-trace-viewer";

export default function ReasoningTraceDetailPage() {
  return (
    <Suspense fallback={<main className="min-h-[calc(100vh-64px)] flex items-center justify-center">Loading…</main>}>
      <ReasoningTraceDetailContent />
    </Suspense>
  );
}

function ReasoningTraceDetailContent() {
  const searchParams = useSearchParams();
  const traceId = searchParams.get("traceId");

  const [trace, setTrace] = useState<ReasoningTrace | null>(null);
  const [verifiedContent, setVerifiedContent] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(Boolean(traceId));
  const [error, setError] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<"verified" | "mismatch" | "unavailable" | "none">("none");

  useEffect(() => {
    if (!traceId) {
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    async function loadTrace() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getTrace(traceId as string);
        if (isCancelled) return;
        setTrace(data);

        if (data.ipfsCid && data.traceHash) {
          const check = await fetchAndVerifyTrace(data.ipfsCid, data.traceHash);
          if (isCancelled) return;
          if (check.status === "verified") {
            setVerificationStatus("verified");
            setVerifiedContent(check.content);
          } else if (check.status === "mismatch") {
            setVerificationStatus("mismatch");
          } else {
            setVerificationStatus("unavailable");
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trace");
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadTrace();
    return () => {
      isCancelled = true;
    };
  }, [traceId]);

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto flex-1 flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/reasoning"
            className="flex items-center gap-1.5 text-primary hover:underline text-xs font-label-caps mb-2"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Back to Reasoning Feed
          </Link>
          <h1 className="font-headline-md text-headline-md text-on-surface">
            {traceId ? `Trace Detail: ${traceId.slice(0, 12)}…` : "Reasoning Trace Detail"}
          </h1>
          {trace?.market?.question && (
            <p className="font-body-md text-on-surface-variant mt-1">Market: {trace.market.question}</p>
          )}
        </div>

        {traceId && (
          <div className="flex items-center gap-3">
            <Link
              href={`/reasoning/verify?traceId=${encodeURIComponent(traceId)}`}
              className="px-4 py-2 bg-surface-container-low border border-outline text-on-surface rounded font-label-caps text-label-caps hover:bg-surface-variant transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">verified_user</span>
              Verify On-Chain
            </Link>
            <Link
              href={`/copy-trade?traceId=${encodeURIComponent(traceId)}&marketId=${encodeURIComponent(trace?.marketId ?? "")}`}
              className="px-4 py-2 bg-primary text-white rounded font-label-caps text-label-caps hover:opacity-90 transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">bolt</span>
              Copy Trade
            </Link>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="p-12 text-center bg-surface-container-low rounded-xl border border-outline-variant">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
          <p className="text-on-surface-variant font-label-caps text-xs">Loading reasoning trace…</p>
        </div>
      )}

      {error && (
        <div className="p-6 bg-error-container/10 border border-error/20 rounded-xl text-error mb-6">
          <p className="font-semibold">Error loading trace</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <SafeTraceViewer
          content={
            verifiedContent ??
            (trace
              ? {
                  version: 1,
                  agent: trace.agentType,
                  action: trace.decisionType,
                  decisionType: trace.decisionType,
                  probabilityEstimate: trace.probabilityEstimate,
                  edge: trace.edge,
                  confidenceInterval: trace.confidenceInterval,
                  sources: trace.sourcesUsed ?? trace.previewSources ?? [],
                  conditions: trace.hedgeConditions,
                  betFraction: trace.betFraction,
                  betSizeUsdc: trace.betSizeUsdc,
                  timestamp: trace.createdAt,
                  reasoning: trace.sourcesUsed?.[0]?.signal || "Decision generated by autonomous market maker.",
                }
              : {
                  version: 1,
                  agent: "MARKET_MAKER_v2",
                  action: "BUY_YES",
                  probabilityEstimate: 0.72,
                  edge: 0.15,
                  confidence: 0.92,
                  reasoning: "Parsed corpus from FOMC minutes and macro market feeds. Consensus suggests elevated tail-risk for dovish policy shift.",
                  sources: [
                    { name: "FOMC Minutes", weight: 0.85, signal: "Labor market softening indicators noted." },
                    { name: "CME FedWatch", weight: 0.62, signal: "Implied probability shifted 4.2% towards rate cut." },
                  ],
                  conditions: ["Dispute window: 24h", "Minimum liquidity depth: 10,000 USDC"],
                })
          }
          verified={verificationStatus === "verified" || Boolean(trace?.verified)}
          ipfsCid={trace?.ipfsCid}
          traceHash={trace?.traceHash}
          title={trace?.market?.question ?? "Reasoning Trace Analysis"}
        />
      )}
    </main>
  );
}
