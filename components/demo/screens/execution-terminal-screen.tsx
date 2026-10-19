"use client";

import React, { useState } from "react";
import { BuyConfirmationSheet } from "@/components/demo/buy-confirmation-sheet";
import { DemoBadge } from "@/components/ui/demo-badge";

/** Gallery version of the retired execution-terminal screen (issue #49). */
export function ExecutionTerminalScreen() {
  const [amount, setAmount] = useState("1000.00");
  const [lastAction, setLastAction] = useState<string | null>(null);

  const price = 0.68;
  const shares = (parseFloat(amount) || 0) / price;

  return (
    <div className="relative flex min-h-[560px] items-center justify-center rounded-lg bg-surface-container-low/40 p-6">
      <div className="absolute top-4 left-4">
        <DemoBadge />
      </div>
      <div className="space-y-4">
        <BuyConfirmationSheet
          eyebrow="Execution Terminal"
          title="Buy Shares"
          yesPercent={32}
          noPercent={68}
          amount={amount}
          onAmountChange={setAmount}
          available="24,500.00 USDC"
          details={[
            {
              label: "Estimated Shares",
              value: shares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            },
            { label: "Avg. Purchase Price", value: `${price} USDC` },
            {
              label: "Potential Payout",
              value: `${shares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
              emphasis: true,
              sub: "+47.06% Return",
            },
          ]}
          action={{ label: "BUY YES", tone: "yes", onAction: () => setLastAction("BUY YES") }}
          footnote="Orders are final and cannot be cancelled once executed on-chain."
        />
        <button
          type="button"
          onClick={() => setLastAction("BUY NO")}
          className="w-full bg-tertiary text-white py-3 rounded-lg font-headline-sm text-headline-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2"
        >
          <span>BUY NO</span>
          <span className="material-symbols-outlined text-xl">trending_down</span>
        </button>
        {lastAction && (
          <p className="text-center text-xs text-on-surface-variant" role="status">
            Sample only: no transaction was built for {lastAction}.
          </p>
        )}
      </div>
    </div>
  );
}
