"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMarket,
  getMarketGenerationStatus,
  listMarkets,
  triggerMarketGeneration,
  type ListMarketsParams,
} from "@/lib/api/markets";

export function useMarkets(params: ListMarketsParams = {}) {
  return useQuery({
    queryKey: ["markets", params],
    queryFn: () => listMarkets(params),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarket(id: string | undefined) {
  return useQuery({
    queryKey: ["market", id],
    queryFn: () => getMarket(id!),
    enabled: Boolean(id),
  });
}

export function useGenerateMarket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerMarketGeneration,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["markets"] });
    },
  });
}

export function useMarketGenerationStatus(jobId: string | undefined) {
  return useQuery({
    queryKey: ["market-generation", jobId],
    queryFn: () => getMarketGenerationStatus(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "COMPLETED" || status === "FAILED" ? false : 5_000;
    },
  });
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

