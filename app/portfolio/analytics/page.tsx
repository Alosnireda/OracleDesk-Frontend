"use client";

import React from "react";
import { motion } from "framer-motion";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";

const data = [
  { time: "08:00 AM", value: 242000 },
  { time: "10:00 AM", value: 245000 },
  { time: "12:00 PM", value: 243500 },
  { time: "02:00 PM", value: 247000 },
  { time: "04:00 PM", value: 246000 },
  { time: "06:00 PM", value: 250000 },
  { time: "08:00 PM", value: 249000 },
  { time: "10:00 PM", value: 252000 },
  { time: "12:00 AM", value: 248592 },
];

interface KPIItemProps {
  label: string;
  value: string;
  icon: string;
  trend?: React.ReactNode;
  subtext?: React.ReactNode;
  color?: string;
}

const KPIItem = ({ label, value, icon, trend, subtext, color = "primary" }: KPIItemProps) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-surface-container-lowest p-6 border border-outline-variant rounded-lg shadow-sm"
  >
    <div className="flex items-center justify-between mb-2">
      <span className="font-label-caps text-label-caps text-on-surface-variant">{label}</span>
      <span className={`material-symbols-outlined text-${color}`}>{icon}</span>
    </div>
    <div className="font-headline-md text-headline-md text-on-surface">{value}</div>
    {trend && (
      <div className="mt-2 text-secondary font-data-mono flex items-center gap-1">
        <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
        {trend}
      </div>
    )}
    {subtext && (
      <div className="mt-2 text-on-surface-variant font-data-mono text-xs">
        {subtext}
      </div>
    )}
  </motion.div>
);

const ExposureBar = ({ label, percentage, color }: { label: string; percentage: number; color: string }) => (
  <div className="mb-6 last:mb-0">
    <div className="flex justify-between font-label-caps text-label-caps text-on-surface-variant mb-2">
      <span>{label}</span>
      <span>{percentage}%</span>
    </div>
    <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden">
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className={`h-full ${color}`}
      ></motion.div>
    </div>
  </div>
);

