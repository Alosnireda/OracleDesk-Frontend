import { ApiError } from "@/lib/api/client";
import { getMarketGenerationStatus, type GenerationJob } from "@/lib/api/markets";
import type { JobPatch, TrackedJobStatus } from "@/lib/admin/job-store";

/**
 * Pure polling rules for GET /markets/generation-status/:jobId, kept out of
 * the hook so the stop conditions and retry policy are unit-tested.
 */

/** 404 JOB_NOT_FOUND mapped to a result instead of an error. */
export interface MissingGenerationJob {
  jobId: string;
  status: "NOT_FOUND";
}

export type TrackedGenerationJob = GenerationJob | MissingGenerationJob;

export const POLL_RUNNING_MS = 5_000;
export const POLL_SLOW_MS = 15_000;
/** RUNNING jobs older than this are polled at POLL_SLOW_MS. */
export const SLOW_POLL_AFTER_MS = 2 * 60_000;
const MAX_NETWORK_RETRIES = 3;

/** Codes that retrying cannot fix: the job is gone, or the session needs a new sign-in. */
const NON_RETRYABLE_CODES = new Set(["JOB_NOT_FOUND", "UNAUTHORIZED", "INVALID_TOKEN", "TOKEN_EXPIRED", "FORBIDDEN"]);

export function isTerminalStatus(status: TrackedJobStatus | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "UNKNOWN" || status === "NOT_FOUND";
}

/**
 * Next poll delay, or false to stop. Uses the server's `elapsedMs`, never the
 * client clock, to decide when a run counts as long-running.
 */
export function nextPollInterval(job: TrackedGenerationJob | undefined): number | false {
  if (!job) return POLL_RUNNING_MS;
  if (isTerminalStatus(job.status)) return false;
  const elapsed = "elapsedMs" in job ? (job.elapsedMs ?? 0) : 0;
  return elapsed >= SLOW_POLL_AFTER_MS ? POLL_SLOW_MS : POLL_RUNNING_MS;
}

/** True when the error means "sign in again", so polling pauses instead of retrying. */
export function isSessionError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 || error.code === "UNAUTHORIZED" || error.code === "INVALID_TOKEN" || error.code === "TOKEN_EXPIRED")
  );
}

/** Retries network and server failures (up to 3 times); never auth errors or a missing job. */
export function shouldRetryStatus(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (NON_RETRYABLE_CODES.has(error.code) || error.status === 401 || error.status === 403 || error.status === 404)) {
    return false;
  }
  return failureCount < MAX_NETWORK_RETRIES;
}

/** Exponential backoff for retried status reads: 1 s, 2 s, 4 s … capped at 15 s. */
export const statusRetryDelay = (attempt: number) => Math.min(1_000 * 2 ** attempt, POLL_SLOW_MS);

/** The store fields a status answer updates. Absent fields leave stored values alone. */
export function toJobPatch(job: TrackedGenerationJob, seenAt: number): JobPatch {
  if (job.status === "NOT_FOUND") return { jobId: job.jobId, lastStatus: "NOT_FOUND", lastSeenAt: seenAt };
  const fields = {
    jobId: job.jobId,
    lastStatus: job.status,
    lastSeenAt: seenAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    elapsedMs: job.elapsedMs,
    marketId: job.marketId,
    onChainMarketId: job.onChainMarketId,
    question: job.question,
    error: job.error,
    message: job.message,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as JobPatch;
}

/** Reads a job's status, turning 404 JOB_NOT_FOUND into a NOT_FOUND result. */
export async function fetchTrackedJob(
  jobId: string,
  read: (jobId: string) => Promise<GenerationJob> = getMarketGenerationStatus,
): Promise<TrackedGenerationJob> {
  try {
    return await read(jobId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "JOB_NOT_FOUND") return { jobId, status: "NOT_FOUND" };
    throw error;
  }
}
