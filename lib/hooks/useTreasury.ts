import { useQuery } from "@tanstack/react-query";
import { treasuryReader } from "@/lib/stellar/clients";
import { CONTRACTS } from "@/lib/stellar/config";
import { read } from "@/lib/stellar/typed-call";
import { computeLimits, type TreasuryLimits } from "@/lib/stellar/treasury-limits";
import { fetchLedgerNow, stellarKeys } from "./useStellar";

/**
 * Treasury risk limits, read directly from the contract with auth-free
 * simulations. Keys include the treasury id, so a redeploy starts clean.
 */
export const treasuryKeys = {
  config: ["stellar", "treasury", "config", CONTRACTS.treasury] as const,
  usage: ["stellar", "treasury", "dailyUsage", CONTRACTS.treasury] as const,
  capital: ["stellar", "treasury", "availableCapital", CONTRACTS.treasury] as const,
};

/** RiskConfig is fixed at construction (there is no setter), so a long staleTime is safe. */
export function useTreasuryConfig() {
  return useQuery({
    queryKey: treasuryKeys.config,
    queryFn: async () => read(await treasuryReader().get_config(), "treasury"),
    staleTime: 5 * 60_000,
  });
}

export function useTreasuryDailyUsage() {
  return useQuery({
    queryKey: treasuryKeys.usage,
    queryFn: async () => read(await treasuryReader().daily_usage(), "treasury"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTreasuryAvailableCapital() {
  return useQuery({
    queryKey: treasuryKeys.capital,
    queryFn: async () => read(await treasuryReader().available_capital(), "treasury"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/** Ledger close time in seconds. Shares the `ledgerNow` cache with the market pages. */
export function useTreasuryLedgerTime() {
  return useQuery({
    queryKey: stellarKeys.ledgerNow,
    queryFn: fetchLedgerNow,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/**
 * The three contract reads plus ledger time, combined. `limits` is only set
 * once every read has data, so the panel never shows a partial countdown.
 */
export function useTreasuryLimits(): {
  limits: TreasuryLimits | undefined;
  config: ReturnType<typeof useTreasuryConfig>;
  usage: ReturnType<typeof useTreasuryDailyUsage>;
  capital: ReturnType<typeof useTreasuryAvailableCapital>;
  ledger: ReturnType<typeof useTreasuryLedgerTime>;
} {
  const config = useTreasuryConfig();
  const usage = useTreasuryDailyUsage();
  const capital = useTreasuryAvailableCapital();
  const ledger = useTreasuryLedgerTime();
  const limits =
    config.data && usage.data && capital.data !== undefined && ledger.data !== undefined
      ? computeLimits(config.data, usage.data, capital.data, ledger.data)
      : undefined;
  return { limits, config, usage, capital, ledger };
}
