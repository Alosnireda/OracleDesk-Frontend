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
import { getStoredSessionWallet } from "@/lib/api/client";
import { useWallet } from "@/lib/contexts/WalletContext";

export function useTraces(params: ListTracesParams = {}) {
  return useQuery({
    queryKey: ["traces", params],
    queryFn: () => listTraces(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
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
    refetchIntervalInBackground: false,
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
      queryClient.invalidateQueries({ queryKey: ["trace-payments"] });
    },
  });
}

export function useSpendingAllowance() {
  const { address, isAuthenticated } = useWallet();
  return useQuery({
    queryKey: ["trace-allowance", address],
    queryFn: getSpendingAllowance,
    enabled: Boolean(address && isAuthenticated),
  });
}

export function useSetSpendingAllowance() {
  const queryClient = useQueryClient();
  const { address } = useWallet();

  return useMutation({
    mutationFn: setSpendingAllowance,
    onMutate: async (next) => {
      const key = ["trace-allowance", address] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, { ...next, currency: next.currency ?? "USDC" });
      return { key, previous };
    },
    onError: (_error, _next, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trace-allowance", address] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["trace-allowance", address] });
    },
  });
}

export function usePaymentEvents() {
  const { address, isAuthenticated } = useWallet();
  return useQuery({
    queryKey: ["trace-payments", address ?? getStoredSessionWallet()],
    queryFn: getPaymentEvents,
    enabled: Boolean(address && isAuthenticated),
  });
}
