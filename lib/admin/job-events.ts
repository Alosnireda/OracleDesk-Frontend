import type { StoredJob } from "./job-store";

/**
 * Plain-language events derived from a tracked job's real state. Nothing here
 * is invented: every line comes from a field the backend returned or from the
 * moment this browser started the run.
 */

export type JobEventTone = "info" | "success" | "warning" | "error";

export interface JobEvent {
  key: string;
  /** ISO timestamp the event refers to, when known. */
  at: string | null;
  tone: JobEventTone;
  text: string;
}

export type TimeFormatter = (iso: string) => string;

/** The user's locale and time zone. */
export const formatLocalTime: TimeFormatter = (iso) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toLocaleTimeString();
};

export const shortJobId = (jobId: string) => (jobId.length > 8 ? `${jobId.slice(0, 8)}…` : jobId);

/** "45s", "1m 20s", "2h 5m". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Elapsed run time. The server's `elapsedMs` is the base; for a RUNNING job
 * only the time since that answer is added from the local clock, so clock
 * skew between browser and server never shows up. Null when unknown.
 */
export function elapsedFor(job: StoredJob, now: number): number | null {
  if (job.elapsedMs !== undefined) {
    return job.lastStatus === "RUNNING" ? job.elapsedMs + Math.max(0, now - job.lastSeenAt) : job.elapsedMs;
  }
  return job.lastStatus === "RUNNING" ? Math.max(0, now - job.lastSeenAt) : null;
}

/** True when a completed run left no on-chain market (dry-run, or on-chain creation failed). */
export const completedWithoutChain = (job: StoredJob) =>
  job.lastStatus === "COMPLETED" && Boolean(job.marketId) && !job.onChainMarketId;

function statusEvent(job: StoredJob, now: number): Omit<JobEvent, "key"> {
  switch (job.lastStatus) {
    case "RUNNING": {
      const elapsed = elapsedFor(job, now);
      return { at: null, tone: "info", text: elapsed === null ? "Still running" : `Still running (${formatElapsed(elapsed)})` };
    }
    case "COMPLETED": {
      const at = job.completedAt ?? null;
      if (!job.marketId) return { at, tone: "warning", text: "Completed, but the backend reported no market for this run" };
      const market = job.question ? `market "${job.question}"` : "a market";
      if (completedWithoutChain(job)) {
        return {
          at,
          tone: "warning",
          text: `Completed in dry-run: ${market} (backend id ${job.marketId}) was saved, but no on-chain market was created`,
        };
      }
      return { at, tone: "success", text: `Completed: ${market} (backend id ${job.marketId}, on-chain #${job.onChainMarketId})` };
    }
    case "FAILED":
      return { at: job.completedAt ?? null, tone: "error", text: `Failed: ${job.error ?? "the backend gave no error text"}` };
    case "UNKNOWN":
      return {
        at: null,
        tone: "warning",
        text: `Status unknown: ${job.message ?? "the backend restarted after this job started"}`,
      };
    case "NOT_FOUND":
      return {
        at: null,
        tone: "warning",
        text: "No longer tracked by the backend: it keeps finished jobs for one hour",
      };
  }
}

/** Start event plus the current-state event for one job. */
export function describeJob(job: StoredJob, now: number, formatTime: TimeFormatter = formatLocalTime): JobEvent[] {
  const status = statusEvent(job, now);
  return [
    { key: `${job.jobId}:start`, at: job.startedAt, tone: "info", text: `Job ${shortJobId(job.jobId)} started ${formatTime(job.startedAt)}` },
    { key: `${job.jobId}:${job.lastStatus}`, ...status, text: status.at ? `${status.text} (${formatTime(status.at)})` : status.text },
  ];
}

/** Events for the newest `limit` jobs, newest first. O(limit). */
export function jobFeed(jobs: readonly StoredJob[], now: number, limit = 10, formatTime: TimeFormatter = formatLocalTime): JobEvent[] {
  return jobs.slice(0, limit).flatMap((job) => describeJob(job, now, formatTime).reverse());
}
