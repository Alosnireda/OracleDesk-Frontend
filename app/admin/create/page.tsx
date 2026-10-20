"use client";
import { Icon } from "@/components/ui/icon";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequireWallet } from "@/components/require-wallet";
import { SourceTag } from "@/components/ui/source-tag";
import { useWallet } from "@/lib/contexts/WalletContext";
import { useGenerateMarket, useMarketGenerationStatus } from "@/lib/hooks/useMarkets";
import { isTerminalStatus } from "@/lib/hooks/generation-status";
import { ApiError } from "@/lib/api/client";
import { UserFacingError } from "@/lib/stellar/errors";
import { isAdminAddress } from "@/lib/stellar/config";
import { DEFAULTS, serializeDiscovery } from "@/lib/markets/discovery-params";
import { runsInLastHour, saveJob, useAdminJobs, type StoredJob } from "@/lib/admin/job-store";
import { completedWithoutChain, elapsedFor, formatElapsed, jobFeed, shortJobId, type JobEventTone } from "@/lib/admin/job-events";
import { JobStatusChip } from "@/components/admin/job-status-chip";

/** Backend limit on POST /markets/generate (per IP; each run calls paid LLM APIs). */
const RUNS_PER_HOUR = 5;
const RECENT_MARKETS_HREF = `/markets?${serializeDiscovery({ ...DEFAULTS, status: "ALL" })}`;

/** Event colours on the inverse (dark) terminal surface. */
const TONE_CLASS: Record<JobEventTone, string> = {
  info: "opacity-80",
  success: "text-secondary-fixed",
  warning: "text-tertiary-fixed",
  error: "text-error-container",
};

/** Ticks once a second while `active`, so RUNNING jobs show live elapsed time. */
function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function describeStartError(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return err.retryAfterSeconds
        ? `The backend allows ${RUNS_PER_HOUR} runs per hour. Try again in ${formatElapsed(err.retryAfterSeconds * 1_000)}.`
        : `The backend allows ${RUNS_PER_HOUR} runs per hour. Try again later.`;
    }
    return err.message;
  }
  return "Couldn't start the run. Check that the backend is reachable.";
}

export default function AdminCreatePage() {
  return (
    <RequireWallet
      title="Restricted Access"
      description="Starting market-maker runs requires a wallet connection for admin authentication."
    >
      <AdminCreateContent />
    </RequireWallet>
  );
}

