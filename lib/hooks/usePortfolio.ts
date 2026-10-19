"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getPlatformStats,
  getPortfolio,
  getPositions,
  type ListPositionsParams,
} from "@/lib/api/portfolio";

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: getPortfolio,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function usePositions(params: ListPositionsParams = {}) {
  return useQuery({
    queryKey: ["positions", params],
    queryFn: () => getPositions(params),
    staleTime: 15_000,
  });
}

export function usePlatformStats() {
  return useQuery({
    queryKey: ["platform-stats"],
    queryFn: getPlatformStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
