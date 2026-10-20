import { describe, expect, it } from "vitest";
import { MAX_STORED_JOBS, jobsKey, readJobs, removeJob, runsInLastHour, upsertJob, type JobScope } from "../job-store";

/** Minimal in-memory Storage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const ADMIN_A: JobScope = { address: "GADMINA", network: "stellar:testnet" };
const ADMIN_B: JobScope = { address: "GADMINB", network: "stellar:testnet" };
const ADMIN_A_PUBNET: JobScope = { address: "GADMINA", network: "stellar:pubnet" };

describe("job store", () => {
  it("stores jobs per address and network", () => {
    const storage = memoryStorage();
    upsertJob(storage, ADMIN_A, { jobId: "job-a" });
    upsertJob(storage, ADMIN_B, { jobId: "job-b" });
    upsertJob(storage, ADMIN_A_PUBNET, { jobId: "job-a-pubnet" });

    expect(readJobs(storage, ADMIN_A).map((j) => j.jobId)).toEqual(["job-a"]);
    expect(readJobs(storage, ADMIN_B).map((j) => j.jobId)).toEqual(["job-b"]);
    expect(readJobs(storage, ADMIN_A_PUBNET).map((j) => j.jobId)).toEqual(["job-a-pubnet"]);
    expect(jobsKey(ADMIN_A)).toBe("oracledesk_admin_jobs:stellar:testnet:GADMINA");
  });

  it("keeps the newest first and caps the list at 50", () => {
    const storage = memoryStorage();
    for (let i = 0; i < MAX_STORED_JOBS + 5; i++) upsertJob(storage, ADMIN_A, { jobId: `job-${i}` });

    const jobs = readJobs(storage, ADMIN_A);
    expect(jobs).toHaveLength(MAX_STORED_JOBS);
    expect(jobs[0].jobId).toBe(`job-${MAX_STORED_JOBS + 4}`);
    expect(jobs.some((j) => j.jobId === "job-0")).toBe(false);
  });

  it("survives malformed JSON and drops malformed entries", () => {
    const storage = memoryStorage();
    storage.setItem(jobsKey(ADMIN_A), "{not json");
    expect(readJobs(storage, ADMIN_A)).toEqual([]);

    storage.setItem(
      jobsKey(ADMIN_A),
      JSON.stringify([{ jobId: "ok", startedAt: "2026-10-19T10:00:00Z", lastStatus: "RUNNING", lastSeenAt: 1 }, { jobId: 3 }, null, "x"]),
    );
    expect(readJobs(storage, ADMIN_A).map((j) => j.jobId)).toEqual(["ok"]);
  });

  it("updates an existing job in place without duplicating it", () => {
    const storage = memoryStorage();
    upsertJob(storage, ADMIN_A, { jobId: "first" });
    upsertJob(storage, ADMIN_A, { jobId: "second" });
    upsertJob(storage, ADMIN_A, { jobId: "first", lastStatus: "COMPLETED", marketId: "m1", onChainMarketId: "12" });

    const jobs = readJobs(storage, ADMIN_A);
    expect(jobs.map((j) => j.jobId)).toEqual(["second", "first"]);
    expect(jobs[1]).toMatchObject({ lastStatus: "COMPLETED", marketId: "m1", onChainMarketId: "12" });
  });

  it("removes a dismissed job", () => {
    const storage = memoryStorage();
    upsertJob(storage, ADMIN_A, { jobId: "keep" });
    upsertJob(storage, ADMIN_A, { jobId: "drop" });
    removeJob(storage, ADMIN_A, "drop");
    expect(readJobs(storage, ADMIN_A).map((j) => j.jobId)).toEqual(["keep"]);
  });

  it("treats blocked storage as empty and never throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    expect(readJobs(blocked, ADMIN_A)).toEqual([]);
    expect(() => upsertJob(blocked, ADMIN_A, { jobId: "x" })).not.toThrow();
    expect(readJobs(null, ADMIN_A)).toEqual([]);
  });

  it("counts runs started within the last hour", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const jobs = [
      { jobId: "a", startedAt: "2026-10-19T11:30:00Z", lastStatus: "RUNNING" as const, lastSeenAt: now },
      { jobId: "b", startedAt: "2026-10-19T11:00:01Z", lastStatus: "COMPLETED" as const, lastSeenAt: now },
      { jobId: "c", startedAt: "2026-10-19T10:59:59Z", lastStatus: "FAILED" as const, lastSeenAt: now },
    ];
    expect(runsInLastHour(jobs, now)).toBe(2);
  });
});