const ActivityTable = () => {
  const activities = [
    { name: "SpaceX Mars Landing by 2029", icon: "rocket_launch", pos: "NO", posColor: "bg-tertiary-container text-on-tertiary-container", stake: "$1,200.00", entry: "65.0¢", prob: 70, return: "-$112.20", retColor: "text-error" },
    { name: "GPT-5 Release Announcement", icon: "computer", pos: "YES", posColor: "bg-secondary-container text-on-secondary-container", stake: "$3,450.00", entry: "12.5¢", prob: 18, return: "+$1,120.00", retColor: "text-secondary" },
  ];

  return (
    <div className="lg:col-span-12 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
      <div className="p-6 border-b border-outline-variant flex justify-between items-center">
        <h3 className="font-headline-sm text-headline-sm text-on-surface">Recent Activity</h3>
        <button className="text-primary font-label-caps text-label-caps hover:underline">View All History</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant whitespace-nowrap">Market Entity</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Position</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Stake</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Entry Price</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Current Prob.</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant text-right whitespace-nowrap">Potential Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {activities.map((item, i) => (
              <tr key={i} className="hover:bg-slate-50 cursor-pointer transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[18px] text-primary">{item.icon}</span>
                    </div>
                    <div className="font-medium text-on-surface">{item.name}</div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 ${item.posColor} rounded font-bold text-label-caps`}>{item.pos}</span>
                </td>
                <td className="px-6 py-4 font-data-mono">{item.stake}</td>
                <td className="px-6 py-4 font-data-mono">{item.entry}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 min-w-[80px]">
                    <div className="w-16 bg-surface-container h-1 rounded-full">
                      <div className="bg-secondary h-full" style={{ width: `${item.prob}%` }}></div>
                    </div>
                    <span className="font-data-mono">{item.prob}%</span>
                  </div>
                </td>
                <td className={`px-6 py-4 text-right font-data-mono ${item.retColor}`}>{item.return}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function PortfolioAnalytics() {
  // Chart mounts only on the client so the prerender never measures a
  // zero-size ResponsiveContainer (silences the width(-1) build warning).
  const [chartMounted, setChartMounted] = React.useState(false);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setChartMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="min-h-screen bg-surface">
      <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <h1 className="font-display-lg text-display-lg text-on-surface">Portfolio Analytics</h1>
            <p className="text-on-surface-variant font-body-lg">Institutional trading analytics and performance tracking.</p>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-surface-container-highest border border-outline-variant rounded text-on-surface font-medium text-body-md hover:bg-surface-variant transition-colors">Export Report</button>
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded text-body-md font-bold hover:opacity-90 active:opacity-80 transition-opacity">Trade Now</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPIItem label="TOTAL BANKROLL" value="$248,592.12" icon="account_balance" trend="+12.4% vs last month" />
          <KPIItem label="TOTAL PNL (7D)" value="+$14,204.50" icon="payments" subtext={<>All-time: <span className="text-secondary">+$82,491.00</span></>} color="primary" />
          <KPIItem label="WIN RATE" value="64.8%" icon="target" subtext={
            <div className="mt-2 w-full bg-surface-container h-1 rounded-full overflow-hidden">
              <div className="bg-secondary h-full" style={{ width: "64.8%" }}></div>
            </div>
          } />
          <KPIItem label="OPEN POSITIONS" value="12 Active" icon="analytics" subtext="Total Exposure: $42,100.00" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
          <div className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Equity Performance Curve</h3>
              <div className="flex bg-surface-container rounded p-1 gap-1">
                {["1D", "1W", "1M", "ALL"].map((p) => (
                  <button key={p} className={`px-3 py-1 text-label-caps font-bold rounded ${p === "1D" ? "bg-surface-container-lowest shadow-sm" : "text-on-surface-variant"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[320px] w-full">
              {chartMounted ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={320}>
                  <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="100%">
                      <stop offset="5%" stopColor="#006c49" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#006c49" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#bfc8cc" opacity={0.3} />
                  <XAxis dataKey="time" hide />
                  <YAxis 
                    domain={['dataMin - 5000', 'dataMax + 5000']} 
                    hide
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bfc8cc' }}
                    labelStyle={{ fontFamily: 'Geist', fontWeight: 'bold' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#006c49" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
              ) : (
                <div className="h-full w-full animate-pulse-soft rounded bg-surface-container" />
              )}
              <div className="mt-4 flex justify-between text-on-surface-variant font-data-mono text-[11px]">
                <span>08:00 AM</span>
                <span>12:00 PM</span>
                <span>04:00 PM</span>
                <span>08:00 PM</span>
                <span>12:00 AM</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm p-6">
            <h3 className="font-headline-sm text-headline-sm text-on-surface mb-6">Exposure Distribution</h3>
            <div className="flex flex-col gap-6">
              <ExposureBar label="POLITICAL MARKETS" percentage={42} color="bg-primary" />
              <ExposureBar label="MACRO ECONOMICS" percentage={28} color="bg-secondary" />
              <ExposureBar label="TECH & AI" percentage={20} color="bg-surface-tint" />
              <ExposureBar label="SPORTS" percentage={10} color="bg-outline" />
            </div>
            <div className="mt-8 p-4 bg-surface-container-low rounded-lg border border-outline-variant">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary">info</span>
                <div>
                  <span className="block font-label-caps text-label-caps text-on-surface mb-1">DIVERSIFICATION SCORE</span>
                  <span className="text-headline-sm text-headline-sm text-primary">High (8.4/10)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
          <ActivityTable />
        </div>

        <div className="lg:col-span-12">
          <div className="bg-[#f0f9fa] border border-primary-container rounded-lg p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <span className="material-symbols-outlined text-[120px]">smart_toy</span>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-primary">bolt</span>
              <h3 className="font-headline-sm text-headline-sm text-primary">Oracle AI Insights</h3>
            </div>
            <p className="text-on-surface mb-6 max-w-3xl font-body-lg">
              Based on your current portfolio skew towards political markets, you are highly exposed to sentiment shifts in the upcoming debates. OracleDesk recommends hedging with uncorrelated macro-economic markets to stabilize your equity curve. Your Sharpe ratio has increased by 14% over the last 7 sessions due to disciplined entry points on low-liquidity long-shots.
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="flex items-center gap-2 px-4 py-2 border border-primary-container rounded text-primary font-bold text-body-md hover:bg-white transition-colors">
                <span className="material-symbols-outlined text-[18px]">psychology</span>
                View Full Reasoning
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded font-bold text-body-md hover:opacity-90 transition-opacity">
                Execute Hedge Recommendation
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
