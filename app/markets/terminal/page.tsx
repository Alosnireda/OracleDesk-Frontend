"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";

const TerminalStream = () => {
  const [logs, setLogs] = useState([
    { time: "09:12:44", text: "ORDER FILL: $4.2K YES (FED_R)", color: "text-secondary" },
    { time: "09:12:31", text: "PRICE_TICK: 0.64 -> 0.65", color: "text-primary" },
    { time: "09:12:15", text: "LIQUIDITY REMOVED: -10.5K", color: "text-destructive" },
    { time: "09:11:58", text: "NEW_POSITION: 500 USDC YES", color: "text-secondary" },
    { time: "09:11:42", text: "SYSTEM: CALIBRATING FEED...", color: "text-on-surface-variant" },
  ]);

  const logEntries = [
    "TRANSACTION_MINED: hash_7x22...",
    "LIQUIDITY_ADDED: +$50.0K POOL_A",
    "ORACLE_UPDATE: AGGREGATING FEED...",
    "SKEW_DETECTED: VOL_IMPACT 0.15%",
    "GAS_PRICE: 12 GWEI",
    "USER_VOTE: 100 YES (US_ELEC)"
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
      const randomEntry = logEntries[Math.floor(Math.random() * logEntries.length)];
      const colors = ["text-secondary", "text-primary", "text-destructive", "text-on-surface-variant"];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      
      setLogs(prev => [
        { time, text: randomEntry, color: randomColor },
        ...prev.slice(0, 4)
      ]);
    }, 3000 + Math.random() * 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-surface-container-high border border-outline-variant rounded-lg p-4 h-full font-data-mono text-[10px] space-y-2 overflow-hidden shadow-inner">
      <div className="flex items-center gap-2 mb-3 border-b border-outline-variant pb-2">
        <div className="w-2 h-2 rounded-full bg-secondary animate-pulse"></div>
        <span className="font-bold tracking-widest text-on-surface-variant">REAL-TIME DATA STREAM</span>
      </div>
      <div className="space-y-2">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-3 animate-in fade-in slide-in-from-left duration-500">
            <span className="text-on-surface-variant opacity-50">[{log.time}]</span>
            <span className={log.color}>{log.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function MarketTerminal() {
  return (
    <main className="pt-24 pb-16 px-gutter max-w-container-max-width mx-auto w-full">
      {/* Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-12">
        <div className="lg:col-span-8 flex flex-col justify-center space-y-6">
          <div className="space-y-2">
            <h1 className="font-display-lg text-display-lg text-on-background max-w-2xl text-4xl md:text-5xl lg:text-6xl">
              The Institutional Terminal for <span className="text-primary-container">Prediction Markets.</span>
            </h1>
          </div>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xl">
            High-stakes decision-making requires clarity. Our new Light Mode design system minimizes cognitive load with a data-first philosophy and tonal layering.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/markets" className="px-6 py-3 bg-primary text-primary-foreground font-headline-sm text-headline-sm rounded hover:shadow-lg transition-all active:scale-[0.98]">
              Launch Terminal
            </Link>
            <button className="px-6 py-3 border border-outline text-primary font-headline-sm text-headline-sm rounded hover:bg-surface-container transition-all active:scale-[0.98]">
              View Docs
            </button>
          </div>        </div>
        <div className="lg:col-span-4 relative">
          <div className="w-full aspect-square rounded-xl overflow-hidden shadow-2xl border border-outline-variant bg-white">
            <img 
              className="w-full h-full object-cover" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDdeD9deNHyx0wMXT02w2_lLmSBjxZpY7tClRhEtvoAJiEwcrTQyz-nCWt-Qr_kCaBccro0LEhL_Fbpon7QfNWkpTe1dQnaAyC-68UeS-N0P5Iq8gaCnLGI8JTATTIblvUZp_Y0yPz2vN2sMKilhAv5ihKpTEVVp_-qiqJ8I9_AjwPIKkqGTcGna2lpGcFg3PHpZ-ZKE9o1VS14P-LKnFZmQHU4cldP5yqhPBtlRx5pp-GrG2elWGhsp8MV7BguvmB3R4qAZ0292w" 
              alt="Institutional Terminal Interface"
            />
          </div>
          <div className="absolute -bottom-4 -left-0 md:-left-8 bg-white/80 backdrop-blur-md p-4 rounded shadow-xl border border-outline-variant flex items-center gap-3">
            <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center text-white">
              <span className="material-symbols-outlined">trending_up</span>
            </div>
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant text-[10px]">MARKET ACCURACY</p>
              <p className="font-headline-sm text-headline-sm font-bold">98.4%</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Grid: Components & Modules */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
        {/* AI Reasoning Module */}
        <div className="md:col-span-2 lg:col-span-2 bg-gradient-to-br from-white to-[#f0f9fa] border border-outline-variant p-6 rounded-lg flex flex-col gap-4 shadow-sm">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">psychology</span>
              <span className="font-headline-sm text-headline-sm text-primary">Oracle Insights</span>
            </div>
            <span className="font-label-caps text-label-caps px-2 py-1 bg-primary text-on-primary rounded text-[10px] font-bold">LIVE</span>
          </div>
          <div className="space-y-3">
            <p className="text-on-surface-variant italic font-body-md leading-relaxed">
              &quot;Market sentiment indicates a 64% probability of short-term volatility due to upcoming macroeconomic reports. Historical correlation suggests a buy opportunity at the $0.42 pivot.&quot;
            </p>
            <div className="h-[2px] bg-outline-variant w-full"></div>
            <div className="flex gap-8">
              <div>
                <span className="font-label-caps text-label-caps block text-on-surface-variant text-[10px]">CONFIDENCE</span>
                <span className="font-data-mono text-data-mono font-bold">HIGH (0.89)</span>
              </div>
              <div>
                <span className="font-label-caps text-label-caps block text-on-surface-variant text-[10px]">SOURCE</span>
                <span className="font-data-mono text-data-mono font-bold">TRANSCRIPTS-X4</span>
              </div>
            </div>
          </div>
        </div>

        {/* Probability Bar Module */}
        <div className="bg-white border border-outline-variant p-6 rounded-lg flex flex-col justify-between shadow-sm">
          <div>
            <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 uppercase tracking-wider text-[11px]">Market Consensus</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex justify-between font-label-caps text-label-caps mb-1 text-[10px] font-bold">
                  <span className="text-secondary">YES</span>
                  <span className="text-tertiary">NO</span>
                </div>
                <div className="h-6 flex rounded overflow-hidden shadow-inner bg-surface-container">
                  <div className="bg-secondary w-[65%] flex items-center justify-center text-[10px] text-white font-bold">65%</div>
                  <div className="bg-tertiary w-[35%] flex items-center justify-center text-[10px] text-white font-bold">35%</div>
                </div>
              </div>
              <div className="space-y-1">
                <p className="font-body-md text-on-surface font-semibold">Fed Interest Rate Pivot Q4</p>
                <p className="font-data-mono text-[12px] text-on-surface-variant tracking-tighter">Vol: $1.2M</p>
              </div>
            </div>
          </div>
          <button className="w-full mt-4 py-2 bg-surface-container-low border border-outline-variant font-label-caps text-label-caps hover:bg-surface-container-high transition-colors rounded text-[11px] font-bold">
            PLACE BET
          </button>
        </div>

        {/* Terminal Stream Module */}
        <div className="h-full">
          <TerminalStream />
        </div>
      </section>

      {/* High Density Data Table */}
      <section className="bg-white border border-outline-variant rounded-lg overflow-hidden mb-16 shadow-sm">
        <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h2 className="font-headline-sm text-headline-sm">Trending Prediction Markets</h2>
          <div className="flex gap-4">
            <span className="material-symbols-outlined cursor-pointer hover:text-primary transition-colors">filter_list</span>
            <span className="material-symbols-outlined cursor-pointer hover:text-primary transition-colors">search</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant uppercase text-[10px] tracking-widest font-bold">
                <th className="px-6 py-4 text-on-surface-variant font-label-caps text-label-caps">Market Name</th>
                <th className="px-6 py-4 text-on-surface-variant font-label-caps text-label-caps text-right">Probability</th>
                <th className="px-6 py-4 text-on-surface-variant font-label-caps text-label-caps text-right">Volume (24h)</th>
                <th className="px-6 py-4 text-on-surface-variant font-label-caps text-label-caps text-center">Trend</th>
                <th className="px-6 py-4 text-on-surface-variant font-label-caps text-label-caps">Action</th>
              </tr>
            </thead>
            <tbody className="font-body-md divide-y divide-outline-variant">
              {[
                { name: "Climate Accord Ratification by Q2", icon: "public", prob: "72.4%", vol: "$842,102", color: "secondary", trend: 100 },
                { name: "Mars Mission Launch Window Nov", icon: "rocket_launch", prob: "14.8%", vol: "$2,410,550", color: "tertiary", trend: 40 },
                { name: "BTC Resistance Break $75k", icon: "currency_bitcoin", prob: "50.0%", vol: "$15,200,000", color: "primary", trend: 70 },
              ].map((m, i) => (
                <tr key={i} className="hover:bg-surface-container/50 transition-colors group">
                  <td className="px-6 py-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-surface-container-high flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <span className="material-symbols-outlined text-primary text-sm">{m.icon}</span>
                    </div>
                    <span className="font-semibold text-on-surface">{m.name}</span>
                  </td>
                  <td className={`px-6 py-4 text-right font-data-mono font-bold text-${m.color}`}>{m.prob}</td>
                  <td className="px-6 py-4 text-right font-data-mono text-on-surface-variant">{m.vol}</td>
                  <td className="px-6 py-4">
                    <div className="flex justify-center">
                      <div className="h-3 w-24 bg-surface-container-high rounded-full overflow-hidden flex items-center px-0.5 border border-outline-variant/30">
                        <div className={`h-[2px] bg-${m.color}`} style={{ width: `${m.trend}%` }}></div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button className="text-primary font-bold hover:underline font-label-caps text-label-caps text-[11px] tracking-wider uppercase">Trade</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Design Philosophy Section */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white border border-outline-variant p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4 text-[10px] font-bold tracking-widest">BUTTONS</p>
            <div className="space-y-3">
              <button className="w-full py-2 bg-primary text-white rounded font-label-caps text-label-caps text-[11px] font-bold active:scale-[0.98] transition-all">Primary</button>
              <button className="w-full py-2 bg-secondary text-white rounded font-label-caps text-label-caps text-[11px] font-bold active:scale-[0.98] transition-all">Success</button>
              <button className="w-full py-2 border border-primary text-primary rounded font-label-caps text-label-caps text-[11px] font-bold active:scale-[0.98] transition-all">Ghost</button>
            </div>
          </div>
          <div className="bg-surface-container-high border border-outline-variant p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4 text-[10px] font-bold tracking-widest">INPUTS</p>
            <div className="space-y-4">
              <div className="space-y-1">
                <input 
                  className="w-full bg-white border border-outline-variant rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all" 
                  placeholder="Amount..." 
                  type="text"
                />
                <div className="flex gap-1">
                  <span className="w-1/4 h-1 bg-primary rounded-full"></span>
                  <span className="w-1/4 h-1 bg-primary rounded-full"></span>
                  <span className="w-1/4 h-1 bg-outline-variant rounded-full"></span>
                  <span className="w-1/4 h-1 bg-outline-variant rounded-full"></span>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-1 sm:col-span-2 bg-white border border-outline-variant p-6 rounded-lg shadow-sm relative overflow-hidden group">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4 text-[10px] font-bold tracking-widest uppercase">Visual Depth</p>
            <div className="w-full h-24 bg-surface-container-lowest border border-dashed border-outline-variant rounded flex items-center justify-center transition-colors group-hover:bg-primary/5">
              <span className="font-data-mono text-[10px] opacity-40 uppercase tracking-widest">Tonal Layering Demo</span>
            </div>
            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
          </div>
        </div>
        <div className="space-y-6">
          <h2 className="font-display-lg text-display-lg text-on-background text-3xl md:text-4xl">Modern Financial Clarity.</h2>
          <p className="text-body-lg text-on-surface-variant leading-relaxed">
            We&apos;ve stripped away the noise of legacy dark-mode terminals to build a system that prioritizes long-form analysis and eye comfort. Every shadow, border, and tint is engineered to guide the eye toward decision-critical data points.
          </p>
          <ul className="space-y-6 pt-4">
            <li className="flex items-start gap-3">
              <div className="bg-secondary/10 p-1 rounded">
                <span className="material-symbols-outlined text-secondary text-[20px]">check_circle</span>
              </div>
              <span><strong className="font-headline-sm text-headline-sm block mb-1">4px Baseline Grid</strong> Tight spacing for high information density without visual clutter.</span>
            </li>
            <li className="flex items-start gap-3">
              <div className="bg-secondary/10 p-1 rounded">
                <span className="material-symbols-outlined text-secondary text-[20px]">check_circle</span>
              </div>
              <span><strong className="font-headline-sm text-headline-sm block mb-1">Geist Variable Typeface</strong> Engineered for maximum legibility in numerical datasets.</span>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
