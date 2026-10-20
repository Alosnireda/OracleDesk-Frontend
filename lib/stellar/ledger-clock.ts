import { useSyncExternalStore } from "react";
import { rpcServer } from "./clients";

export interface LedgerInfo {
  sequence: number;
  closeTime: number;
  observedAt: number;
}
export type LedgerSample = LedgerInfo;

interface LedgerPoint {
  sequence: number;
  closeTime: number;
}

export async function fetchLatestLedger(): Promise<LedgerPoint> {
  const latest = await rpcServer().getLatestLedger();
  const closeTime = Number(latest.closeTime);
  if (!Number.isSafeInteger(latest.sequence) || !Number.isFinite(closeTime) || closeTime < 0) {
    throw new Error("The Stellar RPC returned an invalid ledger clock sample.");
  }
  return { sequence: latest.sequence, closeTime };
}

export class LedgerClock {
  private samples: LedgerInfo[] = [];
  private listeners = new Set<(ledger?: LedgerInfo) => void>();
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private versionValue = 0;

  constructor(
    private readonly fetchLatest: () => Promise<LedgerPoint>,
    private readonly opts: { pollMs?: number; avgCloseSeconds?: number } = {},
  ) {}

  get version() {
    return this.versionValue;
  }

  getLatest(): LedgerInfo | null {
    return this.samples.at(-1) ?? null;
  }

  estimateNow(): { ledger: number; time: number } {
    const latest = this.getLatest();
    if (!latest) {
      return {
        ledger: 0,
        time: Math.floor(Date.now() / 1000),
      };
    }
    const elapsed = Math.max(0, (performance.now() - latest.observedAt) / 1000);
    const avgClose = this.averageCloseSeconds();
    const extrapolatedLedgers = Math.floor(elapsed / avgClose);
    const growthCap = avgClose * 2;
    const timeOffset = Math.min(elapsed, growthCap);
    return {
      ledger: latest.sequence + extrapolatedLedgers,
      time: Math.floor(latest.closeTime + timeOffset),
    };
  }

  now(): number | null {
    const sample = this.samples.at(-1);
    if (!sample) return null;
    const elapsed = (performance.now() - sample.observedAt) / 1000;
    if (elapsed < 0.01) return sample.closeTime;
    if (elapsed > (this.opts.pollMs ?? 5_000) * 10 / 1000) return null;
    const growthCap = this.averageCloseSeconds() * 2;
    return sample.closeTime + Math.min(Math.max(0, elapsed), growthCap);
  }

  uncertainty(): number {
    return this.samples.length < 2 ? this.averageCloseSeconds() : this.averageCloseSeconds() / 2;
  }

  subscribe = (listener: (ledger?: LedgerInfo) => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  start(): void {
    if (this.pollTimeout || this.tickTimer) return;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.tickTimer = setInterval(() => this.notify(), 1_000);
    void this.sampleAndReschedule();
  }

  stop(): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  private onVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") {
      this.samples = [];
      this.notify();
      if (this.pollTimeout) {
        clearTimeout(this.pollTimeout);
        this.pollTimeout = null;
      }
      void this.sampleAndReschedule();
    } else {
      // Pause immediately when tab becomes hidden
      if (this.pollTimeout) {
        clearTimeout(this.pollTimeout);
        this.pollTimeout = null;
      }
    }
  };

  private async sampleAndReschedule(): Promise<void> {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    try {
      await this.sample();
      this.consecutiveErrors = 0;
      this.scheduleNext(this.opts.pollMs ?? 5_000);
    } catch {
      this.consecutiveErrors++;
      const base = Math.min(60_000, 5_000 * Math.pow(2, this.consecutiveErrors - 1));
      const jitter = Math.random() * 1_000;
      const delay = Math.min(60_000, Math.floor(base + jitter));
      this.scheduleNext(delay);
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.pollTimeout = null;
      return;
    }
    this.pollTimeout = setTimeout(() => {
      void this.sampleAndReschedule();
    }, delayMs);
  }

  public async sample(): Promise<void> {
    const next = await this.fetchLatest();
    const previous = this.samples.at(-1);
    // Monotonicity checks: sequence must not regress, closeTime must not regress
    if (previous && (next.sequence < previous.sequence || next.closeTime < previous.closeTime)) {
      return;
    }
    if (previous && next.sequence === previous.sequence) {
      return;
    }
    const info: LedgerInfo = { ...next, observedAt: performance.now() };
    this.samples.push(info);
    this.samples = this.samples.slice(-10);
    this.notify(info);
  }

  private averageCloseSeconds(): number {
    if (this.samples.length < 2) return this.opts.avgCloseSeconds ?? 5.5;
    let elapsed = 0;
    let ledgers = 0;
    for (let i = 1; i < this.samples.length; i++) {
      const before = this.samples[i - 1];
      const after = this.samples[i];
      elapsed += after.closeTime - before.closeTime;
      ledgers += after.sequence - before.sequence;
    }
    return ledgers > 0 ? elapsed / ledgers : this.opts.avgCloseSeconds ?? 5.5;
  }

  private notify(info?: LedgerInfo): void {
    this.versionValue++;
    this.listeners.forEach((listener) => {
      try {
        listener(info);
      } catch {
        // Safe listener dispatch
      }
    });
  }
}

export const ledgerClock = new LedgerClock(fetchLatestLedger, { pollMs: 5_000 });

export function useLedgerClock(): LedgerInfo | null {
  return useSyncExternalStore(
    ledgerClock.subscribe,
    () => ledgerClock.getLatest(),
    () => null,
  );
}

export function useLedgerNow(): { now: number | null; uncertainty: number } {
  useSyncExternalStore(ledgerClock.subscribe, () => ledgerClock.version, () => 0);
  return { now: ledgerClock.now(), uncertainty: ledgerClock.uncertainty() };
}

export const getLedgerNow = () => ledgerClock.now();