function AdminCreateContent() {
  const { address, withSession } = useWallet();
  const generateMarket = useGenerateMarket();
  const { jobs, dismiss } = useAdminJobs(address);
  const [startError, setStartError] = useState<string | null>(null);
  // A click starts one logical run; the key makes retries of it idempotent on the backend.
  const starting = useRef(false);

  const now = useSecondClock(jobs.some((job) => job.lastStatus === "RUNNING"));
  const recentRuns = runsInLastHour(jobs, now);

  const handleStart = async () => {
    if (!address || starting.current) return;
    starting.current = true;
    setStartError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      // Signs in to the backend only now, right before the protected call.
      const result = await withSession(() => generateMarket.mutateAsync({ idempotencyKey }), "start a market-maker run");
      saveJob(address, { jobId: result.jobId, lastStatus: "RUNNING", lastSeenAt: Date.now(), startedAt: new Date().toISOString() });
    } catch (err) {
      setStartError(describeStartError(err));
    } finally {
      starting.current = false;
    }
  };

  // UI gate only; the backend enforces admin rights on /markets/generate.
  if (!isAdminAddress(address)) {
    return (
      <main className="flex-grow flex items-center justify-center p-gutter">
        <div className="max-w-md w-full text-center space-y-4 bg-white p-10 rounded-xl border border-outline-variant shadow-sm">
          <h2 className="font-headline-md text-headline-md">Access Denied</h2>
          <p className="text-on-surface-variant">Only OracleDesk admins can start market-maker runs.</p>
          <p className="text-on-surface-variant text-sm font-data-mono break-all">{address}</p>
        </div>
      </main>
    );
  }

  const feed = jobFeed(jobs, now);

  return (
    <main className="flex-grow max-w-container-max-width mx-auto px-gutter py-12 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-2">
            <h1 className="font-display-lg text-display-lg text-primary">Start a market-maker run</h1>
            <p className="text-on-surface-variant font-body-lg text-body-lg">
              The market-maker agent chooses the question, category and close time from live signals. Inputs here are
              not used by the backend yet, so this page sends none.
            </p>
          </div>
          
          <form className="space-y-6 bg-white p-8 rounded-xl border border-outline-variant shadow-sm">
            {/* Market Question */}
            <div className="space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant flex items-center justify-between">
                MARKET_QUESTION
                <span className="text-[10px] opacity-50">REQUIRED</span>
              </label>
              <input
                className="w-full bg-surface border border-outline-variant rounded p-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all font-body-md text-body-md outline-none"
                id="market_question"
                placeholder="Will ETH exceed $5,000 by year end?"
                type="text"
                value={question}
                onChange={handleQuestionChange}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Category */}
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant">CATEGORY</label>
                <select
                  className="w-full bg-surface border border-outline-variant rounded p-3 font-body-md text-body-md outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                  id="market_category"
                  value={category}
                  onChange={handleCategoryChange}
                >
                  {BACKEND_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {BACKEND_CATEGORY_LABELS[c]} (on-chain: {BACKEND_TO_CONTRACT_CATEGORY[c]})
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Expiry */}
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant">EXPIRY_DATE</label>
                <input
                  className="w-full bg-surface border border-outline-variant rounded p-3 font-body-md text-body-md outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                  id="market_expiry"
                  type="date"
                  value={expiry}
                  onChange={handleExpiryChange}
                />
              </div>
            </div>

            {/* Initial Liquidity */}
            <div className="space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant flex justify-between">
                INITIAL_LIQUIDITY (USDC)
                <span className="text-secondary font-bold">Min: 100 USDC</span>
              </label>
              <div className="relative">
                <input
                  className="w-full bg-surface border border-outline-variant rounded p-3 pl-12 font-data-mono text-data-mono outline-none focus:ring-2 focus:ring-primary"
                  id="market_liquidity"
                  placeholder="1000.00"
                  type="number"
                  value={liquidity}
                  onChange={handleLiquidityChange}
                />
                <Icon name="account_balance_wallet" className="absolute left-3 top-3 text-on-surface-variant" />
              </div>
            </div>

            {/* AI Toggle */}
            <div className="flex items-center justify-between p-4 bg-surface-container-low rounded border border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-primary-container flex items-center justify-center text-on-primary-container">
                  <Icon name="psychology" />
                </div>
                <div>
                  <h3 className="font-headline-sm text-headline-sm">AI Oracle Reasoning</h3>
                  <p className="text-[12px] text-on-surface-variant">Generate autonomous probability analysis reports.</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={aiEnabled}
                  onChange={handleAiToggle}
                />
                <div className="w-11 h-6 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

          <div className="space-y-4 bg-white p-8 rounded-xl border border-outline-variant shadow-sm">
            <p className="text-sm text-on-surface-variant">
              Each run calls paid LLM APIs, may pin documents to IPFS and may create a market on-chain through the
              treasury.
            </p>
            <p className="font-data-mono text-data-mono text-on-surface" aria-live="polite">
              Runs started from this browser in the last hour: {recentRuns} of {RUNS_PER_HOUR}
            </p>
            <p className="text-[12px] text-on-surface-variant">
              The backend counts runs per IP address, so runs started elsewhere also count.
            </p>
            <button
              className="w-full py-4 bg-primary text-primary-foreground font-label-caps text-label-caps rounded-lg hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              onClick={handleStart}
              disabled={generateMarket.isPending}
            >
              <Icon name="rocket_launch" />
              {generateMarket.isPending ? "GENERATING..." : "DEPLOY INSTITUTIONAL MARKET"}
            </button>
            {startError && (
              <p role="alert" className="text-sm text-error">
                {startError}
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="p-6 border-b border-outline-variant">
              <h2 className="font-headline-sm text-headline-sm">Generation runs</h2>
              <p className="text-[12px] text-on-surface-variant mt-1">
                Runs started from this browser by {shortJobId(address ?? "")} on this network.
              </p>
            </div>
            {jobs.length === 0 ? (
              <p className="p-8 text-center text-on-surface-variant italic">No runs started yet.</p>
            ) : (
              <ul className="divide-y divide-outline-variant">
                {jobs.map((job) => (
                  <JobRow key={job.jobId} job={job} address={address as string} now={now} onDismiss={dismiss} />
                ))}
              </ul>
            )}
          </section>

              <div className="grid grid-cols-2 gap-4 border-t border-outline-variant pt-6">
                <div className="space-y-1">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block">LIQUIDITY</span>
                  <span className="font-data-mono text-data-mono text-on-surface">
                    {liquidity ? `${parseFloat(liquidity).toLocaleString()} USDC` : "0.00 USDC"}
                  </span>
                </div>
                <div className="space-y-1">
                  <span className="font-label-caps text-label-caps text-on-surface-variant block">EXPIRES</span>
                  <span className="font-data-mono text-data-mono text-on-surface">
                    {expiry || "-- -- ----"}
                  </span>
                </div>
              </div>

              {/* AI Reasoning Ghost Card */}
              <div 
                className={`p-4 bg-[#f0f9fa] rounded border border-primary-container/20 space-y-2 transition-opacity duration-300 ${aiEnabled ? "opacity-100" : "opacity-0"}`}
              >
                <div className="flex items-center gap-2 text-primary">
                  <Icon name="auto_awesome" className="text-[18px]" />
                  <span className="font-label-caps text-label-caps">ORACLE INSIGHT ENABLED</span>
                </div>
                <div className="h-2 w-3/4 bg-primary-container/10 rounded"></div>
                <div className="h-2 w-1/2 bg-primary-container/10 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function JobRow({
  job,
  address,
  now,
  onDismiss,
}: {
  job: StoredJob;
  address: string;
  now: number;
  onDismiss: (jobId: string) => void;
}) {
  const { ensureSession } = useWallet();
  const { query, sessionExpired } = useMarketGenerationStatus(address, job.jobId, !isTerminalStatus(job.lastStatus));
  const elapsed = elapsedFor(job, now);

  const resume = async () => {
    if (await ensureSession()) void query.refetch();
  };

  return (
    <li className="p-6 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <JobStatusChip status={job.lastStatus} />
          <span className="font-data-mono text-data-mono text-on-surface" title={job.jobId}>
            {shortJobId(job.jobId)}
          </span>
          {elapsed !== null && <span className="text-[12px] text-on-surface-variant">{formatElapsed(elapsed)}</span>}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(job.jobId)}
          className="text-[12px] font-label-caps text-on-surface-variant hover:text-on-surface hover:underline"
        >
          Dismiss
        </button>
      </div>

      {job.question && <p className="font-body-md text-on-surface">{job.question}</p>}

      {job.lastStatus === "COMPLETED" && job.marketId && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href={`/markets/quick-view?marketId=${encodeURIComponent(job.marketId)}`} className="text-primary font-semibold hover:underline">
            Open market
          </Link>
          {job.onChainMarketId && (
            <span className="text-on-surface-variant">
              <Link href={`/market?onChainId=${encodeURIComponent(job.onChainMarketId)}`} className="hover:underline">
                On-chain #{job.onChainMarketId}
              </Link>
              <SourceTag source="backend" />
            </span>
          )}
        </div>
      )}
      {completedWithoutChain(job) && (
        <p className="text-sm text-tertiary">
          Created in the database only. The backend is in dry-run mode or on-chain creation failed; check backend logs.
        </p>
      )}
      {job.lastStatus === "COMPLETED" && !job.marketId && (
        <p className="text-sm text-tertiary">The run finished without reporting a market.</p>
      )}
      {job.lastStatus === "FAILED" && <p className="text-sm text-error">{job.error ?? "The backend gave no error text."}</p>}
      {(job.lastStatus === "UNKNOWN" || job.lastStatus === "NOT_FOUND") && (
        <p className="text-sm text-on-surface-variant">
          {job.lastStatus === "UNKNOWN"
            ? (job.message ?? "The backend restarted after this job started.")
            : "No longer tracked by the backend. It keeps finished jobs for one hour."}{" "}
          <Link href={RECENT_MARKETS_HREF} className="text-primary hover:underline">
            Check recent markets
          </Link>
        </p>
      )}

      {sessionExpired && (
        <p className="text-sm text-on-surface-variant">
          Sign in again to keep tracking.{" "}
          <button type="button" onClick={resume} className="text-primary font-semibold hover:underline">
            Sign in
          </button>
        </p>
      )}
      {query.isError && !sessionExpired && (
        <p className="text-[12px] text-error">
          Couldn&apos;t read this job&apos;s status{query.error instanceof Error ? `: ${query.error.message}` : "."}
        </p>
      )}
    </li>
  );
}
