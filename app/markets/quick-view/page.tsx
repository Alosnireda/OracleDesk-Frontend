"use client";
import { Icon } from "@/components/ui/icon";

import React, { Suspense, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useMarket, useMarketQuestionIntegrity } from "@/lib/hooks/useMarkets";
import { QuestionVerificationBadge } from "@/components/question-verification-badge";
import { ResolverStatusPanel } from "@/components/resolver-status-panel";
import { getMarketByOnChainId, getResolution } from "@/lib/api/markets";
import { ApiError } from "@/lib/api/client";
import { useOnChainMarket, usePosition } from "@/lib/hooks/useStellar";
import { useWalletAddress } from "@/lib/contexts/WalletContext";
import { ledgerClock, useLedgerNow as useLedgerClock } from "@/lib/stellar/ledger-clock";
import { formatUsdc } from "@/lib/stellar/units";
import { MIN_TX_TIMEOUT_S, SAFETY_MARGIN_S } from "@/lib/stellar/deadline";
import { TradeTape } from "@/components/market/trade-tape";
import { BuyTicket } from "@/components/market/buy-ticket";
import { DevProfiler } from "@/lib/dev/profiler";
import { PushVerifiedStatus } from "@/components/push-verified-status";
import { SourceTag } from "@/components/ui/source-tag";

export default function MarketQuickViewPage() {
  return (
    <Suspense
      fallback={
        <main className="relative min-h-[calc(100vh-64px)] overflow-hidden bg-surface flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </main>
      }
    >
      <DevProfiler id="quick-view">
        <MarketQuickViewContent />
      </DevProfiler>
    </Suspense>
  );
}

