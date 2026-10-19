"use client";

import React, { useState } from "react";
import { BuyConfirmationSheet } from "@/components/demo/buy-confirmation-sheet";
import { DemoBadge } from "@/components/ui/demo-badge";

/** Gallery version of the retired buy-no-demo screen (issue #49). */
export function BuyNoDemoScreen() {
  const [amount, setAmount] = useState("1000.00");

  const price = 0.68;
  const numeric = parseFloat(amount) || 0;
  const shares = numeric / price;
  const fee = numeric * 0.01;
  const priceImpact = Math.min(0.99, shares ? numeric / Math.max(shares, 1) * 0.002 : 0);

  return (
    <div className="relative flex min-h-[560px] items-center justify-center rounded-lg bg-surface-container-low/40 p-6">
      <div className="absolute top-4 left-4">
        <DemoBadge />
      </div>
      <BuyConfirmationSheet
        eyebrow="Execution Terminal"
        title={
          <>
            Buy <span className="text-tertiary">NO</span> Shares
          </>
        }
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
          { label: "Trading fee", value: `${fee.toFixed(2)} USDC` },
          { label: "Estimated price impact", value: `${(priceImpact * 100).toFixed(2)}%` },
          { label: "Avg. Purchase Price", value: `${price} USDC` },
          {
            label: "Potential Payout",
            value: `${shares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
            emphasis: true,
            sub: "+47.06% Return",
          },
        ]}
        insight={{
          icon: "insights",
          text: (
            <>
              <span className="font-bold text-tertiary">Oracle Insight:</span> Market sentiment has shifted 4% toward
              &apos;NO&apos; in the last hour following the latest legislative session report. (Sample insight.)
            </>
          ),
        }}
        action={{ label: "BUY NO", tone: "no", onAction: () => undefined }}
        footnote="Orders are final and cannot be cancelled once executed on-chain."
      />
    </div>
  );
}
