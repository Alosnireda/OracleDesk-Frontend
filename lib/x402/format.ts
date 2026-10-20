import type { PaymentRequirements } from "@x402/core/types";
import { findDefaultAsset } from "@x402/stellar";
import { USDC_DECIMALS, formatUsdc } from "@/lib/stellar/units";

/**
 * Display text for an x402 amount. The asset comes from the 402 (Circle USDC
 * by default for the Stellar exact scheme), so its symbol and decimals are
 * looked up rather than assumed; unknown assets show atomic units.
 */
export function formatX402Amount(amountRaw: bigint, requirement: Pick<PaymentRequirements, "asset" | "network"> | null, fullPrecision = false): string {
  const known = requirement ? findDefaultAsset(requirement.asset, requirement.network) : { symbol: "USDC", decimals: USDC_DECIMALS };
  if (!known || known.decimals !== USDC_DECIMALS) return `${amountRaw.toString()} atomic units`;
  return `${formatUsdc(amountRaw, fullPrecision ? { minDecimals: USDC_DECIMALS } : { minDecimals: 2 })} ${known.symbol}`;
}
