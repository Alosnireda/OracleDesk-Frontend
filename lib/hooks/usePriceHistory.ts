"use client";

import { useQuery } from "@tanstack/react-query";
import { loadPriceHistory, type Coverage, type PricePoint } from "@/lib/stellar/price-history";

export const priceHistoryKey = (id: string) => ["stellar", "priceHistory", id] as const;

const EMPTY_POINTS: PricePoint[] = [];

/**
 * Live price history for one market, keyed under the "stellar" prefix so
 * disconnect() drops it with the other chain queries. Revalidates every 15 s
 * while the tab is visible; each revalidation is one incremental getEvents
 * call from the cached cursor.
 */
export function usePriceHistory(id: string | bigint | null | undefined) {
  const key = id === null || id === undefined || id === "" ? "" : String(id);
  const query = useQuery({
    queryKey: priceHistoryKey(key),
    queryFn: () => loadPriceHistory(BigInt(key)),
    enabled: key !== "",
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const coverage: Coverage | undefined = query.data?.coverage;
  return {
    points: query.data?.points ?? EMPTY_POINTS,
    coverage,
    latestLedger: query.data?.latestLedger,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
