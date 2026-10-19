/**
 * Soroban RPC endpoint pool: verifies each endpoint's network passphrase,
 * probes latency and ledger lag, and routes reads to the healthiest endpoint
 * with sticky selection and hysteresis. Write flows take a lease (pin()) so
 * build → simulate → sign → submit → poll all hit one endpoint.
 *
 * The scoring and selection rules are pure functions (scoreEndpoint,
 * nextSelection) so they can be unit-tested without timers.
 */

export type EndpointState = "unverified" | "healthy" | "degraded" | "down" | "wrong-network";

export interface EndpointStats {
  url: string;
  state: EndpointState;
  p50Ms: number | null;
  p95Ms: number | null;
  errorRate: number;
  rateLimited: number;
  latestLedger: number | null;
  lagLedgers: number | null;
  lastError?: string;
  lastCheckedAt: number;
}

export interface Sample {
  ms: number;
  ok: boolean;
  status?: number;
  latestLedger?: number;
  /** Seconds from a Retry-After header, for 429s. */
  retryAfterS?: number;
}

export interface RpcLease {
  url: string;
  release(): void;
}

export interface RpcPoolOptions {
  passphrase: string;
  probeIntervalMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

const RING = 50;
const SWITCH_MARGIN = 0.3;
const SWITCH_STREAK = 2;
const DEFAULT_BACKOFF_MS = 30_000;
const DOWN_ERROR_RATE = 0.5;
const DEGRADED_ERROR_RATE = 0.2;

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Lower is better. Infinity for endpoints that must never be chosen. */
export function scoreEndpoint(s: Pick<EndpointStats, "state" | "p95Ms" | "errorRate" | "lagLedgers">): number {
  if (s.state === "wrong-network") return Infinity;
  const p95 = s.p95Ms ?? 1000;
  const lag = s.lagLedgers ?? 0;
  let score = p95 + 500 * s.errorRate * 10 + 1000 * Math.max(0, lag - 1);
  if (s.state === "down") score += 100_000;
  else if (s.state === "degraded") score += 10_000;
  else if (s.state === "unverified") score += 5_000;
  return score;
}

export interface Selection {
  current: string | null;
  /** Candidate that beat current on the last probe, and how many probes in a row. */
  challenger: string | null;
  streak: number;
}

/**
 * Hysteresis: stay on `current` unless another endpoint scores at least 30%
 * better on two consecutive evaluations, or current is down/degraded/wrong.
 */
export function nextSelection(prev: Selection, stats: readonly EndpointStats[]): Selection {
  const usable = stats.filter((s) => s.state !== "wrong-network");
  if (usable.length === 0) return { current: prev.current ?? stats[0]?.url ?? null, challenger: null, streak: 0 };
  const best = usable.reduce((a, b) => (scoreEndpoint(b) < scoreEndpoint(a) ? b : a));
  const cur = usable.find((s) => s.url === prev.current);
  if (!cur) return { current: best.url, challenger: null, streak: 0 };
  if (cur.state === "down" || cur.state === "degraded") {
    return scoreEndpoint(best) < scoreEndpoint(cur) ? { current: best.url, challenger: null, streak: 0 } : { ...prev, challenger: null, streak: 0 };
  }
  if (best.url === cur.url || scoreEndpoint(best) > scoreEndpoint(cur) * (1 - SWITCH_MARGIN)) {
    return { current: cur.url, challenger: null, streak: 0 };
  }
  const streak = prev.challenger === best.url ? prev.streak + 1 : 1;
  if (streak >= SWITCH_STREAK) return { current: best.url, challenger: null, streak: 0 };
  return { current: cur.url, challenger: best.url, streak };
}

interface Endpoint {
  url: string;
  verified: "pending" | "ok" | "failed" | "wrong";
  samples: Sample[];
  rateLimited: number;
  backoffUntil: number;
  latestLedger: number | null;
  lastError?: string;
  lastCheckedAt: number;
}

export class RpcPool {
  private readonly endpoints: Endpoint[];
  private readonly passphrase: string;
  private readonly probeIntervalMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private selection: Selection;
  private leases = new Map<number, string>();
  private nextLeaseId = 1;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshot: EndpointStats[] = [];
  private started = false;
  private warnedWrong = new Set<string>();

