"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/lib/contexts/WalletContext";
import { usePaymentEvents, useTrace, useUnlockTrace } from "@/lib/hooks/useTraces";
import { useAccountReserve, usePrepareUsdcTransfer, useUsdcTransfer } from "@/lib/hooks/useStellar";
import type { PaymentEvent, TraceAccessLevel } from "@/lib/api/traces";
import { PAYMENTS_RECIPIENT, X402_URL, explorerTx } from "@/lib/stellar/config";
import { formatUsdc, formatXlm, parseUsdc } from "@/lib/stellar/units";
import type { TxPhase } from "@/lib/stellar/tx-lifecycle";
import type { ReviewModel } from "@/lib/stellar/tx-decode";
import { TxReview, TxReviewPreferenceControl, shouldSkipTxReview } from "@/components/tx-review";
import {
  deriveDailyPassExpiry,
  deriveUnlockRoutes,
  formatLockedFields,
  formatRoutePrice,
} from "@/lib/premium/trace-access";

/**
 * Fallback daily-pass price when the backend's GET /traces/:id didn't quote
 * one. The backend verifies the transfer against its own DAILY_PASS_PRICE_RAW
 * and rejects anything lower, so this must not be lower either.
 */
const DAILY_PASS_PRICE_RAW = parseUsdc(process.env.NEXT_PUBLIC_DAILY_PASS_PRICE_USDC || "0.5");

function renderTxPhase(phase: TxPhase): string | null {
  switch (phase.name) {
    case "building":
      return null;
    case "simulating":
      return "Simulating transaction…";
    case "awaiting-signature":
      return "Waiting for your wallet…";
    case "submitting":
      return "Sending to the network…";
    case "pending":
      return "Waiting for a ledger…";
    case "confirmed":
      return "Transaction confirmed.";
    case "failed":
      return phase.error.message;
    case "expired":
      return "Transaction expired without confirmation.";
  }
}

const ACCESS_LABELS: Record<TraceAccessLevel, string> = {
  FREE_PREVIEW: "Free preview",
  PER_TRACE: "Unlocked (this trace)",
  DAILY_PASS: "Daily pass active",
  NO_ACCESS: "No access",
};

function ReceiptRow({ event }: { event: PaymentEvent }) {
  const created = Number.isNaN(Date.parse(event.createdAt)) ? event.createdAt : new Date(event.createdAt).toLocaleString();
  const amount = /^\d+$/.test(event.amountRaw ?? "") ? formatUsdc(BigInt(event.amountRaw), { minDecimals: 2 }) : "—";
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-on-surface">
          {event.type === "DAILY_PASS" ? "Daily pass" : "Per-trace unlock"} · {amount} USDC
        </p>
        <p className="text-[11px] text-on-surface-variant">{created}</p>
      </div>
      {event.txHash ? (
        <a
          href={explorerTx(event.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-data-mono text-[11px] text-primary hover:underline shrink-0"
          title={event.txHash}
        >
          {event.txHash.slice(0, 10)}… <span className="material-symbols-outlined align-middle text-[12px]">open_in_new</span>
        </a>
      ) : (
        <span className="font-data-mono text-[11px] text-on-surface-variant">no tx hash</span>
      )}
    </li>
  );
}

export default function UnlockPremiumTracePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-64px)] bg-surface flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </main>
      }
    >
      <UnlockPremiumTraceContent />
    </Suspense>
  );
}

