"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useTraces } from "@/lib/hooks/useTraces";

const extraLogs = [
  "> [08:27:01] Processing L3 cross-chain events...",
  "> [08:27:05] Liquidity pools re-balanced (WETH/USDC)",
  "> [08:27:12] Inference Node #44 responding within 12ms",
  "> [08:27:20] Signal strength: 9.4/10",
  "> [08:27:31] Market ID_9921 updated with news delta",
  "> [08:27:44] REASONING TRACE COMMIT: SUCCESS",
];

const TerminalLogSidebar = () => {
  const [logs, setLogs] = useState([
    { text: "> [08:24:12] Fetching market data: ID_882", color: "" },
    { text: "> [08:24:13] Running inference model V4.2", color: "" },
    { text: "> [08:24:15] Source verified via Oracles", color: "" },
    { text: "> [08:24:16] NEW REASONING COMMITTED", color: "text-secondary" },
    { text: "> [08:25:01] Re-weighting sentiment nodes", color: "" },
    { text: "> [08:25:05] Liquidity check: $4.2M depth", color: "" },
    { text: "> [08:25:09] Polling news aggregators...", color: "" },
    { text: "> [08:25:12] Processing macro volatility", color: "" },
    { text: "> [08:25:14] Model divergence: < 0.2%", color: "" },
    { text: "> [08:26:01] Node heartbeat: ACTIVE", color: "" },
    { text: "> [08:26:10] Syncing global state", color: "" },
    { text: "> [08:26:12] TRACE_ID: 0x9f...a23 GENERATED", color: "text-secondary" },
  ]);

  const terminalRef = useRef<HTMLDivElement>(null);
  const logIndex = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextLog = extraLogs[logIndex.current % extraLogs.length];
      setLogs((prev) => [...prev.slice(-49), { text: nextLog, color: nextLog.includes("SUCCESS") || nextLog.includes("COMMIT") ? "text-secondary" : "" }]);
      logIndex.current++;
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="lg:col-span-3 hidden lg:block">
      <div className="bg-surface-container-high border border-outline-variant rounded-lg overflow-hidden h-[calc(100vh-14rem)] sticky top-28 flex flex-col shadow-inner">
        <div className="px-4 py-3 border-b border-outline-variant bg-surface-container flex items-center justify-between">
          <span className="font-label-caps text-[10px] text-on-surface-variant font-bold tracking-widest uppercase">Inference Logs</span>
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-outline-variant"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-outline-variant"></div>
          </div>
        </div>
        <div 
          ref={terminalRef}
          className="flex-1 p-4 font-data-mono text-[10px] leading-relaxed overflow-y-auto terminal-scroll space-y-1"
        >
          {logs.map((log, i) => (
            <div key={i} className={log.color}>{log.text}</div>
          ))}
          <div className="animate-pulse">_</div>
        </div>
      </div>
    </div>
  );
};

interface ReasoningCardProps {
  id: string;
  marketId: string;
  verified: boolean;
  title: string;
  description: string;
  confidence: number;
  edge: number;
  synthesis: string;
  sourceWeighting: { name: string; value: number }[];
  yesProb: number;
  noProb: number;
}

