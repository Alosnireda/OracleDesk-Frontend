"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMarket,
  listMarkets,
  triggerMarketGeneration,
  type ListMarketsParams,
} from "@/lib/api/markets";
import { nextPageParam } from "@/lib/ui/virtual-math";

export function useMarkets(params: ListMarketsParams = {}) {
  return useQuery({
    queryKey: ["markets", params],
    queryFn: () => listMarkets(params),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useInfiniteMarkets(params: Omit<ListMarketsParams, "page"> = {}) {
  return useInfiniteQuery({
    queryKey: ["markets", "infinite", params],
    queryFn: ({ pageParam }) => listMarkets({ ...params, page: pageParam, limit: params.limit ?? 50 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => nextPageParam(lastPage.meta),
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useMarket(id: string | undefined) {
  return useQuery({
    queryKey: ["market", id],
    queryFn: () => getMarket(id!),
    enabled: Boolean(id),
  });
}

/** Starts one market-maker run. The agent ignores inputs, so none are sent. */
export function useGenerateMarket() {
  return useMutation({
    mutationFn: ({ idempotencyKey }: { idempotencyKey: string }) => triggerMarketGeneration({}, idempotencyKey),
  });
}

/**
 * Polls one generation job until it is COMPLETED, FAILED, UNKNOWN or gone
 * (404), saving every answer to the admin's job store. Polling pauses on a
 * session error until the caller signs in again and refetches.
 */
export function useMarketGenerationStatus(address: string | null | undefined, jobId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["market-generation", address, jobId],
    queryFn: () => fetchTrackedJob(jobId),
    enabled: enabled && Boolean(address),
    staleTime: 0,
    retry: shouldRetryStatus,
    retryDelay: statusRetryDelay,
    refetchInterval: (q) => (q.state.error && !shouldRetryStatus(0, q.state.error) ? false : nextPollInterval(q.state.data)),
  });

  const { data, dataUpdatedAt } = query;
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!data || !address) return;
    saveJob(address, toJobPatch(data, dataUpdatedAt));
    if (data.status === "COMPLETED" && lastStatus.current !== "COMPLETED") {
      queryClient.invalidateQueries({ queryKey: ["markets"] });
      queryClient.invalidateQueries({ queryKey: ["platform-stats"] });
    }
    lastStatus.current = data.status;
  }, [data, dataUpdatedAt, address, queryClient]);

  return { query, sessionExpired: isSessionError(query.error) };
}

import {
  verifyMarketQuestion,
  formatHashHex,
  getCachedQuestionCheck,
  setCachedQuestionCheck,
  type QuestionIntegrityCheck,
} from "@/lib/stellar/market-question";

export function useMarketQuestionIntegrity(params: {
  marketId?: string | null;
  onChainMarketId?: string | null;
  displayedQuestion: string;
  metaUri?: string | null;
  questionHash?: Buffer | Uint8Array | string | null;
}) {
  const committedHash = formatHashHex(params.questionHash);
  const key = `${params.marketId || params.onChainMarketId || "unknown"}:${committedHash || "no-hash"}`;

  return useQuery({
    queryKey: ["market-question-integrity", key, params.displayedQuestion],
    queryFn: async (): Promise<QuestionIntegrityCheck> => {
      const cached = getCachedQuestionCheck(key);
      if (cached && cached.displayedQuestion === params.displayedQuestion) return cached;
      const res = await verifyMarketQuestion({
        displayedQuestion: params.displayedQuestion,
        metaUri: params.metaUri,
        questionHash: params.questionHash,
      });
      setCachedQuestionCheck(key, res);
      return res;
    },
    staleTime: Infinity,
    enabled: Boolean(params.displayedQuestion),
  });
}