function MarketQuickViewContent() {
  const searchParams = useSearchParams();
  const marketId = searchParams.get("marketId");
  const onChainIdParam = searchParams.get("onChainId");
  const initialSide = searchParams.get("side") === "NO" ? "No" : "Yes";
  const fromPush = searchParams.get("from") === "push";

  const backendById = useMarket(marketId ?? undefined);
  // Opened from an on-chain id: the backend may or may not know this market.
  const backendByChainId = useQuery({
    queryKey: ["market-by-chain-id", onChainIdParam],
    queryFn: () => getMarketByOnChainId(onChainIdParam as string),
    enabled: Boolean(onChainIdParam) && !marketId,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const market = backendById.data ?? backendByChainId.data ?? null;
  const onChainMarketId = market?.onChainMarketId ?? onChainIdParam ?? null;
  const chain = useOnChainMarket(onChainMarketId);
  const resolutionQuery = useQuery({
    queryKey: ["market-resolution", marketId || onChainMarketId],
    queryFn: () => getResolution((marketId ?? market?.id) as string),
    enabled: Boolean(marketId || market?.id),
    retry: false,
  });

  const { address } = useWalletAddress();
  const position = usePosition(onChainMarketId, address);
  const ledger = useLedgerClock();
  const [showModal] = useState(true);
  const [side, setSide] = useState<"Yes" | "No">(initialSide);
  const view = chain.data;

  // Illustrative only: there is no price history source yet.
  const sparklinePath = "M0 25 L10 22 L20 28 L30 18 L40 20 L50 15 L60 17 L70 10 L80 12 L90 5 L100 8";

  const fromChain = Boolean(view);
  const backendProb = market ? Math.round((market.currentYesProb ?? market.initialYesProb) * 100) : 50;
  const yesProb = view ? Math.round(view.yesBps / 100) : backendProb;
  const noProb = 100 - yesProb;
  const chainStatus = view?.market.status;
  const nowLedgerTime = ledgerClock.estimateNow().time;
  const secondsToClose = view ? Number(view.market.close_time) - nowLedgerTime : null;
  const countdown = secondsToClose !== null && secondsToClose >= 0 && secondsToClose < 3600 ? `Closes in ${Math.floor(secondsToClose / 60)}m ${secondsToClose % 60}s` : null;
  const isOpen = chainStatus?.tag === "Open" && Number(view?.market.close_time ?? 0) > nowLedgerTime;

  const isLoading = backendById.isLoading || (backendByChainId.isLoading && !marketId) || (chain.isLoading && !market);
  const notFound = !market && !view;

  if (isLoading) {
    return (
      <main className="relative min-h-[calc(100vh-64px)] overflow-hidden bg-surface flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="relative min-h-[calc(100vh-64px)] overflow-hidden bg-surface flex flex-col items-center justify-center p-6 text-center">
        <Icon name="error" className="text-error text-6xl mb-4" />
        <h2 className="text-headline-md mb-2">Market not found</h2>
        <p className="text-on-surface-variant mb-6">The market you are looking for does not exist or could not be loaded.</p>
        <Link href="/markets" className="bg-primary text-white px-6 py-2 rounded-lg font-label-caps uppercase">
          Back to markets
        </Link>
      </main>
    );
  }

  const title = market?.question ?? `Market #${onChainMarketId} · ${view?.market.meta_uri ?? ""}`;
  const questionIntegrity = useMarketQuestionIntegrity({
    marketId,
    onChainMarketId,
    displayedQuestion: title,
    metaUri: view?.market.meta_uri ?? market?.metaUri,
    questionHash: view?.market.question_hash ?? market?.questionHash,
  });
  const statusLabel = chainStatus
    ? chainStatus.tag === "Resolved" ? `RESOLVED ${chainStatus.values[0].tag.toUpperCase()}` : chainStatus.tag === "Void" ? "VOID" : isOpen ? "OPEN" : "CLOSED"
    : market?.status ?? "";
  const categoryLabel = market?.category ?? view?.market.category.tag ?? "";
  const liquidityText = view
    ? `$${formatUsdc(view.market.sets_minted, { maxDecimals: 2, grouping: true })}`
    : market ? `$${market.totalLiquidity.toLocaleString()}` : "—";
  const latestTrace = market?.reasoningTraces?.[0];

  return (
    <main className="relative min-h-[calc(100vh-64px)] overflow-hidden bg-surface">
      {/* Background decoration for terminal feel */}
      <div className="fixed bottom-4 left-4 font-data-mono text-[10px] text-outline opacity-50 z-0 pointer-events-none">
        STELLAR TESTNET :: MARKET {onChainMarketId !== null ? `#${onChainMarketId}` : "NOT ON-CHAIN"}
      </div>

      {/* Main Content Background (Simulated/Blurred) */}
      <div className={`max-w-container-max-width mx-auto p-gutter grid grid-cols-1 md:grid-cols-3 gap-6 transition-all duration-700 ${showModal ? "opacity-40 select-none pointer-events-none blur-sm" : "opacity-100"}`}>
        <div className="md:col-span-2 space-y-6">
          <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded-xl">
            <div className="h-4 w-24 bg-surface-container rounded mb-4"></div>
            <div className="h-8 w-full bg-surface-container rounded mb-6"></div>
            <div className="h-64 w-full bg-surface-container rounded"></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 bg-surface-container-lowest border border-outline-variant rounded-xl"></div>
            <div className="h-32 bg-surface-container-lowest border border-outline-variant rounded-xl"></div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded-xl h-[500px]"></div>
        </div>
      </div>

      {/* Market Details Quick View Modal Overlay */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-on-background/20 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-[560px] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-outline-variant overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-bright">
                <div className="flex items-center gap-2">
                  <span className={`${isOpen ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest text-on-surface-variant'} font-label-caps text-[10px] px-2 py-0.5 rounded-full font-bold`}>
                    {statusLabel}
                    {chainStatus && <SourceTag source="chain" ledger={view?.ledger} readAt={chain.dataUpdatedAt} />}
                  </span>
                  {countdown && <span className="text-[10px] font-data-mono text-on-surface-variant">{countdown}</span>}
                  <span className="font-label-caps text-label-caps text-outline uppercase font-bold tracking-wider">{categoryLabel}</span>
                </div>
                <Link 
                  href="/markets"
                  aria-label="Close"
                  className="text-outline hover:text-on-surface transition-colors min-h-11 min-w-11 flex items-center justify-center"
                >
                  <Icon name="close" />
                </Link>
              </div>

              {/* Content Area */}
              <div className="p-6 space-y-6">
                {/* Market Question */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-headline-sm text-headline-sm text-on-surface leading-tight">
                      {title}
                    </h2>
                    {questionIntegrity.data && (
                      <QuestionVerificationBadge
                        status={questionIntegrity.data.status}
                        result={questionIntegrity.data}
                      />
                    )}
                  </div>
                  {questionIntegrity.data?.status === "mismatch" && (
                    <QuestionVerificationBadge status="mismatch" result={questionIntegrity.data} />
                  )}
                </div>

                {fromPush && view && <PushVerifiedStatus marketId={view.id} market={view.market} position={position.data ?? null} />}
                {/* 24h Performance & Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                  <div className="space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display-lg text-display-lg text-on-surface text-4xl">{yesProb}%</span>
                      <SourceTag source={fromChain ? "chain" : "backend"} ledger={view?.ledger} readAt={fromChain ? chain.dataUpdatedAt : undefined} />
                    </div>
                    <p className="font-label-caps text-label-caps text-outline uppercase font-bold tracking-wider">YES price</p>
                    {view?.ledger != null && (
                      <p className="text-[11px] text-outline font-data-mono">as of ledger {view.ledger.toLocaleString()}</p>
                    )}
                  </div>
                  {/* Sparkline Simulation */}
                  <div className="h-16 relative w-full" aria-hidden="true" title="Illustration; price history isn't indexed yet">
                    <svg className="w-full h-full text-secondary stroke-2 fill-none" viewBox="0 0 100 30" preserveAspectRatio="none">
                      <path 
                        d={sparklinePath} 
                        stroke="currentColor" 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth="2"
                      />
                      <defs>
                        <linearGradient id="sparkline-gradient" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
                          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path 
                        d={`${sparklinePath} L100 30 L0 30 Z`} 
                        fill="url(#sparkline-gradient)" 
                        stroke="none"
                      />
                    </svg>
                  </div>
                </div>

                {/* Trading Module */}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" aria-pressed={side === 'Yes'} onClick={() => setSide('Yes')} className={`group relative bg-surface-container-lowest border ${side === 'Yes' ? 'border-secondary border-2' : 'border-secondary/30'} hover:border-secondary hover:bg-secondary-container/10 p-4 rounded-lg transition-all duration-200`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-label-caps text-label-caps text-secondary font-bold">YES</span>
                      <span className="font-data-mono text-data-mono text-on-surface">${(yesProb/100).toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-surface-container h-1 rounded-full overflow-hidden">
                      <div className="bg-secondary h-full transition-all duration-500" style={{ width: `${yesProb}%` }}></div>
                    </div>
                  </button>
                  <button type="button" aria-pressed={side === 'No'} onClick={() => setSide('No')} className={`group relative bg-surface-container-lowest border ${side === 'No' ? 'border-tertiary border-2' : 'border-tertiary/30'} hover:border-tertiary hover:bg-tertiary-container/10 p-4 rounded-lg transition-all duration-200`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-label-caps text-label-caps text-tertiary font-bold">NO</span>
                      <span className="font-data-mono text-data-mono text-on-surface">${(noProb/100).toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-surface-container h-1 rounded-full overflow-hidden">
                      <div className="bg-tertiary h-full transition-all duration-500" style={{ width: `${noProb}%` }}></div>
                    </div>
                  </button>
                </div>

                {/* Buy */}
                {onChainMarketId !== null && (
                  <BuyTicket onChainMarketId={onChainMarketId} side={side} />
                )}

                {onChainMarketId !== null && <TradeTape onChainMarketId={onChainMarketId} limit={20} compact />}

                {/* Resolution Status & Commitment Panel */}
                <ResolverStatusPanel
                  resolverState={resolutionQuery.data?.resolverState ?? "Unconfigured"}
                  marketStatus={statusLabel}
                  resolutionHash={view?.market.resolution_hash ?? market?.resolutionHash ?? resolutionQuery.data?.resolutionHash}
                  resolutionSpec={market?.resolutionSpec ?? resolutionQuery.data?.resolutionSpec}
                />

                {/* AI Reasoning Snippet */}
                <div className="bg-[#f0f9fa] border border-primary-container/20 p-4 rounded-lg space-y-2 relative overflow-hidden">
                  <div className="flex items-center gap-2 text-primary z-10 relative">
                    <Icon name="psychology" className="text-[18px]" />
                    <span className="font-label-caps text-label-caps uppercase font-bold tracking-wider">Oracle AI Insights</span>
                  </div>
                  <p className="font-body-md text-body-md text-on-surface-variant italic z-10 relative leading-relaxed">
                    {latestTrace
                      ? `The agent estimates a ${Math.round(latestTrace.probabilityEstimate * 100)}% probability. Edge: ${Math.round(latestTrace.edge * 100)}%.`
                      : "No reasoning trace has been published for this market yet."
                    }
                  </p>
                  <div className="flex items-center justify-between z-10 relative pt-1">
                    <span className="text-[11px] text-on-surface-variant">
                      {latestTrace ? "Every agent decision is backed by on-chain reasoning." : "Pending first agent reasoning publish."}
                    </span>
                    {onChainMarketId !== null && (
                      <Link
                        href={`/reasoning/verify?marketId=${market?.id ?? onChainMarketId}&onChainMarketId=${onChainMarketId}`}
                        className="inline-flex items-center gap-1 text-[11px] font-label-caps font-bold text-primary hover:underline"
                      >
                        <span className="material-symbols-outlined text-xs">fact_check</span>
                        Audit All Traces
                      </Link>
                    )}
                  </div>
                  <div className="absolute right-0 bottom-0 opacity-5 translate-x-4 translate-y-4">
                    <Icon name="neurology" className="text-6xl" />
                  </div>
                </div>
              </div>

              {/* Footer Action */}
              <div className="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex flex-col items-center sm:items-start">
                  <span className="font-data-mono text-data-mono text-on-surface font-bold">{liquidityText}<SourceTag source={fromChain ? "chain" : "backend"} ledger={view?.ledger} readAt={fromChain ? chain.dataUpdatedAt : undefined} /></span>
                  <span className="text-[10px] text-outline font-label-caps uppercase font-bold tracking-wider">Collateral locked</span>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  {market && (
                    <Link href={`/markets/terminal?marketId=${market.id}`} className="flex-1 sm:flex-none font-label-caps text-label-caps text-primary hover:underline px-4 transition-all font-bold text-center">View Full Terminal</Link>
                  )}
                  {market && latestTrace && (
                    <Link href={`/copy-trade?marketId=${market.id}&traceId=${latestTrace.id}`} className="flex-1 sm:flex-none bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-label-caps text-label-caps hover:bg-primary-container active:scale-95 transition-all shadow-sm font-bold uppercase text-center">Copy Agent</Link>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
