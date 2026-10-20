"use client";

import React, { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X402UnlockPanel } from "@/components/trace/x402-unlock-panel";

/** The x402 unlock panel for `?onChainTraceId=` (reasoning-registry id); nothing without it. */
function TraceUnlock() {
  const onChainTraceId = useSearchParams().get("onChainTraceId");
  if (!onChainTraceId || !/^\d+$/.test(onChainTraceId)) return null;
  return (
    <div className="mb-6">
      <X402UnlockPanel onChainTraceId={onChainTraceId} />
    </div>
  );
}

export default function ReasoningTraceDetailPage() {
  const [logs, setLogs] = useState([
    { id: 1, time: "14:22:01", type: "INFO", message: "Initializing reasoning matrix for contract ID #882..." },
    { id: 2, time: "14:22:02", type: "INFO", message: "Weights recalculated via Bayesian inference module." },
    { id: 3, time: "14:22:03", type: "WARN", message: "Liquidity skew detected on Uniswap v3 YES/NO pair." },
    { id: 4, time: "14:22:04", type: "INFO", message: "Signal verification complete. Confidence at 92.41%." },
    { id: 5, time: "14:22:05", type: "INFO", message: "Awaiting user execution..." },
  ]);

  const logStreamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const extraLogs = [
      "FETCHING REAL-TIME FED DOT PLOT...",
      "RE-INDEXING S&P 500 VOLATILITY INDEX...",
      "CROSS-REFERENCING BLOOMBERG DATA FLOW...",
      "NEURAL WEIGHTS STABILIZED.",
      "OPTIMIZING TRANSACTION GAS ESTIMATES...",
    ];

    const interval = setInterval(() => {
      const time = new Date().toLocaleTimeString([], { hour12: false });
      const message = extraLogs[Math.floor(Math.random() * extraLogs.length)];
      
      setLogs((prevLogs) => {
        const newLogs = [
          ...prevLogs,
          { id: Date.now(), time, type: "INFO", message },
        ];
        if (newLogs.length > 20) return newLogs.slice(1);
        return newLogs;
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logStreamRef.current) {
      logStreamRef.current.scrollTop = logStreamRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto flex-1 flex flex-col">
      <Suspense fallback={null}>
        <TraceUnlock />
      </Suspense>
      {/* Modal Wrapper (Simulated as Full Page Component) */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col md:flex-row h-[calc(100vh-240px)] min-h-[600px]">
        {/* Left Panel: Reasoning Trace */}
        <div className="flex-1 flex flex-col border-r border-outline-variant bg-white overflow-hidden">
          <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-white z-10">
            <div>
              <h1 className="font-headline-md text-headline-md text-on-surface mb-1">
                Reasoning Trace: TRD-7724
              </h1>
              <p className="font-body-md text-on-surface-variant">
                Market: Will Fed cut rates by &gt;25bps in September?
              </p>
            </div>
            <div className="flex gap-2">
              <span className="bg-surface-container-high text-primary px-3 py-1 rounded-full text-label-caps font-label-caps">
                STABLE_DIFFUSION_4.0
              </span>
              <span className="bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-label-caps font-label-caps">
                92% CONFIDENCE
              </span>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <div className="max-w-3xl mx-auto space-y-8 pl-6 relative">
              {/* Chain of Thought Step 1 */}
              <div className="reasoning-node relative">
                <div className="absolute -left-[22px] top-2 w-3 h-3 rounded-full bg-primary border-2 border-white z-10"></div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-label-caps text-label-caps text-primary uppercase">
                      Step 01: Initial Corpus Ingestion
                    </span>
                    <span className="font-data-mono text-data-mono text-on-surface-variant">
                      1.4ms
                    </span>
                  </div>
                  <p className="font-body-md text-on-surface">
                    Parsed 14,200 data points from Bloomberg Terminal, FOMC minutes, and CME FedWatch tool. Identified conflicting signals between inflation trajectory and labor market softening.
                  </p>
                </div>
              </div>

              {/* Chain of Thought Step 2 */}
              <div className="reasoning-node relative">
                <div className="absolute -left-[22px] top-2 w-3 h-3 rounded-full bg-primary border-2 border-white z-10"></div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-label-caps text-label-caps text-primary uppercase">
                      Step 02: Cross-Source Weighting
                    </span>
                    <span className="font-data-mono text-data-mono text-on-surface-variant">
                      0.8ms
                    </span>
                  </div>
                  <div className="space-y-3">
                    <p className="font-body-md text-on-surface">
                      Applying source credibility multipliers. Fed Official statements weighted at 0.85. Yield curve inversion analysis weighted at 0.62.
                    </p>
                    <div className="grid grid-cols-3 gap-2 py-2">
                      <div className="h-1 bg-primary rounded-full"></div>
                      <div className="h-1 bg-primary rounded-full"></div>
                      <div className="h-1 bg-outline-variant rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chain of Thought Step 3 (AI Insight Special) */}
              <div className="reasoning-node relative">
                <div className="absolute -left-[22px] top-2 w-3 h-3 rounded-full bg-primary border-2 border-white z-10"></div>
                <div className="bg-[#f0f9fa] p-4 rounded-lg border border-primary-container/30">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-primary text-sm">
                      psychology
                    </span>
                    <span className="font-label-caps text-label-caps text-primary uppercase">
                      Step 03: Oracle Insight (Sentiment Analysis)
                    </span>
                  </div>
                  <p className="font-body-md text-on-surface italic">
                    &quot;The consensus narrative is currently anchored in a 25bps cut. However, historical volatility analysis during election years suggests a 42% higher probability of aggressive dovishness than the market is currently pricing in.&quot;
                  </p>
                </div>
              </div>

              {/* Chain of Thought Step 4 */}
              <div className="reasoning-node relative">
                <div className="absolute -left-[22px] top-2 w-3 h-3 rounded-full bg-primary border-2 border-white z-10"></div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-label-caps text-label-caps text-primary uppercase">
                      Step 04: Final Probability Synthesis
                    </span>
                    <span className="font-data-mono text-data-mono text-on-surface-variant">
                      2.1ms
                    </span>
                  </div>
                  <p className="font-body-md text-on-surface mb-4">
                    Monte Carlo simulation (n=1,000,000) yields a skew toward the &apos;YES&apos; outcome based on tail-risk events in regional banking sectors.
                  </p>
                  {/* Probability Bar Component */}
                  <div className="mt-4">
                    <div className="flex justify-between font-label-caps text-[10px] mb-1">
                      <span className="text-secondary font-bold">YES (72%)</span>
                      <span className="text-tertiary font-bold">NO (28%)</span>
                    </div>
                    <div className="w-full h-4 flex rounded-full overflow-hidden bg-outline-variant">
                      <div className="bg-secondary w-[72%] transition-all duration-700"></div>
                      <div className="bg-tertiary w-[28%] transition-all duration-700"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Data Analysis & Actions */}
        <div className="w-full md:w-[400px] flex flex-col bg-surface-container-low overflow-y-auto custom-scrollbar">
          {/* Source Weighting Card */}
          <div className="p-6 border-b border-outline-variant">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 uppercase tracking-wider">
              Source Weighting
            </h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded bg-white border border-outline-variant flex items-center justify-center">
                  <span className="material-symbols-outlined text-on-surface-variant">
                    terminal
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-body-md font-semibold">Macro Indicators</span>
                    <span className="font-data-mono text-primary">0.92</span>
                  </div>
                  <div className="w-full h-1 bg-outline-variant rounded-full">
                    <div className="h-1 bg-primary w-[92%]"></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded bg-white border border-outline-variant flex items-center justify-center">
                  <span className="material-symbols-outlined text-on-surface-variant">
                    public
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-body-md font-semibold">Social Sentiment</span>
                    <span className="font-data-mono text-primary">0.44</span>
                  </div>
                  <div className="w-full h-1 bg-outline-variant rounded-full">
                    <div className="h-1 bg-primary w-[44%]"></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded bg-white border border-outline-variant flex items-center justify-center">
                  <span className="material-symbols-outlined text-on-surface-variant">
                    history_edu
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-body-md font-semibold">Historical Bias</span>
                    <span className="font-data-mono text-primary">0.78</span>
                  </div>
                  <div className="w-full h-1 bg-outline-variant rounded-full">
                    <div className="h-1 bg-primary w-[78%]"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Confidence Interval Graph Area */}
          <div className="p-6 flex-1">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 uppercase tracking-wider">
              Confidence Interval
            </h3>
            <div className="aspect-video w-full bg-white border border-outline-variant rounded-lg relative overflow-hidden flex items-end p-2 gap-1">
              {/* Simulated Bar Chart */}
              <div className="flex-1 bg-surface-container h-[20%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[35%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[50%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[75%] rounded-sm"></div>
              <div className="flex-1 bg-primary h-[90%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[60%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[40%] rounded-sm"></div>
              <div className="flex-1 bg-surface-container h-[20%] rounded-sm"></div>
              <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="font-headline-md text-primary opacity-20 select-none">
                  σ 2.4
                </span>
              </div>
            </div>
            <p className="font-label-caps text-[10px] text-on-surface-variant mt-3 uppercase tracking-widest text-center">
              Projected Value Distribution
            </p>
          </div>

          {/* Primary CTA Section */}
          <div className="p-6 bg-white border-t border-outline-variant space-y-3 sticky bottom-0">
            <div className="flex justify-between items-end mb-2">
              <div>
                <span className="font-label-caps text-on-surface-variant">CURRENT PRICE</span>
                <div className="font-headline-md text-headline-md font-bold">0.68¢</div>
              </div>
              <div className="text-right">
                <span className="font-label-caps text-secondary">POTENTIAL ROI</span>
                <div className="font-headline-md text-headline-md font-bold text-secondary">
                  +47.1%
                </div>
              </div>
            </div>
            <Link 
              href="/copy-trade?traceId=TRD-7724&marketId=MKT-9204"
              className="w-full bg-secondary text-primary-foreground font-headline-sm text-headline-sm py-4 rounded-xl flex items-center justify-center gap-3 hover:opacity-90 transition-opacity active:scale-[0.98] transform cursor-pointer"
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                bolt
              </span>
              Copy Trade (YES)
            </Link>
            <p className="font-label-caps text-[10px] text-center text-on-surface-variant">
              Protocol execution fee: 0.05%
            </p>
          </div>
        </div>
      </div>

      {/* System Logs Footer (Terminal Style) */}
      <div className="mt-6 bg-on-background text-[#6ffbbe] p-4 rounded-lg font-data-mono text-data-mono border border-outline overflow-hidden shadow-2xl">
        <div className="flex gap-4 items-center mb-2 border-b border-[#005236] pb-2">
          <span className="flex h-2 w-2 rounded-full bg-[#6ffbbe] animate-pulse"></span>
          <span className="text-white font-bold">ORACLE_LOG_STREAM</span>
          <span className="ml-auto text-on-secondary-fixed-variant opacity-50">
            v2.0.4-LATEST
          </span>
        </div>
        <div 
          ref={logStreamRef}
          className="space-y-1 opacity-80 h-24 overflow-y-auto custom-scrollbar"
        >
          {logs.map((log) => (
            <div key={log.id}>
              [{log.time}] <span className="text-white">{log.type}:</span> {log.message}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
