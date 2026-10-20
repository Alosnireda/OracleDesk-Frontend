"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { GenerationJobStatus } from "@/lib/api/markets";
import { STELLAR_NETWORK_ID } from "@/lib/stellar/config";

/**
 * Market-generation jobs this browser started, per admin address and network,
 * persisted in localStorage so a reload keeps tracking them. The backend keeps
 * jobs in memory only (pruned an hour after they finish), so this list is the
 * operator's record of what was started.
 *
 * Every storage access is wrapped: a private window or blocked storage reads
 * as an empty list and writes become no-ops.
 */

/** NOT_FOUND: the backend answered 404 JOB_NOT_FOUND (pruned, or never seen). */
export type TrackedJobStatus = GenerationJobStatus | "NOT_FOUND";

export interface StoredJob {
  jobId: string;
  /** Server start time once polled; the client's time of the POST before that. */
  startedAt: string;
  lastStatus: TrackedJobStatus;
  /** Client ms when the backend last answered for this job. */
  lastSeenAt: number;
  completedAt?: string | null;
  /** Server-computed elapsed time at `lastSeenAt` (clock-skew safe). */
  elapsedMs?: number;
  marketId?: string;
  onChainMarketId?: string | null;
  question?: string;
  error?: string;
  /** Backend explanation for UNKNOWN. */
  message?: string;
}

export interface JobScope {
  address: string;
  network: string;
}

export const MAX_STORED_JOBS = 50;
const KEY_PREFIX = "oracledesk_admin_jobs";
const STATUSES: readonly TrackedJobStatus[] = ["RUNNING", "COMPLETED", "FAILED", "UNKNOWN", "NOT_FOUND"];

export const jobsKey = ({ address, network }: JobScope) => `${KEY_PREFIX}:${network}:${address}`;

function isStoredJob(value: unknown): value is StoredJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.jobId === "string" &&
    job.jobId.length > 0 &&
    typeof job.startedAt === "string" &&
    typeof job.lastSeenAt === "number" &&
    STATUSES.includes(job.lastStatus as TrackedJobStatus)
  );
}

/** Parses a stored list, dropping malformed entries. Malformed JSON reads as empty. */
export function parseJobs(raw: string | null): StoredJob[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredJob).slice(0, MAX_STORED_JOBS) : [];
  } catch {
    return [];
  }
}

function readRaw(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, jobs: StoredJob[]): void {
  try {
    storage?.setItem(key, JSON.stringify(jobs));
  } catch {
    // Quota or blocked storage: tracking continues in memory for this page.
  }
  notify();
}

export function readJobs(storage: Storage | null, scope: JobScope): StoredJob[] {
  return parseJobs(readRaw(storage, jobsKey(scope)));
}

/**
 * Merges `patch` into the job with the same id, keeping its position, or
 * inserts it first (newest first). The list is capped at MAX_STORED_JOBS by
 * dropping the oldest. O(n) in the list length, n ≤ 50.
 */
export function upsertJob(storage: Storage | null, scope: JobScope, patch: JobPatch): StoredJob[] {
  const jobs = readJobs(storage, scope);
  const index = jobs.findIndex((job) => job.jobId === patch.jobId);
  if (index >= 0) {
    jobs[index] = { ...jobs[index], ...patch };
  } else {
    const fresh: StoredJob = { startedAt: new Date().toISOString(), lastStatus: "RUNNING", lastSeenAt: Date.now(), ...patch };
    jobs.unshift(fresh);
  }
  const next = jobs.slice(0, MAX_STORED_JOBS);
  write(storage, jobsKey(scope), next);
  return next;
}

export function removeJob(storage: Storage | null, scope: JobScope, jobId: string): StoredJob[] {
  const next = readJobs(storage, scope).filter((job) => job.jobId !== jobId);
  write(storage, jobsKey(scope), next);
  return next;
}

/** Jobs started within the backend's one-hour rate-limit window. */
export function runsInLastHour(jobs: readonly StoredJob[], now: number): number {
  const cutoff = now - 60 * 60 * 1000;
  return jobs.reduce((count, job) => (Date.parse(job.startedAt) > cutoff ? count + 1 : count), 0);
}

// ─── React binding ──────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
const snapshots = new Map<string, { raw: string | null; jobs: StoredJob[] }>();
const EMPTY: StoredJob[] = [];

function notify() {
  for (const listener of listeners) listener();
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Other tabs: the storage event fires there, never in the tab that wrote.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Same array while the stored text is unchanged, as useSyncExternalStore requires. */
function snapshot(key: string): StoredJob[] {
  const raw = readRaw(browserStorage(), key);
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.jobs;
  const jobs = parseJobs(raw);
  snapshots.set(key, { raw, jobs });
  return jobs;
}

export type JobPatch = Pick<StoredJob, "jobId"> & Partial<StoredJob>;

/** Saves a job for `address` on the configured network in this browser's storage. */
export function saveJob(address: string, patch: JobPatch): void {
  upsertJob(browserStorage(), { address, network: STELLAR_NETWORK_ID }, patch);
}

export interface AdminJobs {
  jobs: StoredJob[];
  dismiss: (jobId: string) => void;
}

/** The connected admin's jobs on this network, updated across components and tabs. */
export function useAdminJobs(address: string | null | undefined): AdminJobs {
  const key = address ? jobsKey({ address, network: STELLAR_NETWORK_ID }) : null;
  const jobs = useSyncExternalStore(
    subscribe,
    () => (key ? snapshot(key) : EMPTY),
    () => EMPTY,
  );
  const dismiss = useCallback<AdminJobs["dismiss"]>(
    (jobId) => {
      if (address) removeJob(browserStorage(), { address, network: STELLAR_NETWORK_ID }, jobId);
    },
    [address],
  );
  return { jobs, dismiss };
}
