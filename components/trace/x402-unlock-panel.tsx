"use client";

import React, { useState } from "react";
import { useWallet } from "@/lib/contexts/WalletContext";
import { X402_ENABLED, useTraceJournal, useX402Quote, useX402UnlockDeps } from "@/lib/hooks/useX402";
import {
  amountOf,
  conservativePolicy,
  selectRequirement,
  unlockTrace,
  type RequirementsResult,
  type UnlockOptions,
  type UnlockResult,
} from "@/lib/x402/client";
import { JournalUnavailableError, paymentEvidence, type JournalEntry } from "@/lib/x402/recovery";
import { formatX402Amount } from "@/lib/x402/format";
import { STELLAR_NETWORK_ID, explorerTx } from "@/lib/stellar/config";
import { describeError } from "@/lib/stellar/errors";

/** The requirement this page would pay, or null when the 402 offers none for this network. */
function quotedRequirement(data: RequirementsResult | undefined) {
  if (data?.status !== "payment-required") return null;
  try {
    return selectRequirement(data.paymentRequired, STELLAR_NETWORK_ID);
  } catch {
    return null;
  }
}

function verificationText(result: Extract<UnlockResult, { status: "unlocked" }>): string {
  switch (result.check.status) {
    case "verified":
      return "Unlocked. The content matches the on-chain trace hash.";
    case "mismatch":
      return "Unlocked, but the content from IPFS doesn't match the on-chain hash, so it isn't shown.";
    case "unavailable":
      return `Unlocked. The IPFS check couldn't run right now (${result.check.reason}); reopen to check again without paying.`;
  }
}

function EvidenceDrawer({ entry }: { entry: JournalEntry }) {
  const [copied, setCopied] = useState(false);
  const evidence = paymentEvidence(entry);
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(evidence, null, 2));
    setCopied(true);
  };
  return (
    <details className="text-[12px] text-on-surface-variant">
      <summary className="cursor-pointer font-label-caps text-label-caps">Payment evidence</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-data-mono break-all">
        <dt>Amount</dt>
        <dd>{formatX402Amount(BigInt(entry.amountRaw), entry.requirement, true)}</dd>
        <dt>Pay to</dt>
        <dd>{entry.requirement.payTo}</dd>
        <dt>Asset</dt>
        <dd>{entry.requirement.asset}</dd>
        <dt>Signed</dt>
        <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
        <dt>Last attempt</dt>
        <dd>{new Date(entry.updatedAt).toLocaleString()} ({entry.attempts} attempts)</dd>
        {entry.expirationLedger !== undefined && (
          <>
            <dt>Valid until ledger</dt>
            <dd>{entry.expirationLedger}</dd>
          </>
        )}
        {entry.settlementTxHash && (
          <>
            <dt>Settlement</dt>
            <dd>
              <a href={explorerTx(entry.settlementTxHash)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {entry.settlementTxHash}
              </a>
            </dd>
          </>
        )}
      </dl>
      <button type="button" onClick={copy} className="mt-2 text-primary font-semibold hover:underline">
        {copied ? "Copied" : "Copy payment evidence"}
      </button>
    </details>
  );
}

/**
 * Per-trace x402 unlock driven by the payment journal: a saved payment is
 * always redelivered, a settled one is never paid again, and a new payment is
 * offered only when none is pending or the previous one expired unpaid.
 */
export function X402UnlockPanel({ onChainTraceId }: { onChainTraceId: string }) {
  const { address, openModal } = useWallet();
  const deps = useX402UnlockDeps();
  const { entry, journalAvailable } = useTraceJournal(address, onChainTraceId);
  const quote = useX402Quote(onChainTraceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnlockResult | null>(null);

  if (!X402_ENABLED) return null;

  const quoted = quotedRequirement(quote.data);
  const confirmedRaw = quoted ? amountOf(quoted) : 0n;

  const run = async (options: Partial<Pick<UnlockOptions, "payAgainIfExpired" | "retryDelivery">> = {}) => {
    if (!address || !deps) {
      await openModal();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await unlockTrace(
          {
            onChainTraceId,
            wallet: address,
            // Never sign more than the price shown on the button.
            evaluate: conservativePolicy({ maxItemRaw: confirmedRaw, maxTotalRaw: confirmedRaw, spentRaw: () => 0n }),
            ...options,
          },
          deps,
        ),
      );
    } catch (err) {
      setError(err instanceof JournalUnavailableError ? err.message : describeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const state = result?.status === "unlocked" ? "unlocked" : (entry?.state ?? null);
  const button = (label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="px-4 py-2 bg-primary text-primary-foreground rounded font-label-caps text-label-caps hover:brightness-110 disabled:opacity-50"
    >
      {busy ? "Working…" : label}
    </button>
  );

  return (
    <section aria-label="Unlock this trace" className="bg-white border border-outline-variant rounded-xl p-6 space-y-3">
      <h2 className="font-headline-sm text-headline-sm">Unlock this trace</h2>

      {!journalAvailable ? (
        <p className="text-sm text-error">
          Browser storage is unavailable (private mode or blocked site data). OracleDesk won&apos;t sign an x402 payment it can&apos;t record.
        </p>
      ) : state === "unlocked" && result?.status === "unlocked" ? (
        <p className="text-sm text-on-surface">{verificationText(result)}</p>
      ) : state === "delivered" ? (
        <div className="space-y-2">
          <p className="text-sm text-on-surface">You already unlocked this trace. Checking it again costs nothing.</p>
          {button("Check content", () => run())}
        </div>
      ) : state === "signed" || state === "sent" || state === "failed-retryable" ? (
        <div className="space-y-2">
          <p className="text-sm text-on-surface">Your payment is saved; delivery will be retried with the same payment, never a new one.</p>
          {entry?.lastError && <p className="text-[12px] text-on-surface-variant">{entry.lastError}</p>}
          {button("Retry delivery", () => run())}
        </div>
      ) : state === "settled-undelivered" ? (
        <div className="space-y-2">
          <p className="text-sm text-error">You paid for this trace, but it wasn&apos;t delivered. Don&apos;t pay again; retry delivery or contact support with the evidence below.</p>
          {button("Retry delivery", () => run({ retryDelivery: true }))}
        </div>
      ) : state === "expired" ? (
        <div className="space-y-2">
          <p className="text-sm text-on-surface">Your previous payment expired without being charged, so paying again is safe.</p>
          {button(
            quoted ? `Pay again ${formatX402Amount(confirmedRaw, quoted)} (previous payment expired unpaid)` : "Pay again (previous payment expired unpaid)",
            () => run({ payAgainIfExpired: true }),
            !quoted,
          )}
        </div>
      ) : quote.isLoading ? (
        <p className="text-sm text-on-surface-variant">Checking the price…</p>
      ) : quote.data?.status === "free" ? (
        <div className="space-y-2">
          <p className="text-sm text-on-surface">This trace is already available to you; no payment is needed.</p>
          {button("Open trace", () => run())}
        </div>
      ) : quoted ? (
        button(`Unlock for ${formatX402Amount(confirmedRaw, quoted)}`, () => run())
      ) : (
        <p className="text-sm text-error">
          {quote.error instanceof Error ? quote.error.message : "The x402 service didn't offer a payment option for this network."}
        </p>
      )}

      {result?.status === "denied" && <p className="text-sm text-error">{result.message ?? `Not paid: ${result.reason}`}</p>}
      {result?.status === "retryable" && <p className="text-sm text-on-surface-variant">{result.error}</p>}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {entry && <EvidenceDrawer entry={entry} />}
    </section>
  );
}
