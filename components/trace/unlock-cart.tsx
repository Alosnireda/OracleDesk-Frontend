"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/contexts/WalletContext";
import { X402_ENABLED, useUnlockCart, useX402UnlockDeps } from "@/lib/hooks/useX402";
import { unlockTrace } from "@/lib/x402/client";
import {
  planCheckout,
  receiptToJson,
  runCheckout,
  type CartItem,
  type CartStatus,
  type CheckoutReceipt,
  type PriceChangeChoice,
} from "@/lib/x402/cart";
import { formatX402Amount } from "@/lib/x402/format";
import { STELLAR_NETWORK_ID } from "@/lib/stellar/config";

const STATUS_LABEL: Record<CartStatus, string> = {
  queued: "Queued",
  quoting: "Getting price",
  ready: "Ready",
  paying: "Paying",
  verifying: "Verifying",
  unlocked: "Unlocked",
  skipped: "Skipped",
  failed: "Failed",
};

interface PriceDecision {
  item: CartItem;
  quotedRaw: bigint;
  newRaw: bigint;
  resolve: (choice: PriceChangeChoice) => void;
}

function priceText(item: CartItem): string {
  if (item.quote) return formatX402Amount(item.quote.amountRaw, item.quote.requirement);
  if (item.hintPriceRaw !== undefined) return `about ${formatX402Amount(item.hintPriceRaw, null)} (not yet quoted)`;
  return "—";
}

