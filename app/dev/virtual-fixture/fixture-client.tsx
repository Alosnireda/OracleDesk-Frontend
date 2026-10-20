"use client";

import React, { useState, useEffect, useRef } from "react";
import type { Market } from "@/lib/api/markets";
import { VirtualList } from "@/components/ui/virtual-list";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

function SimpleCard({ market, disableEntrance }: { market: Market; disableEntrance?: boolean }) {
  const yesProb = Math.round((market.currentYesProb ?? market.initialYesProb) * 100);
  const noProb = 100 - yesProb;

  return (
    <div
      data-testid="fixture-market-card"
      className="bg-surface border border-outline-variant rounded-xl p-5 hover:shadow-lg transition-all flex flex-col justify-between h-[280px]"
    >
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="px-2 py-0.5 rounded text-label-caps font-bold uppercase bg-surface-container-highest text-on-surface-variant">
            {market.category}
          </span>
          <span className="font-data-mono text-label-caps text-on-surface-variant">
            ID: {market.id}
          </span>
        </div>
        <h3 className="font-headline-sm text-headline-sm text-on-surface line-clamp-2 mb-4">
          {market.question}
        </h3>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-label-caps font-label-caps mb-1.5">
            <span className="text-secondary font-bold">YES {yesProb}%</span>
            <span className="text-tertiary font-bold">NO {noProb}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-outline-variant overflow-hidden flex">
            <div
              style={{ width: `${yesProb}%` }}
              className={`h-full bg-secondary ${disableEntrance ? "" : "transition-all duration-700"}`}
            />
            <div
              style={{ width: `${noProb}%` }}
              className={`h-full bg-tertiary ${disableEntrance ? "" : "transition-all duration-700"}`}
            />
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-outline-variant/30 text-xs">
          <span className="text-on-surface-variant font-label-caps">
            Liquidity: ${(market.totalLiquidity).toLocaleString()}
          </span>
          <button
            type="button"
            className="px-3 py-1 bg-primary text-white rounded font-label-caps text-label-caps hover:brightness-110"
          >
            Trade
          </button>
        </div>
      </div>
    </div>
  );
}

export function FixtureClient({ markets }: { markets: Market[] }) {
  const [isVirtualized, setIsVirtualized] = useState(true);
  const [mountedCount, setMountedCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateStats = () => {
      const cards = containerRef.current?.querySelectorAll('[data-testid="fixture-market-card"]');
      setMountedCount(cards ? cards.length : 0);
    };

    updateStats();
    const interval = setInterval(updateStats, 500);
    return () => clearInterval(interval);
  }, [isVirtualized]);

  return (
    <div>
      {/* Benchmark Controls Toolbar */}
      <div className="sticky top-20 z-20 mb-8 p-4 bg-white border border-outline-variant rounded-xl shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsVirtualized(!isVirtualized)}
            className={`px-4 py-2 rounded-lg font-label-caps text-label-caps font-bold transition-all ${
              isVirtualized
                ? "bg-secondary text-white"
                : "bg-tertiary text-white"
            }`}
          >
            {isVirtualized ? "MODE: VIRTUALIZED (ON)" : "MODE: PLAIN MAP (OFF)"}
          </button>
          <span className="text-sm font-data-mono text-on-surface">
            Total Items: <strong>{markets.length}</strong>
          </span>
          <span className="text-sm font-data-mono text-on-surface">
            Mounted DOM Cards: <strong className={mountedCount > 100 ? "text-error" : "text-secondary"}>{mountedCount}</strong>
          </span>
        </div>

        <div className="text-xs text-on-surface-variant">
          {isVirtualized ? "Virtualizer bounds mounted rows to visible viewport." : "Rendering all 2,000 cards directly into DOM."}
        </div>
      </div>

      <div ref={containerRef}>
        {isVirtualized ? (
          <VirtualList
            items={markets}
            getKey={(m) => m.id}
            estimateSize={() => 300}
            columns={{ base: 1, md: 2, xl: 3 }}
            ariaLabel="Benchmark Market List"
            totalCount={markets.length}
            restorationKey="benchmark_fixture"
            renderItem={(m, index, a11y) => (
              <div {...a11y}>
                <SimpleCard market={m} disableEntrance />
              </div>
            )}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {markets.map((m) => (
              <SimpleCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
