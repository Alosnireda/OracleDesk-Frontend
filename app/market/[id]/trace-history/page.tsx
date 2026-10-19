"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TraceHistoryViewer } from "@/components/trace-history-viewer";
import { TraceDiff, fetchTraceVersion, computeTraceDiff } from "@/lib/services/trace-history";
import { listTraces } from "@/lib/api/traces";

export default function MarketTraceHistoryPage() {
  const params = useParams();
  const marketId = params.id as string;

  const [diffs, setDiffs] = useState<TraceDiff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTraceHistory() {
      try {
        setIsLoading(true);
        setError(null);

        const { traces } = await listTraces();
        const marketTraces = traces.filter((t) => t.marketId === marketId).sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        if (marketTraces.length === 0) {
          setError("No traces found for this market.");
          return;
        }

        const versions = await Promise.all(
          marketTraces.map((t) => fetchTraceVersion(t)),
        );

        const verifiedVersions = versions.filter(
          (v): v is NonNullable<typeof v> => v !== null,
        );

        if (verifiedVersions.length < 2) {
          setError("Not enough verified traces to compare.");
          return;
        }

        const computedDiffs: TraceDiff[] = [];
        for (let i = 0; i < verifiedVersions.length - 1; i++) {
          const diff = computeTraceDiff(verifiedVersions[i], verifiedVersions[i + 1]);
          computedDiffs.push(diff);
        }

        setDiffs(computedDiffs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trace history.");
        console.error("Trace history error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadTraceHistory();
  }, [marketId]);

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto">
      <div className="mb-8">
        <Link
          href={`/market?id=${marketId}`}
          className="flex items-center gap-2 text-primary hover:underline mb-4 font-label-caps text-label-caps"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to Market
        </Link>
        <h1 className="font-display-lg text-display-lg text-on-surface">Market Trace History</h1>
        <p className="text-on-surface-variant mt-2 max-w-2xl font-body-lg text-body-lg">
          Compare successive reasoning traces and see how an agent&apos;s estimates evolved.
        </p>
      </div>

      <TraceHistoryViewer
        marketId={marketId}
        diffs={diffs}
        isLoading={isLoading}
        error={error}
      />
    </main>
  );
}
