import { useState, useEffect } from "react";
import { listTraces } from "@/lib/api/traces";
import { fetchTraceVersion, computeTraceDiff, TraceDiff } from "@/lib/services/trace-history";

export function useTraceHistory(marketId: string) {
  const [diffs, setDiffs] = useState<TraceDiff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTraceHistory() {
      try {
        setIsLoading(true);
        setError(null);

        const { traces } = await listTraces();
        const marketTraces = traces
          .filter((t) => t.marketId === marketId)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        if (marketTraces.length === 0) {
          setError("No traces found for this market.");
          return;
        }

        const versions = await Promise.all(marketTraces.map((t) => fetchTraceVersion(t)));

        const verifiedVersions = versions.filter((v): v is NonNullable<typeof v> => v !== null);

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

  return { diffs, isLoading, error };
}
