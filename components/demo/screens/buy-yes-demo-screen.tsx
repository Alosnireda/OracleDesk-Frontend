"use client";

import React, { useState } from "react";
import { BuyConfirmationSheet } from "@/components/demo/buy-confirmation-sheet";
import { DemoBadge } from "@/components/ui/demo-badge";

/** Gallery version of the retired buy-yes-demo screen (issue #49). */
export function BuyYesDemoScreen() {
  const [amount, setAmount] = useState("1000.00");

  const price = 0.64;
  const numeric = parseFloat(amount) || 0;
  const shares = numeric / price;
  const potentialPayout = shares;
  const maxProfit = potentialPayout - numeric;
  const profitPercentage = ((maxProfit / (numeric || 1)) * 100).toFixed(1);

  return (
    <div className="relative flex min-h-[560px] items-center justify-center rounded-lg bg-surface-container-low/40 p-6">
      <div className="absolute top-4 left-4">
        <DemoBadge />
      </div>
      <BuyConfirmationSheet
        eyebrow="Active Market"
        title="US GDP Growth exceeds 3.0% in Q4 2026?"
        yesPercent={64}
        noPercent={36}
        amount={amount}
        onAmountChange={setAmount}
        available="14,250.40 USDC"
        details={[
          {
            label: "Estimated Shares",
            value: shares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          },
          {
            label: "Potential Payout",
            value: `${potentialPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
            emphasis: true,
          },
          { label: "Avg Price", value: `${price} USDC` },
          {
            label: "Max Profit",
            value: `+${maxProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${profitPercentage}%)`,
          },
        ]}
        insight={{
          icon: "psychology",
          text: "Recent labor market data suggest a 12% increase in probability for “Yes” within the last 4 hours. (Sample insight.)",
        }}
        action={{ label: "BUY YES", tone: "yes", onAction: () => undefined }}
        footnote="Orders are final and cannot be cancelled once executed on-chain."
      />
    </div>
  );
}
