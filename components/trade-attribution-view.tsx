"use client";

import React, { useState } from "react";
import { TradeAttributionMatch } from "@/lib/services/trade-attribution";

interface TradeAttributionViewProps {
  attributions: TradeAttributionMatch[];
  isLoading?: boolean;
  error?: string | null;
}

export function TradeAttributionView({
  attributions,
  isLoading = false,
  error = null,
}: TradeAttributionViewProps) {
  const [filter, setFilter] = useState<"all" | "flagged" | "verified">("all");

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 bg-surface-container-low animate-pulse rounded-lg border border-outline-variant"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-surface-container-low rounded-lg border border-error/20">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  const flaggedAttributions = attributions.filter((a) => !!a.flag);
  const verifiedAttributions = attributions.filter(
    (a) => a.trace && a.confidence === "high",
  );

  let filtered = attributions;
  if (filter === "flagged") {
    filtered = flaggedAttributions;
  } else if (filter === "verified") {
    filtered = verifiedAttributions;
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded font-label-caps text-label-caps text-xs transition-colors ${
            filter === "all"
              ? "bg-primary text-on-primary"
              : "bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high"
          }`}
        >
          All ({attributions.length})
        </button>
        <button
          onClick={() => setFilter("verified")}
          className={`px-4 py-2 rounded font-label-caps text-label-caps text-xs transition-colors ${
            filter === "verified"
              ? "bg-secondary text-on-secondary"
              : "bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high"
          }`}
        >
          Verified ({verifiedAttributions.length})
        </button>
        <button
          onClick={() => setFilter("flagged")}
          className={`px-4 py-2 rounded font-label-caps text-label-caps text-xs transition-colors ${
            filter === "flagged"
              ? "bg-tertiary text-on-tertiary"
              : "bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high"
          }`}
        >
          Flagged ({flaggedAttributions.length})
        </button>
      </div>

      {/* Attributions List */}
      {filtered.length === 0 ? (
        <div className="p-6 text-center bg-surface-container-low rounded-lg border border-outline-variant">
          <p className="text-on-surface-variant">
            {filter === "all"
              ? "No trades to attribute."
              : `No ${filter} attributions found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((attribution, idx) => {
            const confidenceColor =
              attribution.confidence === "high"
                ? "bg-secondary/10 border-secondary/30"
                : attribution.confidence === "medium"
                  ? "bg-primary/10 border-primary/30"
                  : attribution.confidence === "low"
                    ? "bg-tertiary/10 border-tertiary/30"
                    : "bg-on-surface-variant/10 border-on-surface-variant/30";

            const confidenceLabel =
              attribution.confidence === "high"
                ? "High confidence"
                : attribution.confidence === "medium"
                  ? "Medium confidence"
                  : attribution.confidence === "low"
                    ? "Low confidence"
                    : "Unverified";

            return (
              <div
                key={idx}
                className={`p-4 border rounded-lg ${confidenceColor} transition-colors hover:bg-opacity-20`}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-label-caps text-label-caps text-on-surface">
                        Market {attribution.trade.marketId}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-label-caps font-bold ${
                          attribution.trade.outcome === "YES"
                            ? "bg-secondary/20 text-secondary"
                            : "bg-tertiary/20 text-tertiary"
                        }`}
                      >
                        {attribution.trade.outcome}
                      </span>
                    </div>
                    <p className="text-on-surface-variant text-sm">
                      {(attribution.trade.shares).toLocaleString()} shares @ {attribution.trade.collateral.toFixed(2)} USDC
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-label-caps text-on-surface-variant mb-1">
                      {confidenceLabel}
                    </div>
                    {attribution.flag && (
                      <span className="px-2 py-1 bg-tertiary/30 text-tertiary rounded text-[10px] font-label-caps font-bold block">
                        {attribution.flag}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-surface rounded text-sm">
                  <p className="text-on-surface-variant text-xs mb-2">{attribution.reason}</p>
                  {attribution.trace && (
                    <div className="text-xs text-on-surface">
                      <span className="font-bold">Matching trace:</span>
                      <span className="font-data-mono ml-2 break-all">
                        {attribution.trace.traceId.substring(0, 16)}...
                      </span>
                      {attribution.trace.onChainTraceId && (
                        <div className="mt-1 text-on-surface-variant">
                          On-chain ID: {attribution.trace.onChainTraceId}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-3 text-xs text-on-surface-variant">
                  <span className="font-data-mono">
                    {new Date(attribution.trade.timestamp).toLocaleString()}
                  </span>
                  {attribution.trade.txHash && (
                    <span className="font-data-mono break-all">TX: {attribution.trade.txHash.substring(0, 12)}...</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