function UnlockPremiumTraceContent() {
  const searchParams = useSearchParams();
  const traceId = searchParams.get("traceId");

  const { address, isConnected, isWrongNetwork, openModal, ensureSession } = useWallet();
  const traceQuery = useTrace(traceId ?? undefined);
  const payments = usePaymentEvents();
  const unlock = useUnlockTrace();
  const transfer = useUsdcTransfer();
  const reserve = useAccountReserve(address);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [reviewModel, setReviewModel] = useState<{ model: ReviewModel; changedFrom?: ReviewModel } | null>(null);
  const reviewResolver = useRef<((approved: boolean) => void) | null>(null);

  const trace = traceQuery.data ?? null;
  const accessLevel: TraceAccessLevel | undefined = trace?.accessLevel;
  const routes = deriveUnlockRoutes(trace ?? {}, {
    x402Url: X402_URL,
    fallbackDailyPassPriceRaw: DAILY_PASS_PRICE_RAW,
  });
  const dailyRoute = routes.find((route) => route.kind === "DAILY_PASS") ?? null;
  const perTraceRoute = routes.find((route) => route.kind === "PER_TRACE") ?? null;
  const dailyPassExpiry = deriveDailyPassExpiry(payments.data ?? [], new Date());

  const prepareTransfer = usePrepareUsdcTransfer({
    to: PAYMENTS_RECIPIENT,
    amount: dailyRoute?.priceRaw ?? null,
    holder: address,
  });
  const fees = prepareTransfer.data?.fees;
  const isUnfunded = Boolean(reserve.data && !reserve.data.funded);
  const isInsufficientXlm = Boolean(reserve.data?.funded && fees && reserve.data.spendable < fees.totalFee);
  const xlmDeficit =
    reserve.data?.funded && fees && fees.totalFee > reserve.data.spendable ? fees.totalFee - reserve.data.spendable : null;

  const reviewPreparedTransfer = useCallback(async (_prepared: unknown, model: ReviewModel, changedFrom?: ReviewModel, forceReview = false) => {
    if (!forceReview && shouldSkipTxReview()) return true;
    return new Promise<boolean>((resolve) => {
      reviewResolver.current = resolve;
      setReviewModel({ model, changedFrom });
    });
  }, []);
  const closeReview = useCallback((approved: boolean) => {
    setReviewModel(null);
    const resolve = reviewResolver.current;
    reviewResolver.current = null;
    resolve?.(approved);
  }, []);

  useEffect(
    () => () => {
      const resolve = reviewResolver.current;
      reviewResolver.current = null;
      resolve?.(false);
    },
    [],
  );

  const handleBuyDailyPass = async () => {
    if (!traceId || !dailyRoute?.priceRaw || dailyRoute.priceRaw <= 0n) {
      setStatusMessage("The backend didn't quote a daily-pass price for this trace.");
      return;
    }
    if (!isConnected && !(await openModal())) return;
    if (isWrongNetwork) {
      setStatusMessage("Switch your wallet to Stellar Testnet to buy a daily pass.");
      return;
    }
    setIsSubmitting(true);
    try {
      setStatusMessage("One more signature: this logs you in to OracleDesk and doesn't move funds.");
      if (!(await ensureSession())) {
        setStatusMessage("You need to sign in with your wallet before paying.");
        return;
      }
      setStatusMessage(null);
      const amountRaw = dailyRoute.priceRaw.toString();
      const { txHash } = await transfer.mutateAsync({
        to: PAYMENTS_RECIPIENT,
        amount: dailyRoute.priceRaw,
        prepared: prepareTransfer.data,
        review: reviewPreparedTransfer,
        followUp: { type: "unlock-daily-pass", traceId, amountRaw },
      });

      setStatusMessage("Payment sent. Waiting for OracleDesk to verify it on-chain…");
      await unlock.mutateAsync({ traceId, txHash, amountRaw });
      setStatusMessage(`Daily pass active for 24 hours. Transaction ${txHash.slice(0, 10)}…`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The payment didn't go through.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!traceId) {
    return (
      <main className="min-h-[calc(100vh-64px)] px-gutter max-w-container-max-width mx-auto py-16 text-center">
        <span className="material-symbols-outlined text-outline-variant text-6xl mb-4">lock</span>
        <h1 className="font-headline-md text-headline-md text-on-surface mb-2">Premium Trace Access</h1>
        <p className="text-body-md text-on-surface-variant mb-6">
          Open this page from a reasoning trace to see its access state, prices and payment receipts.
        </p>
        <Link href="/reasoning" className="bg-primary text-on-primary px-6 py-2 rounded-lg font-label-caps uppercase">
          Browse reasoning traces
        </Link>
      </main>
    );
  }

  if (traceQuery.isLoading) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-surface flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </main>
    );
  }

  if (traceQuery.isError || !trace) {
    return (
      <main className="min-h-[calc(100vh-64px)] px-gutter max-w-container-max-width mx-auto py-16 text-center">
        <span className="material-symbols-outlined text-error text-6xl mb-4">error</span>
        <h1 className="font-headline-md text-headline-md text-on-surface mb-2">Trace not found</h1>
        <p className="text-body-md text-on-surface-variant mb-6">
          {traceQuery.error instanceof Error ? traceQuery.error.message : "We couldn't load this reasoning trace."}
        </p>
        <Link href="/reasoning" className="bg-primary text-on-primary px-6 py-2 rounded-lg font-label-caps uppercase">
          Back to reasoning
        </Link>
      </main>
    );
  }

  const lockedFields = formatLockedFields(trace.lockedFields);

  return (
    <main className="min-h-[calc(100vh-64px)] px-gutter max-w-container-max-width mx-auto py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trace & access state */}
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white border border-outline-variant p-6 md:p-8 rounded-xl shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">Reasoning Trace</p>
                <h1 className="font-headline-md text-headline-md text-on-surface">{trace.market.question}</h1>
                <p className="mt-2 font-data-mono text-[12px] text-on-surface-variant">
                  {trace.agentType} · edge {Math.round(trace.edge * 100)}% · estimate{" "}
                  {Math.round(trace.probabilityEstimate * 100)}% · {new Date(trace.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`inline-block px-3 py-1 rounded-full font-label-caps text-label-caps font-bold ${
                    accessLevel === "DAILY_PASS" || accessLevel === "PER_TRACE"
                      ? "bg-secondary-container text-on-secondary-container"
                      : "bg-surface-container-highest text-on-surface-variant"
                  }`}
                >
                  {accessLevel ? ACCESS_LABELS[accessLevel] : "Access unknown"}
                </span>
                {accessLevel === "DAILY_PASS" && dailyPassExpiry && (
                  <p className="mt-2 text-[11px] text-on-surface-variant">
                    Active until {dailyPassExpiry.toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {lockedFields.length > 0 && (
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
                <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">Locked for you right now</p>
                <ul className="flex flex-wrap gap-2">
                  {lockedFields.map((field) => (
                    <li key={field} className="font-data-mono text-[11px] bg-surface-container text-on-surface px-2 py-1 rounded">
                      {field}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {accessLevel === "FREE_PREVIEW" && lockedFields.length === 0 && (
              <p className="text-sm text-on-surface-variant">
                You see the preview. The full trace unlocks with a daily pass below.
              </p>
            )}
            {accessLevel === "DAILY_PASS" && (
              <p className="text-sm text-on-surface-variant">
                Your daily pass covers every trace for 24 hours from each verified payment.
              </p>
            )}
          </section>

          {/* Unlock routes with the backend's real prices */}
          <section className="bg-white border border-outline-variant p-6 rounded-xl shadow-sm">
            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4">Unlock options</h2>
            <div className="space-y-4">
              {dailyRoute && (
                <div className="flex flex-col gap-3 rounded-lg border border-outline-variant p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-headline-sm text-headline-sm text-on-surface">24-hour daily pass</p>
                    <p className="text-xs text-on-surface-variant">
                      Every trace, all markets. One USDC transfer to {PAYMENTS_RECIPIENT.slice(0, 8)}…{PAYMENTS_RECIPIENT.slice(-6)},
                      verified on-chain by OracleDesk before access is granted.
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <span className="font-data-mono text-headline-sm text-primary">{formatRoutePrice(dailyRoute.priceRaw)}</span>
                    {accessLevel !== "DAILY_PASS" && (
                      <button
                        type="button"
                        onClick={() => void handleBuyDailyPass()}
                        disabled={isSubmitting || transfer.isPending || !dailyRoute.priceRaw}
                        className="bg-primary text-on-primary px-4 py-2 rounded-lg font-label-caps text-label-caps font-bold disabled:opacity-50"
                      >
                        {isSubmitting || transfer.isPending
                          ? transfer.phase.name === "awaiting-signature"
                            ? "Signing…"
                            : "Processing…"
                          : "Buy daily pass"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {perTraceRoute && X402_URL && (
                <div className="flex flex-col gap-3 rounded-lg border border-outline-variant p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-headline-sm text-headline-sm text-on-surface">This trace only</p>
                    <p className="text-xs text-on-surface-variant">
                      Per-trace unlocks are paid directly to the contracts repo&apos;s x402 service
                      {" "}(<span className="font-data-mono">{X402_URL}</span>). The in-app pay button lands with the
                      x402 client; until then use the service directly.
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <span className="font-data-mono text-headline-sm text-primary">{formatRoutePrice(perTraceRoute.priceRaw)}</span>
                    {perTraceRoute.available ? (
                      <span className="text-[11px] font-label-caps text-on-surface-variant uppercase">
                        Paid via x402 · not wired in this client yet
                      </span>
                    ) : (
                      <span className="text-[11px] text-on-surface-variant">{perTraceRoute.reason}</span>
                    )}
                  </div>
                </div>
              )}

              {!isConnected && (
                <p className="text-xs text-on-surface-variant">
                  Connect your wallet to pay. Your wallet signs the transfer; OracleDesk never signs for you.
                </p>
              )}
              {isWrongNetwork && <p className="text-xs text-error">Switch your wallet to Stellar Testnet to pay.</p>}
              {isConnected && isUnfunded && (
                <p className="text-xs text-error font-medium" role="alert">
                  Fund this account with XLM first.
                </p>
              )}
              {isConnected && isInsufficientXlm && xlmDeficit !== null && (
                <p className="text-xs text-error font-medium" role="alert">
                  You need about {formatXlm(xlmDeficit)} more XLM to pay the network fee.
                </p>
              )}

              {transfer.isPending && (
                <div className="p-3 bg-primary-container/10 border border-primary/20 rounded text-primary text-xs font-bold flex items-center justify-between" role="status">
                  <span>{renderTxPhase(transfer.phase) ?? "Processing payment…"}</span>
                  {"hash" in transfer.phase && transfer.phase.hash && (
                    <a
                      href={explorerTx(transfer.phase.hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-data-mono"
                    >
                      View: {transfer.phase.hash.slice(0, 8)}…
                    </a>
                  )}
                </div>
              )}
              {!transfer.isPending && statusMessage && (
                <div className="p-3 bg-primary-container/10 border border-primary/20 rounded text-primary text-xs font-bold break-all" role="status">
                  {statusMessage}
                </div>
              )}
              <div className="text-center">
                <TxReviewPreferenceControl />
              </div>
            </div>
          </section>
        </div>

        {/* Receipts */}
        <aside className="lg:col-span-4">
          <section className="bg-white border border-outline-variant p-6 rounded-xl shadow-sm">
            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-1">Payment receipts</h2>
            <p className="text-xs text-on-surface-variant mb-4">
              Verified payments recorded by OracleDesk (<span className="font-data-mono">GET /traces/payments</span>).
            </p>
            {payments.isError && (
              <p className="text-sm text-error" role="alert">
                We couldn&apos;t load your receipts. {payments.error instanceof Error ? payments.error.message : ""}
              </p>
            )}
            {payments.isLoading && <p className="text-sm text-on-surface-variant">Loading receipts…</p>}
            {payments.data && payments.data.length === 0 && (
              <p className="text-sm text-on-surface-variant">No verified payments yet.</p>
            )}
            {payments.data && payments.data.length > 0 && (
              <ul className="divide-y divide-outline-variant rounded border border-outline-variant">
                {payments.data.map((event, index) => (
                  <ReceiptRow key={event.id ?? event.txHash ?? index} event={event} />
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      {reviewModel && (
        <TxReview
          model={reviewModel.model}
          changedFrom={reviewModel.changedFrom}
          onConfirm={() => closeReview(true)}
          onCancel={() => closeReview(false)}
        />
      )}
    </main>
  );
}
