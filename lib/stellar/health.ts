import { rpc } from "@stellar/stellar-sdk";
import { RPC_URL } from "./config";
import { API_URL } from "@/lib/api/client";

/**
 * Honest liveness probes for the three data paths the app depends on: the
 * backend REST API, the Stellar RPC, and (reported by the realtime provider)
 * the socket. These never assume data is fresh; they only report what a probe
 * just observed so the UI can stop pretending a decorative dot means "live".
 */

export type RpcStatus = "ok" | "degraded" | "down";
export type BackendStatus = "ok" | "down";

export interface RpcHealth {
  status: RpcStatus;
  latestLedger: number | null;
  /** Seconds since the ledger last advanced, per consecutive probes. Null if unknown. */
  ledgerAgeSec: number | null;
  checkedAt: number;
}

export interface BackendHealth {
  status: BackendStatus;
  checkedAt: number;
}

/** A ledger that has not advanced for this long is reported as degraded. */
export const RPC_LEDGER_STALL_SEC = 30;
/** `/health` is served outside `/api/v1`; give a cold Render instance time. */
export const BACKEND_TIMEOUT_MS = 8_000;

/** Derives the backend health URL from the API base, which ends in `/api/v1`. */
export function backendHealthUrl(apiUrl: string = API_URL): string {
  return `${apiUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "")}/health`;
}

/**
 * Age of the current ledger, in seconds, from two consecutive probes. A
 * ledger that advanced resets the age to zero; a stuck ledger accrues wall
 * time since the previous probe. Wall-clock only, never ledger timestamps.
 */
export function ledgerAge(
  ledger: number | null,
  previous: { latestLedger: number | null; checkedAt: number } | null,
  now: number,
): number | null {
  if (ledger === null) return null;
  if (!previous || previous.latestLedger === null) return 0;
  if (ledger > previous.latestLedger) return 0;
  return Math.max(0, Math.round((now - previous.checkedAt) / 1000));
}

/** True when a value read at `readAt` (ms) is older than `staleAfterSec`. */
export function isStale(readAt: number | null | undefined, now: number, staleAfterSec = 60): boolean {
  if (readAt === null || readAt === undefined) return false;
  return now - readAt > staleAfterSec * 1000;
}

/** Exponential backoff, capped: base, 2×base, 4×base, … Max after `max`. */
export function nextBackoff(failures: number, baseMs: number, maxMs: number): number {
  if (failures <= 0) return baseMs;
  const raw = baseMs * 2 ** Math.min(failures, 16);
  return Math.min(maxMs, raw);
}

export async function probeRpc(
  server: rpc.Server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") }),
  previous: { latestLedger: number | null; checkedAt: number } | null = null,
  now: number = Date.now(),
): Promise<RpcHealth> {
  try {
    await server.getHealth();
  } catch {
    return { status: "down", latestLedger: null, ledgerAgeSec: null, checkedAt: now };
  }
  try {
    const latest = await server.getLatestLedger();
    const latestLedger = typeof latest.sequence === "number" ? latest.sequence : null;
    const age = ledgerAge(latestLedger, previous, now);
    const status: RpcStatus = age !== null && age > RPC_LEDGER_STALL_SEC ? "degraded" : "ok";
    return { status, latestLedger, ledgerAgeSec: age, checkedAt: now };
  } catch {
    // getHealth answered but the ledger read failed: reachable but unusable.
    return { status: "degraded", latestLedger: null, ledgerAgeSec: null, checkedAt: now };
  }
}

export async function probeBackend(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
  url: string = backendHealthUrl(),
): Promise<BackendHealth> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) });
    if (!res.ok) return { status: "down", checkedAt: now };
    const envelope = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: { status?: string } }
      | null;
    const healthy = envelope?.ok === true && envelope.data?.status === "healthy";
    return { status: healthy ? "ok" : "down", checkedAt: now };
  } catch {
    return { status: "down", checkedAt: now };
  }
}

export interface HealthSample {
  rpc: RpcHealth;
  backend: BackendHealth;
}

export interface HealthMonitorOptions {
  baseIntervalMs?: number;
  maxIntervalMs?: number;
  probeRpc?: (previous: RpcHealth | null) => Promise<RpcHealth>;
  probeBackend?: () => Promise<BackendHealth>;
  isHidden?: () => boolean;
}

/**
 * Runs the two probes on their own schedules with per-probe exponential
 * backoff on failure and an immediate probe when the tab becomes visible or
 * comes back online. Pauses entirely while the document is hidden so an idle
 * tab costs nothing.
 */
export function createHealthMonitor(options: HealthMonitorOptions = {}) {
  const baseIntervalMs = options.baseIntervalMs ?? 15_000;
  const maxIntervalMs = options.maxIntervalMs ?? 120_000;
  const runRpc = options.probeRpc ?? ((previous: RpcHealth | null) => probeRpc(undefined, previous));
  const runBackend = options.probeBackend ?? (() => probeBackend());
  const hidden = options.isHidden ?? (() => typeof document !== "undefined" && document.hidden);

  const listeners = new Set<(sample: HealthSample) => void>();
  let sample: HealthSample = {
    rpc: { status: "down", latestLedger: null, ledgerAgeSec: null, checkedAt: 0 },
    backend: { status: "down", checkedAt: 0 },
  };
  let rpcTimer: ReturnType<typeof setTimeout> | null = null;
  let backendTimer: ReturnType<typeof setTimeout> | null = null;
  let rpcFailures = 0;
  let backendFailures = 0;
  let running = false;

  const emit = () => {
    for (const listener of listeners) listener(sample);
  };

  const scheduleRpc = (delay: number) => {
    if (!running) return;
    clearTimeout(rpcTimer ?? undefined);
    rpcTimer = setTimeout(tickRpc, delay);
  };
  const scheduleBackend = (delay: number) => {
    if (!running) return;
    clearTimeout(backendTimer ?? undefined);
    backendTimer = setTimeout(tickBackend, delay);
  };

  const tickRpc = async () => {
    if (!running) return;
    if (hidden()) return scheduleRpc(baseIntervalMs);
    const next = await runRpc(sample.rpc.latestLedger === null && sample.rpc.checkedAt === 0 ? null : sample.rpc);
    sample = { ...sample, rpc: next };
    rpcFailures = next.status === "down" ? rpcFailures + 1 : 0;
    emit();
    scheduleRpc(nextBackoff(rpcFailures, baseIntervalMs, maxIntervalMs));
  };

  const tickBackend = async () => {
    if (!running) return;
    if (hidden()) return scheduleBackend(baseIntervalMs);
    const next = await runBackend();
    sample = { ...sample, backend: next };
    backendFailures = next.status === "down" ? backendFailures + 1 : 0;
    emit();
    scheduleBackend(nextBackoff(backendFailures, baseIntervalMs, maxIntervalMs));
  };

  const onVisible = () => {
    if (!hidden()) {
      scheduleRpc(0);
      scheduleBackend(0);
    }
  };

  return {
    subscribe(listener: (sample: HealthSample) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return sample;
    },
    start() {
      if (running) return;
      running = true;
      scheduleRpc(0);
      scheduleBackend(0);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      if (typeof window !== "undefined") window.addEventListener("online", onVisible);
    },
    stop() {
      running = false;
      clearTimeout(rpcTimer ?? undefined);
      clearTimeout(backendTimer ?? undefined);
      rpcTimer = null;
      backendTimer = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      if (typeof window !== "undefined") window.removeEventListener("online", onVisible);
    },
    refresh() {
      scheduleRpc(0);
      scheduleBackend(0);
    },
  };
}
