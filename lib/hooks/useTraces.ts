"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPaymentEvents,
  getSpendingAllowance,
  getTrace,
  listTraces,
  setSpendingAllowance,
  unlockDailyPass,
  verifyTrace,
  type ListTracesParams,
} from "@/lib/api/traces";

export function useTraces(params: ListTracesParams = {}) {
  return useQuery({
    queryKey: ["traces", params],
    queryFn: () => listTraces(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/** Newest-first trace feed with cursorless page-number pagination; stops when
 * the backend omits pagination meta or the last page is exhausted. */
export function useInfiniteTraces(params: Omit<ListTracesParams, "page"> = {}) {
  return useInfiniteQuery({
    queryKey: ["traces", "infinite", params],
    queryFn: ({ pageParam }) => listTraces({ ...params, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const meta = lastPage.meta;
      if (!meta || meta.page >= meta.totalPages) return undefined;
      return meta.page + 1;
    },
    staleTime: 15_000,
  });
}

export function useTrace(id: string | undefined) {
  return useQuery({
    queryKey: ["trace", id],
    queryFn: () => getTrace(id!),
    enabled: Boolean(id),
  });
}

export function useVerifyTrace() {
  return useMutation({
    mutationFn: (traceId: string) => verifyTrace(traceId),
  });
}

export function useUnlockTrace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { traceId: string; txHash: string; amountRaw: string }) =>
      unlockDailyPass(params.traceId, params.txHash, params.amountRaw),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["trace", variables.traceId] });
      queryClient.invalidateQueries({ queryKey: ["traces"] });
    },
  });
}

export function useSpendingAllowance() {
  return useQuery({
    queryKey: ["trace-allowance"],
    queryFn: getSpendingAllowance,
  });
}

export function useSetSpendingAllowance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setSpendingAllowance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trace-allowance"] });
    },
  });
}

export function usePaymentEvents() {
  return useQuery({
    queryKey: ["trace-payments"],
    queryFn: getPaymentEvents,
  });
}
