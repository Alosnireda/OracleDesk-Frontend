import { describe, expect, it } from "vitest";
import { describeJob, elapsedFor, formatElapsed, jobFeed } from "../job-events";
import type { StoredJob } from "../job-store";

const fmt = (iso: string) => iso.slice(11, 19);
const NOW = Date.parse("2026-10-19T14:05:00Z");

const base: StoredJob = {
  jobId: "3f2a9c1d-0000-4000-8000-000000000000",
  startedAt: "2026-10-19T14:02:11Z",
  lastStatus: "RUNNING",
  lastSeenAt: NOW,
};

describe("job events", () => {
  it("describes a start and a running job with server elapsed time", () => {
    const events = describeJob({ ...base, elapsedMs: 80_000 }, NOW, fmt);
    expect(events[0].text).toBe("Job 3f2a9c1d… started 14:02:11");
    expect(events[1].text).toBe("Still running (1m 20s)");
  });

  it("describes a completion with on-chain id", () => {
    const [, status] = describeJob(
      {
        ...base,
        lastStatus: "COMPLETED",
        completedAt: "2026-10-19T14:04:00Z",
        marketId: "m-1",
        onChainMarketId: "12",
        question: "Will BTC close above $100k?",
      },
      NOW,
      fmt,
    );
    expect(status.tone).toBe("success");
    expect(status.text).toBe('Completed: market "Will BTC close above $100k?" (backend id m-1, on-chain #12) (14:04:00)');
  });

  it("describes a dry-run completion", () => {
    const [, status] = describeJob(
      { ...base, lastStatus: "COMPLETED", completedAt: null, marketId: "m-2", onChainMarketId: null, question: "Q?" },
      NOW,
      fmt,
    );
    expect(status.tone).toBe("warning");
    expect(status.text).toContain("Completed in dry-run");
    expect(status.text).toContain("no on-chain market was created");
  });

  it("describes a failure with the error text", () => {
    const [, status] = describeJob(
      { ...base, lastStatus: "FAILED", completedAt: "2026-10-19T14:03:00Z", error: "LLM provider timed out" },
      NOW,
      fmt,
    );
    expect(status.tone).toBe("error");
    expect(status.text).toBe("Failed: LLM provider timed out (14:03:00)");
  });

  it("describes UNKNOWN using the backend message", () => {
    const [, status] = describeJob(
      { ...base, lastStatus: "UNKNOWN", message: "Server restarted after this job started. Check recent markets." },
      NOW,
      fmt,
    );
    expect(status.text).toBe("Status unknown: Server restarted after this job started. Check recent markets.");
  });

  it("describes a job the backend no longer tracks", () => {
    const [, status] = describeJob({ ...base, lastStatus: "NOT_FOUND" }, NOW, fmt);
    expect(status.text).toContain("No longer tracked by the backend");
  });

  it("adds only the local delta since the last answer to server elapsed time", () => {
    expect(elapsedFor({ ...base, elapsedMs: 10_000, lastSeenAt: NOW - 3_000 }, NOW)).toBe(13_000);
    expect(elapsedFor({ ...base, lastStatus: "COMPLETED", elapsedMs: 10_000, lastSeenAt: NOW - 3_000 }, NOW)).toBe(10_000);
    expect(elapsedFor({ ...base, lastStatus: "UNKNOWN" }, NOW)).toBeNull();
  });

  it("formats elapsed times", () => {
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(80_000)).toBe("1m 20s");
    expect(formatElapsed(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });

  it("lists the newest job's current state first", () => {
    const feed = jobFeed([{ ...base, jobId: "new", lastStatus: "FAILED", error: "x" }, { ...base, jobId: "old" }], NOW, 10, fmt);
    expect(feed.map((e) => e.key)).toEqual(["new:FAILED", "new:start", "old:RUNNING", "old:start"]);
  });
});
