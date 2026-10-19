"use client";
import { Icon } from "@/components/ui/icon";

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

        {/* Right Panel: Data Analysis & Actions */}
        <div className="w-full md:w-[400px] flex flex-col bg-surface-container-low overflow-y-auto custom-scrollbar">
          {/* Source Weighting Card */}
          <div className="p-6 border-b border-outline-variant">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 uppercase tracking-wider">
              Source Weighting
            </h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded bg-white border border-outline-variant flex items-center justify-center">
                  <Icon name="terminal" className="text-on-surface-variant" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-body-md font-semibold">Macro Indicators</span>
                    <span className="font-data-mono text-primary">0.92</span>
                  </div>
                  <div className="w-full h-1 bg-outline-variant rounded-full">
                    <div className="h-1 bg-primary w-[92%]"></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded bg-white border border-outline-variant flex items-center justify-center">
                  <Icon name="public" className="text-on-surface-variant" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-body-md font-semibold">Social Sentiment</span>
                    <span className="font-data-mono text-primary">0.44</span>
                  </div>
                  <div className="w-full h-1 bg-outline-variant rounded-full">
                    <div className="h-1 bg-primary w-[44%]"></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded bg-white border border-outline-variant flex items-center justify-center">
                  <Icon name="history_edu" className="text-on-surface-variant" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-body-md font-semibold">Historical Bias</span>
                    <span className="font-data-mono text-primary">0.78</span>
                  </div>
                  <div className="w-full h-1 bg-outline-variant rounded-full">
                    <div className="h-1 bg-primary w-[78%]"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Confidence Interval Graph Area */}
          <div className="p-6 flex-1">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 uppercase tracking-wider">
              Confidence Interval
            </h3>
            <div className="aspect-video w-full bg-white border border-outline-variant rounded-lg relative overflow-hidden flex items-end p-2 gap-1">
              {/* Simulated Bar Chart */}
              <div className="flex-1 bg-surface-container h-[20%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[35%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[50%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[75%] rounded-sm"></div>
              <div className="flex-1 bg-primary h-[90%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[60%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[40%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[20%] rounded-sm"></div>
              <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="font-headline-md text-primary opacity-20 select-none">
                  σ 2.4
                </span>
              </div>
            </div>
            <p className="font-label-caps text-[10px] text-on-surface-variant mt-3 uppercase tracking-widest text-center">
              Projected Value Distribution
            </p>
          </div>

          {/* Primary CTA Section */}
          <div className="p-6 bg-white border-t border-outline-variant space-y-3 sticky bottom-0">
            <div className="flex justify-between items-end mb-2">
              <div>
                <span className="font-label-caps text-on-surface-variant">CURRENT PRICE</span>
                <div className="font-headline-md text-headline-md font-bold">0.68¢</div>
              </div>
              <div className="text-right">
                <span className="font-label-caps text-secondary">POTENTIAL ROI</span>
                <div className="font-headline-md text-headline-md font-bold text-secondary">
                  +47.1%
                </div>
              </div>
            </div>
            <Link 
              href="/copy-trade?traceId=TRD-7724&marketId=MKT-9204"
              className="w-full bg-secondary text-primary-foreground font-headline-sm text-headline-sm py-4 rounded-xl flex items-center justify-center gap-3 hover:opacity-90 transition-opacity active:scale-[0.98] transform cursor-pointer"
            >
              <Icon name="bolt" filled />
              Copy Trade (YES)
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
