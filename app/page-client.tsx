"use client";
import { Icon, type IconName } from "@/components/ui/icon";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useWallet } from "@/lib/contexts/WalletContext";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { useFeaturedMarket } from "@/lib/hooks/useFeaturedMarket";
import { formatLiquidity, yesProb } from "@/lib/markets/featured";
import { tickerItems } from "@/lib/markets/ticker";
import { formatUsdc } from "@/lib/stellar/units";
import { useBurstFeed } from "@/lib/realtime/useBurst";
import { type RealtimeEvent, eventKey } from "@/lib/realtime/types";
import { formatFeedTime } from "@/lib/realtime/format";
import { RealtimeProfiler } from "@/components/realtime-profiler";
import { DemoBadge } from "@/components/ui/demo-badge";

const AgentActivityRow = React.memo(function AgentActivityRow({ event }: { event: RealtimeEvent }) {
  const data = event.payload;
  const time = formatFeedTime(data.closedAt ?? event.receivedAt);
  const item = event.type === "TRADE_EXECUTED" ? {
    key: eventKey(event), time, receipt: !data.closedAt, agent: "Trader", action: event.payload.isBuy ? "BUY" : "SELL",
    details: `${event.payload.direction} ${formatUsdc(BigInt(event.payload.collateralRaw), { maxDecimals: 2, grouping: true })} USDC on #${data.onChainMarketId} · YES ${(event.payload.priceYesBps / 100).toFixed(1)}%`,
    chain: "Stellar", color: "text-secondary",
  } : {
    key: eventKey(event), time, receipt: !data.closedAt, agent: "Reasoner", action: "PUBLISH_TRACE",
    details: `Trace #${event.payload.onChainTraceId} (${event.payload.action})`, chain: "Stellar", color: "text-primary-fixed",
  };

  return <div className="flex gap-4 border-l border-white/10 pl-4 py-1 hover:bg-white/5 transition-colors group">
          <span className="text-white/20 whitespace-nowrap">[{item.time}]{item.receipt && " received"}</span>
          <span className="text-primary font-bold whitespace-nowrap">{item.agent}</span>
          <span className={`font-black ${item.color} whitespace-nowrap`}>{item.action}</span>
          <span className="text-white/70 truncate flex-grow">{item.details}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border border-primary/50 text-primary font-bold`}>{item.chain}</span>
        </div>;
});


const AgentActivityFeed = () => {
  const { rows, burst } = useBurstFeed({ capacity: 6 });

  return (
    <div className="bg-on-background rounded-xl overflow-hidden shadow-2xl border border-outline border-opacity-30">
      <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
        <div className="flex items-center gap-2">
          <Icon name="monitoring" className="text-secondary animate-pulse motion-reduce:animate-none" />
          <h3 className="font-headline-sm text-headline-sm text-white uppercase tracking-widest text-xs">Live Agent Activity</h3>
        </div>
        <span className="text-white/30 text-[9px] font-data-mono uppercase">Stellar Testnet</span>
      </div>
      <div className="p-6 h-[320px] overflow-y-auto font-data-mono text-[11px] space-y-3 custom-scrollbar">
        {rows.length === 0 && (
          <p className="text-white/40">Waiting for agent activity on-chain…</p>
        )}
        {burst && <p className="text-white/70">{burst.count} events in the last second{burst.overflow ? ` · ${burst.overflow} more events while this tab was hidden` : ""}.</p>}
        {rows.map(event => <AgentActivityRow key={eventKey(event)} event={event} />)}
      </div>
    </div>
  );
};

const ProtocolActivity = () => {
  const activity = [
    { type: "DAILY_PASS", detail: "USDC 0.50 -> 24h trace access", status: "CONFIRMED", chain: "Stellar", color: "text-secondary" },
    { type: "TRACE_UNLOCK", detail: "x402 per-trace payment", status: "PENDING", chain: "Stellar", color: "text-primary" },
    { type: "MARKET_CREATE", detail: "Treasury seeds a new market", status: "SUCCESS", chain: "Stellar", color: "text-secondary" },
  ];

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-6 shadow-sm flex flex-col h-full">
      <div className="flex items-center gap-2 mb-6 text-on-surface">
        <Icon name="hub" className="text-primary" />
        <h3 className="font-headline-sm text-headline-sm uppercase tracking-tight text-sm">Protocol Activity</h3>
        <DemoBadge className="ml-auto" />
      </div>
      <div className="space-y-4 flex-grow">
        {activity.map((item, i) => (
          <div key={i} className="flex flex-col gap-1 border-b border-outline-variant/30 pb-3 last:border-0">
            <div className="flex justify-between items-center">
              <span className={`font-label-caps text-[10px] font-black ${item.color}`}>{item.type}</span>
              <span className="text-[9px] font-data-mono text-on-surface-variant">{item.chain}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-body-md text-on-surface">{item.detail}</span>
              <span className="text-[9px] bg-surface-container-highest px-1.5 py-0.5 rounded font-bold text-secondary-fixed">{item.status}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="pt-4 mt-auto border-t border-outline-variant flex items-center justify-between">
        <span className="text-[10px] text-on-surface-variant font-data-mono uppercase">Network fees</span>
        <span className="text-[10px] text-secondary font-bold">PAID IN XLM BY YOUR WALLET</span>
      </div>
    </div>
  );
};

const Ticker = () => {
  const { data: marketsData } = useMarkets({ limit: 6 });
  const tickerItemsList = tickerItems(marketsData?.markets ?? []);

  return (
    <div className="bg-on-background text-primary-fixed-dim py-2 border-b border-outline overflow-hidden">
      <div className="ticker-wrap w-full">
        <div className="ticker-content realtime-ticker animate-ticker motion-reduce:animate-none font-data-mono text-data-mono uppercase flex gap-8 whitespace-nowrap">
          {[...tickerItemsList, ...tickerItemsList, ...tickerItemsList].map((item, i) => (
            <span key={`${i}:${item}`} className={i >= tickerItemsList.length ? "motion-reduce:hidden" : ""}>{item} •</span>
          ))}
        </div>
      </div>
    </div>
  );
};

const Hero = () => {
  const { market, isLoading } = useFeaturedMarket();
  const prob = market ? Math.round(yesProb(market) * 1000) / 10 : null;

  return (
    <section className="relative overflow-hidden bg-surface py-20 border-b border-outline-variant">
      <div className="max-w-container-max-width mx-auto px-gutter grid lg:grid-cols-2 gap-12 items-center">
        <div className="z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full mb-6"
          >
            <Icon name="bolt" filled className="text-[16px]" />
            <span className="font-label-caps text-label-caps">Institutional Grade Intelligence</span>
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-display-lg text-display-lg text-on-background mb-6 max-w-xl"
          >
            The World&apos;s Most Accurate AI-Driven Prediction Terminal.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="font-body-lg text-body-lg text-on-surface-variant mb-10 max-w-lg"
          >
            OracleDesk combines deep-learning reasoning traces with real-time market liquidity to provide institutional-grade forecasting.
          </motion.p>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-4"
          >
            <Link href="/markets" className="bg-primary text-primary-foreground px-8 py-4 rounded-lg font-label-caps text-label-caps tracking-widest hover:brightness-110 transition-all flex items-center gap-2">
              BROWSE MARKETS <Icon name="trending_up" />
            </Link>
            <Link href="/reasoning" className="border border-outline text-primary px-8 py-4 rounded-lg font-label-caps text-label-caps tracking-widest hover:bg-surface-container-low transition-all text-center">
              VIEW AI FORECASTS
            </Link>
          </motion.div>
        </div>
        <div className="relative">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="glass-panel p-6 rounded-xl shadow-sm border-outline-variant flex flex-col gap-6"
          >
            <div className="flex justify-between items-center gap-4">
              <span className="font-headline-sm text-headline-sm">
                {market ? market.question : isLoading ? "Loading live market…" : "No live markets yet"}
              </span>
              {market && <span className="font-data-mono text-primary bg-primary-fixed px-2 py-1 rounded text-[12px] whitespace-nowrap">LIVE SIGNAL</span>}
            </div>
            {market && prob !== null ? (
              <>
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <span className="font-label-caps text-on-surface-variant">MARKET PROBABILITY</span>
                    <span className="font-data-mono text-secondary font-bold">{prob.toFixed(1)}% YES</span>
                  </div>
                  <div className="h-10 w-full bg-surface-container rounded-full flex overflow-hidden border border-outline-variant">
                    <motion.div 
                      className="bg-secondary h-full"
                      animate={{ width: `${prob}%` }}
                      transition={{ duration: 1, ease: "easeInOut" }}
                    />
                    <motion.div 
                      className="bg-tertiary h-full flex-1"
                    />
                  </div>
                  <div className="flex justify-between text-label-caps font-bold">
                    <span className="text-secondary">YES ${(prob/100).toFixed(2)}</span>
                    <span className="text-tertiary">NO ${(1 - prob/100).toFixed(2)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant">
                    <div className="text-label-caps text-on-surface-variant mb-1">LIQUIDITY</div>
                    <div className="font-headline-sm text-on-surface">{formatLiquidity(market.totalLiquidity)}</div>
                  </div>
                  <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant">
                    <div className="text-label-caps text-on-surface-variant mb-1">ON-CHAIN</div>
                    <div className="font-headline-sm text-on-surface">{market.onChainMarketId !== null ? `#${market.onChainMarketId}` : "PENDING"}</div>
                  </div>
                </div>
                <Link
                  href={`/markets/quick-view?marketId=${market.id}`}
                  className="w-full border border-primary text-primary py-3 rounded font-label-caps text-label-caps tracking-widest hover:bg-primary/5 transition-colors text-center"
                >
                  VIEW LIVE MARKET
                </Link>
              </>
            ) : (
              <div className="h-40 flex items-center justify-center text-on-surface-variant font-body-md">
                {isLoading ? "Fetching the latest on-chain market…" : "No live markets found — check back soon."}
              </div>
            )}
          </motion.div>
          <div className="absolute -top-10 -right-10 -z-10 w-64 h-64 bg-primary-fixed-dim/20 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-10 -left-10 -z-10 w-64 h-64 bg-secondary-fixed/20 rounded-full blur-3xl"></div>
        </div>
      </div>
    </section>
  );
};

