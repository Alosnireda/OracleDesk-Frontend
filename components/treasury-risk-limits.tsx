"use client";

import { useState } from "react";
import { useTreasuryLimits } from "@/lib/hooks/useTreasury";
import { CONTRACTS, explorerAccount } from "@/lib/stellar/config";
import { capitalAgreement, formatCountdown } from "@/lib/stellar/treasury-limits";
import { bpsToPercent, formatUsdc } from "@/lib/stellar/units";

const usdc = (raw: bigint) => `${formatUsdc(raw, { maxDecimals: 2, grouping: true })} USDC`;

/** True once the direct read has disagreed with the backend for two refetches in a row. */
function useSustainedDifference(differs: boolean, sampleKey: number): boolean {
  const [seen, setSeen] = useState({ key: -1, count: 0 });
  let count = seen.count;
  if (seen.key !== sampleKey) {
    // A new sample: count it. React re-renders at once with the stored value.
    count = differs ? seen.count + 1 : 0;
    setSeen({ key: sampleKey, count });
  }
  return differs && count >= 2;
}

/**
 * Risk caps and daily usage, read straight from the treasury contract. The
 * backend's figures are shown only to flag disagreement.
 */
export function TreasuryRiskLimits({ backendCapitalRaw }: { backendCapitalRaw: string | null | undefined }) {
  const { limits, config, usage, capital, ledger } = useTreasuryLimits();
  const backend = backendCapitalRaw ? BigInt(backendCapitalRaw) : null;
  const agreement = capital.data !== undefined ? capitalAgreement(capital.data, backend) : "unknown";
  const capitalDiffersPersistently = useSustainedDifference(agreement === "differ", capital.dataUpdatedAt);

  const error = config.error ?? usage.error ?? capital.error;
  const cfg = config.data;
  const configMismatch = cfg && (cfg.collateral !== CONTRACTS.usdc || cfg.market_core !== CONTRACTS.marketCore);
  const utilisation = limits?.daily.utilisationBps ?? null;

  return (
    <section className="mb-12 rounded-xl border border-outline-variant bg-white p-6 shadow-sm" aria-labelledby="treasury-risk-title">
      <div className="mb-6">
        <h3 id="treasury-risk-title" className="font-headline-sm text-headline-sm">Risk limits</h3>
        <p className="text-sm text-on-surface-variant">
          Read straight from the treasury contract, not the backend. Anyone can check these on Stellar Expert.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-error/40 bg-error-container/20 p-3 text-sm text-error">
          Couldn&apos;t read the treasury limits: {error.message}
        </p>
      )}

      {configMismatch && (
        <p role="alert" className="mb-4 rounded-lg border border-error/40 bg-error-container/20 p-3 text-sm text-error">
          The treasury&apos;s collateral or market contract doesn&apos;t match this app&apos;s configuration. Don&apos;t trust these numbers until the frontend config is fixed.
        </p>
      )}

      {cfg && (
        <dl className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <dt className="font-label-caps text-[10px] text-outline mb-1">MAX PER TRADE</dt>
            <dd className="font-data-mono font-bold text-lg text-on-surface">{usdc(cfg.max_trade)}</dd>
          </div>
          <div>
            <dt className="font-label-caps text-[10px] text-outline mb-1">MAX PER MARKET</dt>
            <dd className="font-data-mono font-bold text-lg text-on-surface">{usdc(cfg.max_market)}</dd>
            <dd className="text-xs text-on-surface-variant">Cumulative. Closing a trade doesn&apos;t free this cap.</dd>
          </div>
          <div>
            <dt className="font-label-caps text-[10px] text-outline mb-1">MAX PER DAY</dt>
            <dd className="font-data-mono font-bold text-lg text-on-surface">{usdc(cfg.max_daily)}</dd>
          </div>
        </dl>
      )}

      {limits && (
        <div className="mt-6 space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-on-surface-variant">Used today</span>
            <span className="font-data-mono">
              {utilisation === null ? "—" : bpsToPercent(utilisation, 2)}
            </span>
          </div>
          <div
            role="meter"
            aria-label="Daily treasury usage"
            aria-valuemin={0}
            aria-valuemax={10000}
            aria-valuenow={utilisation === null ? undefined : Number(utilisation)}
            aria-valuetext={`${usdc(limits.daily.used)} of ${usdc(limits.daily.cap)} used today`}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-container"
          >
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${utilisation === null ? 0 : Number(utilisation) / 100}%` }}
            />
          </div>
          <p className="text-sm text-on-surface-variant">
            {usdc(limits.daily.headroom)} left today. The largest trade that would pass right now is{" "}
            {usdc(limits.effectivePerTrade)}; per-market limits aren&apos;t readable here, so it may be lower.
          </p>
          <p className="text-sm text-on-surface-variant" role="status">
            {limits.windowPassed
              ? "The daily window has passed. Usage resets on the agent's next trade."
              : `Daily window resets in ${formatCountdown(limits.resetsInSec)} (ledger time).`}
          </p>
        </div>
      )}

      {!limits && ledger.isError && (
        <p className="mt-4 text-sm text-on-surface-variant">Reset time unavailable: couldn&apos;t read the ledger clock.</p>
      )}

      {capital.data !== undefined && (
        <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-outline-variant pt-4 text-sm">
          <span className="text-on-surface-variant">Available to the agent (chain)</span>
          <span className="font-data-mono font-bold text-on-surface">{usdc(capital.data)}</span>
          {capitalDiffersPersistently && backend !== null && (
            <span role="alert" className="w-full text-error">
              The backend reports {usdc(backend)} (as of its last read), which differs from the chain. Trust the chain figure.
            </span>
          )}
        </div>
      )}

      {cfg && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <a className="underline" href={explorerAccount(CONTRACTS.treasury)} target="_blank" rel="noopener noreferrer">
            Treasury contract on Stellar Expert
          </a>
          <a className="underline" href={explorerAccount(cfg.agent)} target="_blank" rel="noopener noreferrer">
            Agent account on Stellar Expert
          </a>
        </div>
      )}
    </section>
  );
}