function downloadReceipt(receipt: CheckoutReceipt) {
  const url = URL.createObjectURL(new Blob([receiptToJson(receipt)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `oracledesk-x402-receipt-${receipt.finishedAt.replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Drawer for unlocking several traces in one guided checkout. Each item is
 * still its own x402 payment and wallet prompt; prices come from each trace's
 * live 402, and every payment goes through the recovery journal.
 */
export function UnlockCart({ cart, dailyPassPriceRaw }: { cart: ReturnType<typeof useUnlockCart>; dailyPassPriceRaw: bigint | null }) {
  const { address, openModal } = useWallet();
  const deps = useX402UnlockDeps();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [decision, setDecision] = useState<PriceDecision | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runWallet = useRef<string | null>(null);
  const { items, quote, pendingQuotes } = cart;

  // Quote new items while the drawer is open (from each trace's live 402).
  useEffect(() => {
    if (open && !running && pendingQuotes > 0) void quote();
  }, [open, running, pendingQuotes, quote]);

  // A disconnect or account switch ends the run; the partial receipt stays.
  useEffect(() => {
    if (running && runWallet.current !== address) controller.current?.abort("wallet-changed");
  }, [address, running]);

  if (!X402_ENABLED || items.length === 0) return null;

  const plan = planCheckout(items, { remainingTodayRaw: null, dailyPassPriceRaw });
  const ready = plan.affordable;
  const pricing = ready.find((item) => item.quote?.requirement)?.quote?.requirement ?? null;

  const start = async () => {
    if (!address || !deps) {
      await openModal();
      return;
    }
    controller.current = new AbortController();
    runWallet.current = address;
    setRunning(true);
    setReceipt(null);
    try {
      const result = await runCheckout(
        ready,
        {
          wallet: address,
          network: STELLAR_NETWORK_ID,
          unlock: (item, evaluate) =>
            unlockTrace({ onChainTraceId: item.onChainTraceId, wallet: address, evaluate, payAgainIfExpired: true }, deps),
          confirmedTotalRaw: plan.totalRaw,
          decidePriceChange: (item, quotedRaw, newRaw) => new Promise((resolve) => setDecision({ item, quotedRaw, newRaw, resolve })),
        },
        cart.updateItem,
        controller.current.signal,
      );
      setReceipt(result);
    } finally {
      setRunning(false);
      setDecision(null);
    }
  };

  const decide = (choice: PriceChangeChoice) => {
    decision?.resolve(choice);
    setDecision(null);
  };

  const finish = () => {
    for (const line of receipt?.lines ?? []) if (line.status === "unlocked") cart.remove(line.onChainTraceId);
    setReceipt(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 px-5 py-3 bg-primary text-primary-foreground rounded-full shadow-lg font-label-caps text-label-caps flex items-center gap-2"
      >
        <span className="material-symbols-outlined" aria-hidden>
          shopping_cart
        </span>
        Unlock list ({items.length})
      </button>

      {open && (
        <aside role="dialog" aria-label="Unlock list" className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-surface border-l border-outline-variant shadow-xl flex flex-col">
          <div className="p-6 border-b border-outline-variant flex items-center justify-between">
            <h2 className="font-headline-sm text-headline-sm">Unlock list</h2>
            <button type="button" onClick={() => setOpen(false)} disabled={running} className="text-on-surface-variant hover:text-on-surface disabled:opacity-50" aria-label="Close unlock list">
              <span className="material-symbols-outlined" aria-hidden>
                close
              </span>
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto divide-y divide-outline-variant">
            {items.map((item) => (
              <li key={item.onChainTraceId} className="p-4 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-on-surface">{item.marketQuestion}</p>
                  {!running && !receipt && (
                    <button type="button" onClick={() => cart.remove(item.onChainTraceId)} className="text-[12px] text-on-surface-variant hover:underline shrink-0">
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[12px] text-on-surface-variant">
                  <span className="font-data-mono">On-chain #{item.onChainTraceId}</span>
                  <span className="font-data-mono">{priceText(item)}</span>
                  <span className="px-2 py-0.5 rounded bg-surface-container-high font-label-caps text-[10px] uppercase">{STATUS_LABEL[item.status]}</span>
                </div>
                {item.reason && <p className="text-[12px] text-error">{item.reason}</p>}
                {item.status === "failed" && !item.quote && !running && (
                  <button
                    type="button"
                    onClick={() => cart.updateItem({ ...item, status: "queued", reason: undefined })}
                    className="text-[12px] text-primary hover:underline"
                  >
                    Retry price
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="p-6 border-t border-outline-variant space-y-3">
            {decision ? (
              <div role="alertdialog" aria-label="Price changed" className="space-y-2">
                <p className="text-sm text-on-surface">
                  The price of &quot;{decision.item.marketQuestion}&quot; rose from {formatX402Amount(decision.quotedRaw, pricing, true)} to{" "}
                  {formatX402Amount(decision.newRaw, pricing, true)}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => decide("accept")} className="px-3 py-2 bg-primary text-primary-foreground rounded text-sm">
                    Accept for this trace
                  </button>
                  <button type="button" onClick={() => decide("accept-all")} className="px-3 py-2 border border-primary text-primary rounded text-sm">
                    Accept for all remaining
                  </button>
                  <button type="button" onClick={() => decide("skip")} className="px-3 py-2 border border-outline rounded text-sm">
                    Skip
                  </button>
                </div>
              </div>
            ) : receipt ? (
              <div className="space-y-2">
                <p className="text-sm text-on-surface">
                  Paid {formatX402Amount(receipt.totalPaidRaw, pricing, true)} for {receipt.lines.filter((l) => l.status === "unlocked").length} of {receipt.lines.length} traces.
                </p>
                {receipt.needsSupport && (
                  <p className="text-sm text-error">Some payments went through without a verified unlock. Keep this receipt for support; reopening those traces retries delivery without paying again.</p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => downloadReceipt(receipt)} className="px-3 py-2 border border-primary text-primary rounded text-sm">
                    Download receipt (JSON)
                  </button>
                  <button type="button" onClick={finish} className="px-3 py-2 bg-primary text-primary-foreground rounded text-sm">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-on-surface">
                  Total for {ready.length} trace{ready.length === 1 ? "" : "s"}:{" "}
                  <span className="font-data-mono">{formatX402Amount(plan.totalRaw, pricing, true)}</span>
                </p>
                <p className="text-[12px] text-on-surface-variant">Each trace is a separate payment and wallet prompt. Prices are checked again right before each one.</p>
                {plan.recommendDailyPass && dailyPassPriceRaw !== null && (
                  <p className="text-sm text-on-surface">
                    Unlocking these {ready.length} traces costs {formatX402Amount(plan.totalRaw, pricing)}. A daily pass costs{" "}
                    {formatX402Amount(dailyPassPriceRaw, null)} and unlocks every trace for 24 hours.{" "}
                    <Link href="/premium" className="text-primary font-semibold hover:underline">
                      Get a daily pass
                    </Link>
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={start}
                    disabled={running || ready.length === 0}
                    className="flex-1 px-4 py-3 bg-primary text-primary-foreground rounded font-label-caps text-label-caps disabled:opacity-50"
                  >
                    {running ? "Checking out…" : address ? "Start checkout" : "Connect wallet"}
                  </button>
                  {running && (
                    <button type="button" onClick={() => controller.current?.abort("cancelled")} className="px-4 py-3 border border-outline rounded font-label-caps text-label-caps">
                      Cancel
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