interface HomeMarketCardProps {
  id?: string;
  icon: IconName;
  category: string;
  platform: string;
  change: string;
  title: string;
  prob: number;
  volume: string;
  color?: string;
}

const MarketCard = ({ id, icon, category, platform, change, title, prob, volume, color = "secondary" }: HomeMarketCardProps) => {
  return (
    <div className="bg-white border border-outline-variant p-6 rounded-lg hover:shadow-md transition-all group cursor-pointer block">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-${color}/10 flex items-center justify-center text-${color}`}>
            <Icon name={icon} />
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-tighter text-primary">
              {platform}
            </span>
            <span className="font-label-caps text-on-surface-variant">{category}</span>
          </div>
        </div>
        <span className={`font-data-mono text-[12px] ${change.startsWith('+') ? 'text-secondary' : change.startsWith('-') ? 'text-tertiary' : 'text-on-surface-variant'}`}>{change}</span>
      </div>
      <Link href={id ? `/markets/quick-view?marketId=${id}` : "/markets"} className="block">
        <h3 className="font-headline-sm mb-4 group-hover:text-primary transition-colors">{title}</h3>
      </Link>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1">
          <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
            <div className={`bg-${color} h-full`} style={{ width: `${prob}%` }}></div>
          </div>
        </div>
        <span className="font-data-mono font-bold text-on-surface">{prob}%</span>
      </div>
      <div className="flex justify-between items-center">
        <div className="text-label-caps text-on-surface-variant">Vol: {volume}</div>
        <Link 
          href={id ? `/markets/quick-view?marketId=${id}` : "/markets"} 
          className="bg-primary text-primary-foreground px-4 py-2 rounded font-label-caps text-[10px] uppercase group-hover:bg-primary-container"
        >
          Trade Now
        </Link>
      </div>
    </div>
  );
};

const MarketsGrid = () => {
  const { data, isLoading } = useMarkets({ limit: 3 });
  const markets = data?.markets ?? [];

  return (
    <section className="py-20 max-w-container-max-width mx-auto px-gutter">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background">Live Prediction Markets</h2>
          <p className="text-on-surface-variant">Real-time betting on global outcomes verified by OracleDesk AI.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/markets" className="p-2 border border-outline-variant rounded hover:bg-white transition-colors flex items-center gap-2 font-label-caps text-label-caps">
            VIEW ALL <Icon name="arrow_forward" />
          </Link>
        </div>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="h-64 bg-surface-container-low animate-pulse motion-reduce:animate-none rounded-lg border border-outline-variant"></div>
          ))
        ) : markets.length > 0 ? (
          markets.map((m) => {
            let icon: IconName = 'policy';
            let color = 'secondary';
            
            if (m.category === 'CRYPTO') {
              icon = 'currency_bitcoin';
              color = 'primary';
            } else if (m.category === 'FED' || m.category === 'ECB' || m.category === 'MACRO') {
              icon = 'account_balance';
              color = 'secondary';
            } else if (m.category === 'ELECTION' || m.category === 'POLITICS') {
              icon = 'policy';
              color = 'secondary';
            } else if (m.category === 'SPORTS') {
              icon = 'sports_basketball';
              color = 'tertiary';
            } else if (m.category === 'GEOPOLITICAL') {
              icon = 'public';
              color = 'secondary';
            }

            return (
              <MarketCard 
                key={m.id}
                id={m.id}
                icon={icon}
                category={m.category}
                platform={m.onChainMarketId !== null ? `On-chain #${m.onChainMarketId}` : 'Not on-chain yet'}
                change=""
                title={m.question}
                prob={Math.round((m.currentYesProb ?? m.initialYesProb) * 100)}
                volume={`$${(m.totalLiquidity / 1000).toFixed(1)}K`}
                color={color}
              />
            );
          })
        ) : (
          <div className="col-span-full py-12 text-center bg-surface-container-low rounded-xl border border-outline-variant">
            <Icon name="search_off" className="text-outline text-4xl mb-4" />
            <p className="text-on-surface-variant font-medium">No live markets found.</p>
            <p className="text-on-surface-variant/70 text-sm mt-2">Check back later or deploy a new market from the admin terminal.</p>
          </div>
        )}
      </div>
    </section>
  );
};

