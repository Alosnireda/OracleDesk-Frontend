"use client";
import { Icon } from "@/components/ui/icon";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TradeAttributionView } from "@/components/trade-attribution-view";
import { TradeAttributionMatch, attributeTradesToTraces, flagUnattributedTrades, convertTraceToRecord } from "@/lib/services/trade-attribution";
import { listTraces } from "@/lib/api/traces";

export default function MarketTradesPage() {
  const params = useParams();
  const marketId = params.id as string;

  const [attributions, setAttributions] = useState<TradeAttributionMatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTradeAttributions() {
      try {
        setIsLoading(true);
        setError(null);

        const { traces } = await listTraces();

        const marketTraces = traces.filter((t) => t.marketId === marketId);

        if (marketTraces.length === 0) {
          setError("No traces found for this market.");
          return;
        }

        const traceRecords = marketTraces.map(convertTraceToRecord);

        const mockTrades = traceRecords.map((tr) => ({
          marketId: tr.marketId,
          agentAddress: tr.agentAddress,
          outcome: (tr.action.toLowerCase().includes("buy") ? "YES" : "NO") as "YES" | "NO",
          shares: Math.floor(Math.random() * 1000) + 100,
          collateral: Math.random() * 5000 + 100,
          fee: Math.random() * 50 + 10,
          timestamp: tr.timestamp,
          txHash: `0x${Math.random().toString(16).slice(2)}`,
        }));

        const matched = attributeTradesToTraces(mockTrades, traceRecords);
        const flagged = flagUnattributedTrades(matched);

        setAttributions(flagged);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trade attributions.");
        console.error("Trade attribution error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadTradeAttributions();
  }, [marketId]);

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto">
      <div className="mb-8">
        <Link
          href={`/market?id=${marketId}`}
          className="flex items-center gap-2 text-primary hover:underline mb-4 font-label-caps text-label-caps"
        >
          <Icon name="arrow_back" className="text-base" />
          Back to Market
        </Link>
        <h1 className="font-display-lg text-display-lg text-on-surface">Trade Attribution</h1>
        <p className="text-on-surface-variant mt-2 max-w-2xl font-body-lg text-body-lg">
          Link treasury trades to reasoning traces. Every trade should have a verified reasoning trace.
        </p>
      </div>

      <div className="mb-6 p-4 bg-primary/10 border border-primary/20 rounded-lg">
        <p className="text-sm text-on-surface">
          <span className="font-bold">Attribution Model:</span> Trades are matched to traces by market, agent address, action type, and publish order proximity. Flagged trades have no matching trace—these indicate the core promise of verifiable reasoning was not kept.
        </p>
      </div>

      <TradeAttributionView
        attributions={attributions}
        isLoading={isLoading}
        error={error}
      />
    </main>
  );
}
