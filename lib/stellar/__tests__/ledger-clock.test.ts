// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LedgerClock } from "../ledger-clock";

describe("LedgerClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("estimates from monotonic elapsed time, not wall-clock time", async () => {
    let monotonic = 10;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    const clock = new LedgerClock(async () => ({ sequence: 1, closeTime: 100 }));
    const stop = clock.subscribe(() => undefined);
    await Promise.resolve();
    expect(clock.now()).toBe(100);
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    monotonic += 2_500;
    expect(clock.now()).toBe(102.5);
    stop();
  });

  it("returns null before a sample and ignores backwards samples", async () => {
    let sample = { sequence: 10, closeTime: 100 };
    const clock = new LedgerClock(async () => sample);
    expect(clock.now()).toBeNull();
    const stop = clock.subscribe(() => undefined);
    await Promise.resolve();
    expect(clock.now()).toBe(100);
    sample = { sequence: 9, closeTime: 99 };
    await clock.sample();
    expect(clock.now()).toBe(100);
    stop();
  });

  it("pauses polling on visibility hide and resumes on visibility show", async () => {
    let callCount = 0;
    const fetchLatest = vi.fn(async () => {
      callCount++;
      return { sequence: 100 + callCount, closeTime: 1000 + callCount * 5 };
    });

    const clock = new LedgerClock(fetchLatest, { pollMs: 5_000 });
    const stop = clock.subscribe(() => undefined);
    await Promise.resolve();
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    // Advance 5s in visible state
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);

    // Simulate tab hiding
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance 30s while hidden -> no new calls should happen
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);

    // Simulate tab becoming visible again
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(fetchLatest).toHaveBeenCalledTimes(3);
    stop();
  });

  it("backs off on consecutive RPC failures and resets on recovery", async () => {
    let succeed = false;
    let attempts = 0;
    const fetchLatest = vi.fn(async () => {
      attempts++;
      if (!succeed) {
        throw new Error("RPC error");
      }
      return { sequence: 500, closeTime: 5000 };
    });

    const clock = new LedgerClock(fetchLatest, { pollMs: 5_000 });
    const stop = clock.subscribe(() => undefined);
    await Promise.resolve();
    // First attempt failed
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    // Exponential backoff attempt 1: ~5s-6s
    await vi.advanceTimersByTimeAsync(6_500);
    expect(fetchLatest).toHaveBeenCalledTimes(2);

    // Attempt 2 backoff: ~10s-11s
    await vi.advanceTimersByTimeAsync(11_500);
    expect(fetchLatest).toHaveBeenCalledTimes(3);

    // Now allow RPC to succeed
    succeed = true;
    await vi.advanceTimersByTimeAsync(22_000);
    expect(fetchLatest).toHaveBeenCalledTimes(4);
    expect(clock.getLatest()?.sequence).toBe(500);

    // On recovery, timer should reset to normal 5s interval
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchLatest).toHaveBeenCalledTimes(5);

    stop();
  });

  it("estimateNow extrapolates ledger and timestamp correctly", async () => {
    let monotonic = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);

    const clock = new LedgerClock(async () => ({ sequence: 1000, closeTime: 5000 }), {
      avgCloseSeconds: 5,
    });

    expect(clock.estimateNow().ledger).toBe(0);

    const stop = clock.subscribe(() => undefined);
    await Promise.resolve();

    const initial = clock.estimateNow();
    expect(initial.ledger).toBe(1000);
    expect(initial.time).toBe(5000);

    // Advance performance.now by 11 seconds (2 ledgers of 5s)
    monotonic += 11_000;
    const after = clock.estimateNow();
    expect(after.ledger).toBe(1002);
    // Capped growth at 2 * avgCloseSeconds = 10s
    expect(after.time).toBe(5010);

    stop();
  });
});