const ReasoningSection = () => {
  return (
    <section className="bg-surface-container-low py-20">
      <div className="max-w-container-max-width mx-auto px-gutter grid lg:grid-cols-2 gap-16 items-center">
        <div className="order-2 lg:order-1">
          <div className="bg-on-background text-primary-fixed-dim rounded-xl overflow-hidden shadow-2xl border border-outline p-8 h-80 flex flex-col justify-center">
            <div className="font-data-mono text-sm space-y-2 overflow-hidden opacity-80">
              <p>&gt; INITIALIZING ORACLE TRACE 0x77AF...</p>
              <p>&gt; ANALYZING 14,204 DATA POINTS</p>
              <p>&gt; CROSS-REFERENCING HISTORICAL FOMC SENTIMENT</p>
              <p>&gt; CORRELATION DETECTED: 0.89 WITH 2019 PIVOT</p>
              <p>&gt; CALCULATING CONFIDENCE INTERVALS...</p>
              <p>&gt; TRACE ANCHORED ON STELLAR TESTNET</p>
              <p className="text-secondary animate-pulse motion-reduce:animate-none">&gt; VERDICT: DOVISH SHIFT CONFIRMED</p>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <div className="flex items-center gap-2 mb-4 text-primary">
            <Icon name="psychology" />
            <span className="font-label-caps">TRANSPARENT REASONING</span>
          </div>
          <h2 className="font-display-lg text-display-lg text-on-background mb-6">Trust, but verify with Oracle Traces.</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mb-8">
            Every prediction made by our models is accompanied by a full reasoning trace. We don&apos;t just give you a number; we show you the evidence, the chain of thought, and the risk factors.
          </p>
          <ul className="space-y-6">
            <li className="flex items-start gap-4">
              <div className="bg-primary-fixed p-2 rounded">
                <Icon name="verified" className="text-primary" />
              </div>
              <div>
                <h4 className="font-headline-sm">Verifiable AI Chains</h4>
                <p className="text-body-md text-on-surface-variant">Each trace is anchored on-chain to ensure zero tampering post-event.</p>
              </div>
            </li>
            <li className="flex items-start gap-4">
              <div className="bg-secondary-fixed p-2 rounded">
                <Icon name="hub" className="text-primary" />
              </div>
              <div>
                <h4 className="font-headline-sm">Multi-Model Consensus</h4>
                <p className="text-body-md text-on-surface-variant">Our engine aggregates results from three distinct reasoning architectures.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
};

const PortfolioAnalytics = () => {
  return (
    <section className="py-24 max-w-container-max-width mx-auto px-gutter">
      <div className="text-center mb-16">
        <h2 className="font-display-lg text-display-lg mb-4">Precision Portfolio Tracking</h2>
        <p className="text-on-surface-variant max-w-2xl mx-auto">Track your prediction edge across multiple markets with terminal-grade analytics.</p>
      </div>
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-7 bg-white border border-outline-variant p-6 rounded-xl shadow-sm">
          <h4 className="font-label-caps mb-4 text-on-surface-variant flex items-center gap-2">TOP POSITIONS <DemoBadge /></h4>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="font-body-md font-semibold">FED PIVOT MAY</span>
              <span className="text-secondary font-bold">+$4.2k</span>
            </div>
            <div className="flex justify-between">
              <span className="font-body-md font-semibold">ETH SPOT APPROVAL</span>
              <span className="text-secondary font-bold">+$1.8k</span>
            </div>
            <div className="flex justify-between">
              <span className="font-body-md font-semibold">UK ELECTION</span>
              <span className="text-tertiary font-bold">-$0.5k</span>
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-5 bg-primary-container text-on-primary-container p-6 rounded-xl shadow-sm flex flex-col justify-between h-full">
          <div>
            <Icon name="workspace_premium" className="text-[32px] mb-2" />
            <h4 className="font-headline-sm mb-2">Oracle Premium</h4>
            <p className="text-body-md text-on-primary-container/80 mb-4">Unlock advanced trace depth and lower trade fees with the Premium pass.</p>
          </div>
          <Link 
            href="/premium" 
            className="w-full bg-primary-fixed text-on-primary-fixed py-3 rounded font-bold font-label-caps text-[12px] tracking-widest text-center hover:brightness-110 transition-all"
          >
            UPGRADE NOW
          </Link>
        </div>
      </div>
    </section>
  );
};

const CTA = () => {
  const { openModal } = useWallet();
  return (
    <section className="py-20 bg-on-background text-surface">
      <div className="max-w-container-max-width mx-auto px-gutter text-center">
        <h2 className="font-display-lg text-display-lg mb-8">Ready to predict the future?</h2>
        <p className="text-surface-variant max-w-xl mx-auto mb-10 text-body-lg">Trade live prediction markets with USDC on Stellar Testnet, every forecast backed by a verifiable on-chain reasoning trace.</p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <button 
            className="border border-outline-variant text-primary-foreground px-10 py-5 rounded-lg font-bold font-label-caps tracking-widest hover:bg-white/10 hover:scale-105 transition-transform"
            onClick={() => openModal()}
          >
            CONNECT WALLET
          </button>
          <button className="border border-outline-variant px-10 py-5 rounded-lg font-bold font-label-caps tracking-widest hover:bg-white/10 hover:scale-105 transition-colors">READ DOCUMENTATION</button>
        </div>
      </div>
    </section>
  );
};

export default function HomePageClient() {
  return (
    <>
      <main className="pt-16">
        <Ticker />
        <Hero />
        <section className="bg-white py-12 border-b border-outline-variant">
          <div className="max-w-container-max-width mx-auto px-gutter grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <RealtimeProfiler id="AgentActivityFeed"><AgentActivityFeed /></RealtimeProfiler>
            </div>
            <div>
              <ProtocolActivity />
            </div>
          </div>
        </section>
        <MarketsGrid />
        <ReasoningSection />
        <PortfolioAnalytics />
        <CTA />
      </main>
    </>
  );
}
