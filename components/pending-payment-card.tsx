"use client";

import React, { useState } from "react";
import { terminalMessage } from "@/lib/payments/classify";
import type { PendingPayment } from "@/lib/payments/pending";
import { explorerTx } from "@/lib/stellar/config";
import { formatUsdc } from "@/lib/stellar/units";

interface PendingPaymentCardProps {
  payment: PendingPayment;
  busy: boolean;
  wrongNetwork: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

function supportSummary(payment: PendingPayment): string {
  return [
    "OracleDesk daily pass payment",
    `Transaction: ${payment.txHash}`,
    `Amount (raw, 7 decimals): ${payment.amountRaw}`,
    `From: ${payment.from}`,
    `Recipient: ${payment.recipient}`,
    `Status: ${payment.state}`,
    payment.lastError ? `Error: ${payment.lastError.code}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function PendingPaymentCard({ payment, busy, wrongNetwork, onRetry, onDismiss }: PendingPaymentCardProps) {
  const [copied, setCopied] = useState(false);
  const failed = payment.state === "failed-terminal";
  const needsSignIn = payment.state === "needs-auth";
  const amount = formatUsdc(BigInt(payment.amountRaw), { minDecimals: 2 });

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(supportSummary(payment));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  let heading = "Payment received. Finishing activation.";
  let body = busy
    ? "Checking with OracleDesk…"
    : "We'll keep trying. You don't need to pay again.";
  if (needsSignIn) {
    heading = "Sign in to finish activating your pass.";
    body = "Your payment is safe and you won't be charged again.";
  }
  if (failed) {
    heading = "Your pass wasn't activated.";
    body = terminalMessage(payment.lastError?.code ?? "UNKNOWN");
  }
  if (wrongNetwork && !failed) {
    body = "Switch your wallet to Stellar Testnet to finish activating.";
  }

  return (
    <div className="bg-white border border-outline-variant rounded-xl p-4 space-y-3" role="status">
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-body-md font-bold">{heading}</p>
        <span className="font-data-mono text-xs text-on-surface-variant">{amount} USDC</span>
      </div>
      <p className="text-sm text-on-surface-variant">{body}</p>
      <a
        href={explorerTx(payment.txHash)}
        target="_blank"
        rel="noopener noreferrer"
        className="underline font-data-mono text-xs break-all"
      >
        View transaction {payment.txHash.slice(0, 8)}…
      </a>
      <div className="flex flex-wrap gap-2">
        {!failed && (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy || wrongNetwork}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-50"
          >
            {needsSignIn ? "Sign in and activate" : "Try again"}
          </button>
        )}
        {failed && (
          <>
            <button
              type="button"
              onClick={copyDetails}
              className="px-4 py-2 border border-outline-variant rounded-lg text-xs font-bold"
            >
              {copied ? "Copied" : "Copy details"}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 border border-outline-variant rounded-lg text-xs font-bold"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