  constructor(urls: readonly string[], opts: RpcPoolOptions) {
    if (urls.length === 0) throw new Error("RpcPool needs at least one URL");
    this.endpoints = urls.map((url) => ({ url, verified: "pending", samples: [], rateLimited: 0, backoffUntil: 0, latestLedger: null, lastCheckedAt: 0 }));
    this.passphrase = opts.passphrase;
    this.probeIntervalMs = opts.probeIntervalMs ?? 15_000;
    this.now = opts.now ?? (() => Date.now());
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.selection = { current: urls[0], challenger: null, streak: 0 };
    this.refresh();
  }

  /** Sticky choice. While any write lease is held, the pinned endpoint. */
  current(): string {
    const pinned = this.pinnedUrl();
    if (pinned) return pinned;
    return this.selection.current ?? this.endpoints[0].url;
  }

  /** Holds one endpoint for a whole write flow. Selection may move on; the lease does not. */
  pin(): RpcLease {
    const url = this.current();
    const id = this.nextLeaseId++;
    this.leases.set(id, url);
    this.emit();
    let released = false;
    return {
      url,
      release: () => {
        if (released) return;
        released = true;
        this.leases.delete(id);
        this.emit();
      },
    };
  }

  pinnedUrl(): string | null {
    for (const url of this.leases.values()) return url;
    return null;
  }

  record(url: string, sample: Sample): void {
    const ep = this.endpoints.find((e) => e.url === url);
    if (!ep) return;
    this.recordQuiet(ep, sample);
    this.refresh();
  }

  stats(): EndpointStats[] {
    return this.snapshot;
  }

  /** True when no endpoint is healthy (for the "Stellar RPC is degraded" banner). */
  isDegraded(): boolean {
    // Nothing measured yet (first load): don't cry wolf.
    if (this.snapshot.every((s) => s.lastCheckedAt === 0)) return false;
    return this.snapshot.length > 0 && !this.snapshot.some((s) => s.state === "healthy" || (s.state === "unverified" && this.snapshot.length === 1));
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EndpointStats[] => this.snapshot;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.verifyAll().then(() => this.probe());
    this.timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.probe();
    }, this.probeIntervalMs);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Calls getNetwork on every endpoint; a mismatched passphrase is permanent. */
  async verifyAll(): Promise<void> {
    await Promise.all(
      this.endpoints.map(async (ep) => {
        try {
          const res = await this.rpc(ep.url, "getNetwork");
          const passphrase = (res.result as { passphrase?: string } | undefined)?.passphrase;
          if (passphrase === this.passphrase) ep.verified = "ok";
          else {
            ep.verified = "wrong";
            ep.lastError = `Network passphrase mismatch: ${passphrase ?? "none"}`;
            if (!this.warnedWrong.has(ep.url)) {
              this.warnedWrong.add(ep.url);
              console.warn(`[rpc-pool] ${ep.url} reports a different network; it will not be used.`);
            }
          }
        } catch (err) {
          // CORS or outage: unverified, used only if it is the sole endpoint.
          ep.verified = "failed";
          ep.lastError = err instanceof Error ? err.message : String(err);
        }
      }),
    );
    this.refresh();
  }