const ReasoningCard = ({ 
  id, 
  marketId,
  verified, 
  title, 
  description, 
  confidence, 
  edge, 
  synthesis, 
  sourceWeighting, 
  yesProb, 
  noProb,
}: ReasoningCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className={`reasoning-card rounded-lg overflow-hidden flex flex-col ${!verified ? 'opacity-90 grayscale-[0.2]' : ''}`}>
      <div className="p-6 border-b border-outline-variant flex flex-col md:flex-row justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="bg-surface-container-high px-2 py-0.5 rounded font-label-caps text-[10px] text-primary">ID: {id.substring(0, 8).toUpperCase()}</span>
            <div className={`flex items-center gap-1 ${verified ? 'text-secondary' : 'text-on-surface-variant'} font-bold`}>
              <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: verified ? "'FILL' 1" : "" }}>
                {verified ? 'verified' : 'pending'}
              </span>
              <span className="font-label-caps text-label-caps">{verified ? 'Verified' : 'Pending'}</span>
            </div>
          </div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface mb-1 uppercase tracking-tight">{title}</h2>
          <p className="font-body-md text-on-surface-variant italic">&quot;{description}&quot;</p>
        </div>
        <div className="flex items-center gap-6 md:border-l md:pl-6 border-outline-variant">
          <div className="text-center">
            <div className="font-label-caps text-[10px] text-outline uppercase mb-1">Confidence</div>
            <div className="font-data-mono text-headline-sm text-primary">{confidence}%</div>
          </div>
          <div className="text-center">
            <div className="font-label-caps text-[10px] text-outline uppercase mb-1">Edge</div>
            <div className="font-data-mono text-headline-sm text-secondary">+{Math.round(edge * 100)}%</div>
          </div>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="ai-tint p-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined">analytics</span> Reasoning Synthesis
            </h3>
            <div className="space-y-3 font-body-md text-on-surface leading-relaxed">
              <p>{synthesis}</p>
            </div>
          </div>
          <div>
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined">balance</span> Source Weighting
            </h3>
            <div className="space-y-2">
              {sourceWeighting.map((source, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs font-label-caps mt-3 first:mt-0">
                    <span>{source.name}</span>
                    <span className="font-data-mono">{source.value}%</span>
                  </div>
                  <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${source.value}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="mt-8">
          <div className="flex justify-between mb-2">
            <span className="font-label-caps text-label-caps text-secondary uppercase">Yes: {yesProb}%</span>
            <span className="font-label-caps text-label-caps text-tertiary uppercase">No: {noProb}%</span>
          </div>
          <div className="h-4 w-full flex rounded-full overflow-hidden bg-surface-container">
            <div className="probability-yes h-full" style={{ width: `${yesProb}%` }}></div>
            <div className="probability-no h-full" style={{ width: `${noProb}%` }}></div>
          </div>
        </div>
      </motion.div>

      <div className="p-6 bg-surface border-t border-outline-variant flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2">
          <Link href={`/reasoning/verify?traceId=${id}`} className="px-4 py-2 bg-surface-container-low border border-outline text-on-surface rounded font-label-caps text-label-caps hover:bg-surface-variant transition-all">Verify</Link>
          <Link
            href={`/copy-trade?traceId=${id}&marketId=${marketId}`}
            className="px-4 py-2 bg-primary-container text-white rounded font-label-caps text-label-caps hover:opacity-90 active:opacity-80 transition-all"
          >
            Copy Trade
          </Link>
          <Link
            href={`/agent/${encodeURIComponent(id)}`}
            className="px-4 py-2 bg-surface-container-low border border-outline text-on-surface rounded font-label-caps text-label-caps hover:bg-surface-variant transition-all"
          >
            View Agent Profile
          </Link>
        </div>
        <Link href={`/premium/trace?traceId=${id}`} className="flex items-center gap-2 text-primary font-bold font-label-caps text-label-caps border border-primary px-4 py-2 rounded hover:bg-primary-fixed-dim/10">
          <span className="material-symbols-outlined">lock_open</span>
          Unlock Premium Trace
        </Link>
      </div>
    </div>
  );
};

export default function ReasoningFeedPage() {
  const { data, isLoading, error } = useTraces();
  const traces = data?.traces ?? [];

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto">
      {/* Header Section */}
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display-lg text-display-lg text-on-surface">AI Reasoning Feed</h1>
          <p className="text-on-surface-variant mt-2 max-w-2xl font-body-lg text-body-lg">
            Real-time inference logs and predictive analysis for global prediction markets. 
            Verifiable trust through on-chain reasoning traces.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-surface-container rounded border border-outline-variant">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
            <span className="font-data-mono text-data-mono text-on-surface">LIVE FEED: 124 TPS</span>
          </div>
        </div>
      </div>

      {/* Main Feed Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <TerminalLogSidebar />

        {/* Main Feed Content */}
        <div className="lg:col-span-9 space-y-6">
          {isLoading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-64 bg-surface-container-low animate-pulse rounded-lg border border-outline-variant"></div>
            ))
          ) : error ? (
            <div className="p-12 text-center bg-surface-container-low rounded-xl border border-error/20">
              <span className="material-symbols-outlined text-error text-4xl mb-4">error</span>
              <p>Failed to load reasoning traces.</p>
            </div>
          ) : traces.length > 0 ? (
            traces.map((t) => {
              const yesProb = Math.round(t.probabilityEstimate * 100);
              return (
                <ReasoningCard 
                  key={t.id}
                  id={t.id}
                  marketId={t.marketId}
                  verified={t.verified}
                  title={t.market?.question ?? "Market Analysis"}
                  description={t.decisionType}
                  confidence={Math.round(t.probabilityEstimate * 100)}
                  edge={t.edge}
                  synthesis={t.previewSources?.[0]?.signal ?? "Inference models suggest a significant edge based on current market data and multi-model consensus."}
                  yesProb={yesProb}
                  noProb={100 - yesProb}
                  sourceWeighting={t.previewSources?.map(s => ({ name: s.source, value: Math.round(s.weight * 100) })) ?? [
                    { name: "Market Liquidity", value: 40 },
                    { name: "Social Sentiment", value: 35 },
                    { name: "Historical Correlation", value: 25 }
                  ]}
                />
              );
            })
          ) : (
            <div className="p-12 text-center bg-surface-container-low rounded-xl">
              <p>No reasoning traces available yet.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
