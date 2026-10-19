"use client";

import { useRedeem } from "@/lib/hooks/useStellar";
import type { Market, Position } from "@/lib/stellar/generated/market-core";

/**
 * Shown on quick-view when opened from a push notification (?from=push).
 * The push only carried an id; the status here is the chain's own get_market,
 * and Redeem appears only when get_position shows a winning balance.
 */
export function PushVerifiedStatus({ marketId, market, position }: { marketId: string; market: Market; position: Position | null }) {
  const redeem = useRedeem();
  const status = market.status;

  let text: string;
  let canRedeem = false;
  if (status.tag === "Resolved") {
    const outcome = status.values[0].tag;
    text = `Verified on-chain: this market resolved ${outcome.toUpperCase()}.`;
    const winning = position ? (outcome === "Yes" ? position.yes : position.no) : 0n;
    canRedeem = winning > 0n;
  } else if (status.tag === "Void") {
    text = "Verified on-chain: this market was voided.";
    canRedeem = Boolean(position && (position.yes > 0n || position.no > 0n));
  } else {
    text = "Verified on-chain: this market is still open. The update you were notified about may not be final yet.";
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3" role="status">
      <p className="text-sm text-on-surface">{text}</p>
      {canRedeem && (
        <button
          type="button"
          onClick={() => redeem.mutate({ marketId })}
          disabled={redeem.isPending}
          className="px-4 py-2 bg-primary text-white rounded-lg font-label-caps text-label-caps disabled:opacity-60"
        >
          {redeem.isPending ? "Redeeming…" : "Redeem"}
        </button>
      )}
      {redeem.error && <p className="w-full text-sm text-error">{redeem.error.message}</p>}
    </div>
  );
}
