"use client";

import React from "react";
import Link from "next/link";
import { RequireWallet } from "@/components/require-wallet";
import { useWallet } from "@/lib/contexts/WalletContext";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { usePlatformStats } from "@/lib/hooks/usePortfolio";
import { isAdminAddress } from "@/lib/stellar/config";
import { DiagnosticsPanel } from "@/components/admin/diagnostics-panel";
import { JobStatusChip } from "@/components/admin/job-status-chip";
import { useAdminJobs } from "@/lib/admin/job-store";
import { formatLocalTime, shortJobId } from "@/lib/admin/job-events";

/** Last five runs this browser started, from the job store (no polling here). */
function RecentGenerationRuns({ address }: { address: string | null }) {
  const { jobs } = useAdminJobs(address);
  const recent = jobs.slice(0, 5);
  return (
    <div className="bg-white border border-outline-variant rounded-xl overflow-hidden shadow-sm">
      <div className="p-6 border-b border-outline-variant flex justify-between items-center">
        <h3 className="font-headline-sm text-headline-sm">Recent generation runs</h3>
        <Link href="/admin/create" className="text-primary font-label-caps text-label-caps hover:underline">
          Track runs
        </Link>
      </div>
      {recent.length === 0 ? (
        <div className="p-8 text-center text-on-surface-variant italic">No runs started from this browser.</div>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {recent.map((job) => (
            <li key={job.jobId} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <JobStatusChip status={job.lastStatus} />
                <span className="font-data-mono text-data-mono" title={job.jobId}>{shortJobId(job.jobId)}</span>
                {job.question && <span className="truncate text-on-surface-variant">{job.question}</span>}
              </div>
              <span className="text-[11px] text-on-surface-variant shrink-0">{formatLocalTime(job.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const AdminStat = ({ label, value, change }: { label: string, value: string, change?: string }) => (
  <div className="bg-white p-6 border border-outline-variant rounded-lg flex flex-col justify-between hover:shadow-md transition-all">
    <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">{label}</span>
    <div className="flex items-baseline gap-2 mt-2">
      <span className="font-headline-md text-headline-md">{value}</span>
      {change && (
        <span className="text-on-surface-variant font-label-caps text-label-caps flex items-center">{change}</span>
      )}
    </div>
  </div>
);

const MarketItem = ({ title, status, volume }: { title: string, status: string, volume: string }) => (
  <div className="flex items-center justify-between p-4 hover:bg-surface-container-low transition-colors border-b border-outline-variant last:border-0">
    <div>
      <p className="font-body-md font-bold text-on-surface">{title}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className={`w-2 h-2 rounded-full ${status === 'Active' ? 'bg-secondary' : 'bg-outline-variant'}`}></span>
        <span className="text-[11px] text-on-surface-variant uppercase font-label-caps">{status}</span>
      </div>
    </div>
    <div className="text-right">
      <p className="font-data-mono text-data-mono text-on-surface">{volume}</p>
      <p className="text-[11px] text-on-surface-variant uppercase font-label-caps text-[10px]">Liquidity</p>
    </div>
  </div>
);

export default function AdminDashboard() {
  return (
    <RequireWallet
      title="Restricted Access"
      description="The Admin Control Center requires a secure wallet connection for institutional authentication."
    >
      <AdminContent />
    </RequireWallet>
  );
}

function AdminContent() {
  const { address, disconnect, openModal } = useWallet();
  const { data: marketsData, isLoading } = useMarkets({ limit: 10 });
  const { data: stats } = usePlatformStats();
  const markets = marketsData?.markets ?? [];

  // UI gate only. The backend checks ADMIN_ADDRESSES itself on every admin
  // request; hiding this page does not protect anything.
  const isAuthorized = isAdminAddress(address);

  if (!isAuthorized) {
    return (
      <main className="flex-grow flex items-center justify-center p-gutter">
        <div className="max-w-md w-full text-center space-y-6 bg-white p-10 rounded-xl border border-outline-variant shadow-sm">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-4xl">block</span>
          </div>
          <div className="space-y-2">
            <h2 className="font-headline-md text-headline-md">Access Denied</h2>
            <p className="text-on-surface-variant">
              Your wallet address is not authorized to access the Admin Control Center. This page is restricted to authorized team members only.
            </p>
            <p className="text-on-surface-variant text-sm mt-4 font-data-mono break-all">
              {address}
            </p>
          </div>
          <button
            // Disconnect first so the kit's picker lets the user choose another account.
            onClick={() => void disconnect().then(() => openModal())}
            className="w-full bg-outline text-on-outline py-4 rounded-lg font-label-caps text-label-caps hover:brightness-90 transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
          >
            <span className="material-symbols-outlined">swap_horiz</span>
            SWITCH WALLET
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow max-w-container-max-width mx-auto px-gutter py-12 w-full space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div className="space-y-2">
          <h1 className="font-display-lg text-display-lg text-primary text-4xl">Admin Control Center</h1>
          <p className="text-on-surface-variant font-body-lg text-body-lg">
            Monitor protocol health and manage institutional prediction markets.
          </p>
        </div>
        <Link 
          href="/admin/create" 
          className="bg-primary text-primary-foreground px-6 py-4 rounded-lg font-label-caps text-label-caps flex items-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all shadow-lg"
        >
          <span className="material-symbols-outlined">add_circle</span>
          CREATE NEW MARKET
        </Link>
        <Link
          href="/admin/agents"
          className="border border-outline text-on-surface px-6 py-4 rounded-lg font-label-caps text-label-caps flex items-center gap-2 hover:bg-surface-container-low transition-all"
        >
          <span className="material-symbols-outlined">smart_toy</span>
          MANAGE AGENTS
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AdminStat label="Copy-trade volume" value={stats ? `$${stats.totalCopyVolume.toLocaleString()}` : "—"} />
        <AdminStat label="Markets (backend db)" value={stats ? String(stats.marketCount) : "—"} change={stats ? `${stats.onChainMarketCount} on-chain ids` : undefined} />
        <AdminStat label="Users" value={stats ? String(stats.subscriberCount) : "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-12 space-y-6">
          <div className="bg-white border border-outline-variant rounded-xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-outline-variant flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm">Active Markets</h3>
              <button className="text-primary font-label-caps text-label-caps hover:underline">View All</button>
            </div>
            <div className="divide-y divide-outline-variant">
              {isLoading ? (
                <div className="p-8 text-center text-on-surface-variant animate-pulse">Loading markets...</div>
              ) : markets.length > 0 ? (
                markets.map((m) => (
                  <MarketItem 
                    key={m.id}
                    title={m.question} 
                    status={m.status === 'ACTIVE' ? 'Active' : m.status.charAt(0) + m.status.slice(1).toLowerCase()} 
                    volume={`$${(m.totalLiquidity).toLocaleString()}`} 
                  />
                ))
              ) : (
                <div className="p-8 text-center text-on-surface-variant italic">No markets found. Deploy one to get started.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <RecentGenerationRuns address={address} />

      <DiagnosticsPanel />
    </main>
  );
}
