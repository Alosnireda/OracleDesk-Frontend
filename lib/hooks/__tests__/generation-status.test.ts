import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { GenerationJob } from "@/lib/api/markets";
import {
  POLL_RUNNING_MS,
  POLL_SLOW_MS,
  SLOW_POLL_AFTER_MS,
  fetchTrackedJob,
  isSessionError,
  nextPollInterval,
  shouldRetryStatus,
  toJobPatch,
} from "../generation-status";

const running = (elapsedMs: number): GenerationJob => ({
  jobId: "job-1",
  status: "RUNNING",
  startedAt: "2026-10-19T10:00:00.000Z",
  completedAt: null,
  elapsedMs,
});

describe("generation status polling", () => {
  it("stops polling on COMPLETED, FAILED, UNKNOWN and NOT_FOUND", () => {
    for (const status of ["COMPLETED", "FAILED", "UNKNOWN"] as const) {
      expect(nextPollInterval({ ...running(0), status })).toBe(false);
    }
    expect(nextPollInterval({ jobId: "job-1", status: "NOT_FOUND" })).toBe(false);
  });

  it("polls every 5 s while RUNNING and backs off after two minutes of server time", () => {
    expect(nextPollInterval(undefined)).toBe(POLL_RUNNING_MS);
    expect(nextPollInterval(running(SLOW_POLL_AFTER_MS - 1))).toBe(POLL_RUNNING_MS);
    expect(nextPollInterval(running(SLOW_POLL_AFTER_MS))).toBe(POLL_SLOW_MS);
  });

  it("maps 404 JOB_NOT_FOUND to a NOT_FOUND result", async () => {
    const missing = async () => {
      throw new ApiError({ code: "JOB_NOT_FOUND", message: "No generation job found" }, 404);
    };
    await expect(fetchTrackedJob("job-1", missing)).resolves.toEqual({ jobId: "job-1", status: "NOT_FOUND" });
  });

  it("passes other errors through", async () => {
    const down = async () => {
      throw new ApiError({ code: "BACKEND_UNREACHABLE", message: "down" }, 0);
    };
    await expect(fetchTrackedJob("job-1", down)).rejects.toMatchObject({ code: "BACKEND_UNREACHABLE" });
  });

  it("does not retry auth errors or a missing job", () => {
    for (const code of ["UNAUTHORIZED", "INVALID_TOKEN", "TOKEN_EXPIRED", "JOB_NOT_FOUND"]) {
      expect(shouldRetryStatus(0, new ApiError({ code, message: code }, code === "JOB_NOT_FOUND" ? 404 : 401))).toBe(false);
    }
    expect(isSessionError(new ApiError({ code: "TOKEN_EXPIRED", message: "expired" }, 401))).toBe(true);
  });

  it("retries network errors a bounded number of times", () => {
    const network = new ApiError({ code: "BACKEND_UNREACHABLE", message: "down" }, 0);
    expect(shouldRetryStatus(0, network)).toBe(true);
    expect(shouldRetryStatus(2, network)).toBe(true);
    expect(shouldRetryStatus(3, network)).toBe(false);
    expect(shouldRetryStatus(0, new TypeError("fetch failed"))).toBe(true);
  });

  it("builds store patches without overwriting fields the answer omits", () => {
    const unknown: GenerationJob = {
      jobId: "job-1",
      status: "UNKNOWN",
      startedAt: "2026-10-19T10:00:00.000Z",
      message: "Server restarted after this job started. Check recent markets.",
    };
    const patch = toJobPatch(unknown, 42);
    expect(patch).toEqual({
      jobId: "job-1",
      lastStatus: "UNKNOWN",
      lastSeenAt: 42,
      startedAt: "2026-10-19T10:00:00.000Z",
      message: "Server restarted after this job started. Check recent markets.",
    });
    expect("elapsedMs" in patch).toBe(false);
  });
});