  /** One getLatestLedger per usable endpoint, then re-evaluate selection. */
  async probe(): Promise<void> {
    const now = this.now();
    await Promise.all(
      this.endpoints
        .filter((ep) => ep.verified !== "wrong" && ep.backoffUntil <= now)
        .map(async (ep) => {
          const t0 = this.now();
          try {
            const res = await this.rpc(ep.url, "getLatestLedger");
            const seq = (res.result as { sequence?: number } | undefined)?.sequence;
            if (ep.verified === "failed") ep.verified = "ok";
            this.recordQuiet(ep, { ms: this.now() - t0, ok: true, latestLedger: typeof seq === "number" ? seq : undefined });
          } catch (err) {
            ep.lastError = err instanceof Error ? err.message : String(err);
            const status = (err as { status?: number }).status;
            const retryAfterS = (err as { retryAfterS?: number }).retryAfterS;
            this.recordQuiet(ep, { ms: this.now() - t0, ok: false, status, retryAfterS });
          }
        }),
    );
    this.refresh(true);
  }

  private recordQuiet(ep: Endpoint, sample: Sample) {
    ep.samples.push(sample);
    if (ep.samples.length > RING) ep.samples.splice(0, ep.samples.length - RING);
    ep.lastCheckedAt = this.now();
    if (sample.status === 429) {
      ep.rateLimited++;
      ep.backoffUntil = this.now() + (sample.retryAfterS !== undefined ? sample.retryAfterS * 1000 : DEFAULT_BACKOFF_MS);
    }
    if (sample.ok && sample.latestLedger !== undefined && (ep.latestLedger === null || sample.latestLedger > ep.latestLedger)) {
      ep.latestLedger = sample.latestLedger;
    }
  }

  private async rpc(url: string, method: string): Promise<{ result?: unknown }> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
    });
    if (!res.ok) {
      const retry = Number(res.headers?.get?.("Retry-After"));
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, retryAfterS: Number.isFinite(retry) && retry >= 0 ? retry : undefined });
    }
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? "RPC error");
    return body;
  }

  private stateOf(ep: Endpoint, errorRate: number, lag: number | null): EndpointState {
    if (ep.verified === "wrong") return "wrong-network";
    if (ep.backoffUntil > this.now()) return "degraded";
    if (ep.samples.length > 0 && errorRate >= DOWN_ERROR_RATE) return "down";
    if (ep.verified !== "ok") return "unverified";
    if (errorRate >= DEGRADED_ERROR_RATE || (lag !== null && lag > 5)) return "degraded";
    return "healthy";
  }

  private refresh(reselect = false): void {
    const maxLedger = this.endpoints.reduce<number | null>((m, e) => (e.latestLedger !== null && (m === null || e.latestLedger > m) ? e.latestLedger : m), null);
    this.snapshot = this.endpoints.map((ep) => {
      const latencies = ep.samples.filter((s) => s.ok).map((s) => s.ms);
      const errorRate = ep.samples.length ? ep.samples.filter((s) => !s.ok).length / ep.samples.length : 0;
      const lag = maxLedger !== null && ep.latestLedger !== null ? maxLedger - ep.latestLedger : null;
      return {
        url: ep.url,
        state: this.stateOf(ep, errorRate, lag),
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        errorRate,
        rateLimited: ep.rateLimited,
        latestLedger: ep.latestLedger,
        lagLedgers: lag,
        lastError: ep.lastError,
        lastCheckedAt: ep.lastCheckedAt,
      };
    });
    // Single-endpoint configs behave exactly as before: always that URL.
    if (this.endpoints.length > 1) {
      if (reselect) this.selection = nextSelection(this.selection, this.snapshot);
      else {
        const cur = this.snapshot.find((s) => s.url === this.selection.current);
        if (!cur || cur.state === "down" || cur.state === "wrong-network" || cur.state === "degraded") {
          this.selection = nextSelection(this.selection, this.snapshot);
        }
      }
    }
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

let _pool: RpcPool | null = null;

/** Browser singleton, created lazily. Returns null on the server (prerender, tests without a window). */
export function getRpcPool(urls: readonly string[], passphrase: string): RpcPool | null {
  if (typeof window === "undefined") return null;
  if (!_pool) {
    _pool = new RpcPool(urls, { passphrase });
    if (urls.length > 1) _pool.start();
  }
  return _pool;
}
