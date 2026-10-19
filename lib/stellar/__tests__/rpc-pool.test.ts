import { afterEach, describe, expect, it, vi } from "vitest";
import { nextSelection, percentile, RpcPool, scoreEndpoint, type EndpointStats } from "../rpc-pool";

const PASS = "Test SDF Network ; September 2015";

type Behaviour = { passphrase?: string; ledger?: number; status?: number; retryAfter?: string; fail?: boolean };

function fakeFetch(behaviour: Record<string, Behaviour>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const b = behaviour[String(url)] ?? {};
    if (b.fail) throw new TypeError("Failed to fetch");
    if (b.status) {
      return { ok: false, status: b.status, headers: new Headers(b.retryAfter ? { "Retry-After": b.retryAfter } : {}), json: async () => ({}) } as Response;
    }
    const method = JSON.parse(String(init?.body)).method as string;
    const result = method === "getNetwork" ? { passphrase: b.passphrase ?? PASS } : { sequence: b.ledger ?? 100 };
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ jsonrpc: "2.0", id: 1, result }) } as Response;
  }) as unknown as typeof fetch;
}

const stat = (url: string, over: Partial<EndpointStats> = {}): EndpointStats => ({
  url, state: "healthy", p50Ms: 100, p95Ms: 200, errorRate: 0, rateLimited: 0, latestLedger: 100, lagLedgers: 0, lastCheckedAt: 0, ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("RpcPool", () => {
  it("single endpoint is always current", async () => {
    const pool = new RpcPool(["https://a"], { passphrase: PASS, fetchImpl: fakeFetch({ "https://a": { fail: true } }) });
    await pool.verifyAll();
    await pool.probe();
    expect(pool.current()).toBe("https://a");
  });

  it("never selects an endpoint on the wrong network", async () => {
    const pool = new RpcPool(["https://a", "https://b"], {
      passphrase: PASS,
      fetchImpl: fakeFetch({ "https://a": { passphrase: "Public Global Stellar Network ; September 2015" }, "https://b": {} }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await pool.verifyAll();
    await pool.probe();
    expect(pool.stats()[0].state).toBe("wrong-network");
    expect(pool.current()).toBe("https://b");
  });

  it("switches when the current endpoint goes down", async () => {
    const behaviour: Record<string, Behaviour> = { "https://a": {}, "https://b": {} };
    const pool = new RpcPool(["https://a", "https://b"], { passphrase: PASS, fetchImpl: fakeFetch(behaviour) });
    await pool.verifyAll();
    await pool.probe();
    expect(pool.current()).toBe("https://a");
    behaviour["https://a"] = { fail: true };
    await pool.probe();
    expect(pool.current()).toBe("https://b");
  });

  it("penalises a lagging endpoint", () => {
    expect(scoreEndpoint(stat("a", { lagLedgers: 10 }))).toBeGreaterThan(scoreEndpoint(stat("b", { lagLedgers: 0 })));
  });

  it("429 triggers back-off honouring Retry-After", async () => {
    let now = 0;
    const behaviour: Record<string, Behaviour> = { "https://a": {}, "https://b": {} };
    const fetchImpl = fakeFetch(behaviour);
    const pool = new RpcPool(["https://a", "https://b"], { passphrase: PASS, fetchImpl, now: () => now });
    await pool.verifyAll();
    behaviour["https://a"] = { status: 429, retryAfter: "60" };
    await pool.probe();
    expect(pool.stats()[0]).toMatchObject({ state: "degraded", rateLimited: 1 });
    expect(pool.current()).toBe("https://b");
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    now = 30_000;
    await pool.probe();
    // a is still backing off: only b is probed.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls + 1);
  });

  it("pin returns the same url for the whole lease even if selection changes", async () => {
    const behaviour: Record<string, Behaviour> = { "https://a": {}, "https://b": {} };
    const pool = new RpcPool(["https://a", "https://b"], { passphrase: PASS, fetchImpl: fakeFetch(behaviour) });
    await pool.verifyAll();
    const lease = pool.pin();
    behaviour["https://a"] = { fail: true };
    await pool.probe();
    expect(lease.url).toBe("https://a");
    expect(pool.current()).toBe("https://a");
    lease.release();
    expect(pool.current()).toBe("https://b");
  });

  it("pauses probes while the tab is hidden", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const fetchImpl = fakeFetch({});
    const pool = new RpcPool(["https://a", "https://b"], { passphrase: PASS, fetchImpl, probeIntervalMs: 1000 });
    pool.start();
    await vi.runOnlyPendingTimersAsync();
    const after = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(after);
    pool.stop();
    vi.useRealTimers();
  });

  it("computes p50/p95 from the ring buffer", () => {
    const pool = new RpcPool(["https://a"], { passphrase: PASS, fetchImpl: fakeFetch({}) });
    for (let i = 1; i <= 100; i++) pool.record("https://a", { ms: i, ok: true });
    // Only the last 50 samples (51..100) count.
    expect(pool.stats()[0].p50Ms).toBe(75);
    expect(pool.stats()[0].p95Ms).toBe(98);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("nextSelection", () => {
  it("hysteresis prevents flapping between similar endpoints", () => {
    const sel = { current: "a", challenger: null, streak: 0 };
    const stats = [stat("a", { p95Ms: 200 }), stat("b", { p95Ms: 180 })];
    expect(nextSelection(sel, stats).current).toBe("a");
  });

  it("needs two consecutive wins of 30% to switch", () => {
    const stats = [stat("a", { p95Ms: 1000 }), stat("b", { p95Ms: 100 })];
    const first = nextSelection({ current: "a", challenger: null, streak: 0 }, stats);
    expect(first).toMatchObject({ current: "a", challenger: "b", streak: 1 });
    expect(nextSelection(first, stats).current).toBe("b");
  });
});
