"use client";

import Link from "next/link";
import { useWallet } from "@/lib/contexts/WalletContext";
import { X402_ENABLED, useOpenX402Payments } from "@/lib/hooks/useX402";

/**
 * App-wide notice for x402 payments that were signed but not delivered, so a
 * reload or crash mid-unlock is never forgotten. Renders nothing otherwise.
 */
export function X402RecoveryBanner() {
  const { address } = useWallet();
  const { open } = useOpenX402Payments(X402_ENABLED ? address : null);
  if (open.length === 0) return null;

  const paid = open.filter((entry) => entry.state === "settled-undelivered").length;
  const text =
    paid > 0
      ? `You have ${paid} paid trace${paid === 1 ? "" : "s"} that ${paid === 1 ? "wasn't" : "weren't"} delivered.`
      : `You have ${open.length} saved trace payment${open.length === 1 ? "" : "s"} waiting for delivery.`;

  return (
    <div role="status" className="bg-tertiary-container text-on-tertiary-container px-gutter py-2 text-sm flex flex-wrap items-center justify-center gap-3">
      <span>{text}</span>
      <Link href={`/reasoning/detail?onChainTraceId=${encodeURIComponent(open[0].onChainTraceId)}`} className="font-semibold underline">
        Review
      </Link>
    </div>
  );
}
