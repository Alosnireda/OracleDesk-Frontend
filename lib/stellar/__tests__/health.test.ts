import { afterEach, describe, expect, it, vi } from "vitest";
import type { rpc } from "@stellar/stellar-sdk";
import {
  backendHealthUrl,
  createHealthMonitor,
  isStale,
  ledgerAge,
  nextBackoff,
  probeBackend,
  probeRpc,
  type RpcHealth,
} from "../health";

const down: RpcHealth = { status: "down", latestLedger: null, ledgerAgeSec: null, checkedAt: 0 };

describe("ledgerAge", () => {
  it("is zero when the ledger advanced", () => {
    expect(ledgerAge(105, { latestLedger: 100, checkedAt: 1_000 }, 6_000)).toBe(0);
  });
  it("accrues wall time while the ledger is stuck", () => {
    expect(ledgerAge(100, { latestLedger: 100, checkedAt: 1_000 }, 31_000)).toBe(30);
  });
  it("is null without a ledger", () => {
    expect(ledgerAge(null, null, 1_000)).toBeNull();
  });
});

describe("isStale", () => {
  it("is false before the threshold and true after", () => {
    expect(isStale(0, 59_000, 60)).toBe(false);
    expect(isStale(0, 61_000, 60)).toBe(true);
  });
  it("is false when readAt is missing", () => {
    expect(isStale(undefined, 10_000)).toBe(false);
    expect(isStale(null, 10_000)).toBe(false);
  });
});

describe("nextBackoff", () => {
  it("doubles per failure and caps", () => {
    expect(nextBackoff(0, 15_000, 120_000)).toBe(15_000);
    expect(nextBackoff(1, 15_000, 120_000)).toBe(30_000);
    expect(nextBackoff(2, 15_000, 120_000)).toBe(60_000);
    expect(nextBackoff(3, 15_000, 120_000)).toBe(120_000);
    expect(nextBackoff(10, 15_000, 120_000)).toBe(120_000);
  });
});

describe("backendHealthUrl", () => {
  it("strips the /api/v1 suffix", () => {
    expect(backendHealthUrl("https://api.example.com/api/v1")).toBe("https://api.example.com/health");
  });
  it("handles a trailing slash and a custom base", () => {
    expect(backendHealthUrl("https://api.example.com/api/v1/")).toBe("https://api.example.com/health");
    expect(backendHealthUrl("https://api.example.com")).toBe("https://api.example.com/health");
  });
});

describe("probeRpc", () => {
  const server = (over: {
    health?: () => Promise<unknown>;
    latest?: () => Promise<unknown>;
  }) =>
    ({
      getHealth: over.health ?? (async () => ({})),
      getLatestLedger: over.latest ?? (async () => ({ sequence: 5 })),
    }) as unknown as rpc.Server;

  it("reports ok when the ledger advances", async () => {
    const result = await probeRpc(server({ latest: async () => ({ sequence: 101 }) }), { latestLedger: 100, checkedAt: 0 }, 5_000);
    expect(result).toMatchObject({ status: "ok", latestLedger: 101, ledgerAgeSec: 0 });
  });
  it("reports degraded when the ledger is stuck past the threshold", async () => {
    const result = await probeRpc(server({ latest: async () => ({ sequence: 100 }) }), { latestLedger: 100, checkedAt: 0 }, 31_000);
    expect(result.status).toBe("degraded");
    expect(result.ledgerAgeSec).toBe(31);
  });
  it("reports down when getHealth fails", async () => {
    const result = await probeRpc(server({ health: async () => { throw new Error("boom"); } }));
    expect(result.status).toBe("down");
  });
  it("reports degraded when only the ledger read fails", async () => {
    const result = await probeRpc(server({ latest: async () => { throw new Error("boom"); } }));
    expect(result.status).toBe("degraded");
  });
});

describe("probeBackend", () => {
  const fetchReturning = (value: unknown): typeof fetch =>
    (async () => value) as unknown as typeof fetch;

  it("parses the /health envelope", async () => {
    const fetchImpl = fetchReturning({ ok: true, json: async () => ({ ok: true, data: { status: "healthy" } }) });
    expect((await probeBackend(fetchImpl, 1, "http://x/health")).status).toBe("ok");
  });
  it("is down on a non-ok response", async () => {
    const fetchImpl = fetchReturning({ ok: false, json: async () => ({}) });
    expect((await probeBackend(fetchImpl, 1, "http://x/health")).status).toBe("down");
  });
  it("is down on an unhealthy envelope", async () => {
    const fetchImpl = fetchReturning({ ok: true, json: async () => ({ ok: true, data: { status: "degraded" } }) });
    expect((await probeBackend(fetchImpl, 1, "http://x/health")).status).toBe("down");
  });
  it("is down when the fetch throws", async () => {
    const fetchImpl = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect((await probeBackend(fetchImpl, 1, "http://x/health")).status).toBe("down");
  });
});

describe("createHealthMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backs off exponentially after failures", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const monitor = createHealthMonitor({
      baseIntervalMs: 1_000,
      maxIntervalMs: 4_000,
      isHidden: () => false,
      probeRpc: async () => {
        calls += 1;
        return down;
      },
      probeBackend: async () => ({ status: "ok", checkedAt: 0 }),
    });
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    // First failure → next delay = base × 2 = 2000, not the base interval.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    // Second failure → next delay = base × 4 = 4000.
    await vi.advanceTimersByTimeAsync(3_999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    monitor.stop();
  });

  it("does not probe while the tab is hidden, and resumes on refresh", async () => {
    vi.useFakeTimers();
    let hidden = true;
    let rpcCalls = 0;
    const monitor = createHealthMonitor({
      baseIntervalMs: 1_000,
      isHidden: () => hidden,
      probeRpc: async () => {
        rpcCalls += 1;
        return down;
      },
      probeBackend: async () => ({ status: "ok", checkedAt: Date.now() }),
    });
    monitor.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rpcCalls).toBe(0);
    hidden = false;
    monitor.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcCalls).toBe(1);
    monitor.stop();
  });
});
