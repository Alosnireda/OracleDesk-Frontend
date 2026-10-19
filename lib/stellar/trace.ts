import { IPFS_GATEWAYS, IPFS_MAX_TRACE_BYTES } from "./config";
import type { TraceWorkerRequest, TraceWorkerResponse, WorkerCheck } from "./trace.worker";
import { gatewayUrl, normalizeHash, raceGateways, type RaceOptions, type RaceProgress, type TraceCheck } from "./trace-core";

/**
 * Browser port of x402/trace-verification.ts from the contracts repo:
 * hash the exact bytes received and compare with the on-chain trace_hash.
 * Content is only returned when the hash matches.
 */

export { normalizeHash, type GatewayAttempt, type TraceCheck } from "./trace-core";
export { cidDigestCheck, parseCid, type CidCheck } from "./cid";

export async function sha256Hex(content: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", content as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyTraceHash(content: Uint8Array, expectedHash: string): Promise<boolean> {
  const normalized = normalizeHash(expectedHash);
  return /^[0-9a-f]{64}$/.test(normalized) && (await sha256Hex(content)) === normalized;
}

/** Gateway URL for a CID; accepts bare CIDs and ipfs:// URIs. */
export function ipfsUrl(cid: string, gateway: string = IPFS_GATEWAYS[0]): string {
  return gatewayUrl(cid, gateway);
}

export type TraceFetchOptions = Partial<
  Pick<RaceOptions, "gateways" | "maxBytes" | "timeoutMs" | "staggerMs" | "signal" | "fetchImpl" | "onProgress">
>;

/**
 * Races the configured gateway pool for a trace and checks it against the
 * on-chain hash. Results carry per-gateway attempts and the CID check.
 */
export async function fetchAndVerifyTraceWith(cid: string, onChainHash: string, opts: TraceFetchOptions = {}): Promise<TraceCheck> {
  const { check } = await raceGateways({
    cid,
    onChainHash,
    gateways: opts.gateways ?? IPFS_GATEWAYS,
    maxBytes: opts.maxBytes ?? IPFS_MAX_TRACE_BYTES,
    timeoutMs: opts.timeoutMs,
    staggerMs: opts.staggerMs,
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    onProgress: opts.onProgress,
  });
  return check;
}

/**
 * Fetches trace content and checks it against the on-chain hash. Content is
 * only returned when it is verified; callers must never render anything
 * else as the trace.
 */
export function fetchAndVerifyTrace(cid: string, onChainHash: string, fetchImpl: typeof fetch = fetch): Promise<TraceCheck> {
  return fetchAndVerifyTraceWith(cid, onChainHash, { fetchImpl });
}

// ─── Worker client ──────────────────────────────────────────────────────────

export interface WorkerVerifyOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Pick<RaceProgress, "received" | "total">) => void;
}

interface PendingJob {
  resolve: (check: TraceCheck) => void;
  onProgress?: WorkerVerifyOptions["onProgress"];
  cid: string;
  onChainHash: string;
  signal?: AbortSignal;
}

let worker: Worker | null = null;
/** Set when the worker can't be created or fails at runtime (for example blocked by CSP). */
let workerDisabled = false;
let nextJobId = 0;
const pendingJobs = new Map<string, PendingJob>();

function rebuildCheck(message: Extract<TraceWorkerResponse, { type: "result" }>): TraceCheck {
  const check: WorkerCheck = message.check;
  if (check.status !== "verified") return check;
  const content =
    message.contentKind === "json"
      ? message.json
      : new TextDecoder().decode(new Uint8Array(message.bytes ?? new ArrayBuffer(0)));
  return { ...check, content };
}

function settleAllInThread() {
  for (const [id, job] of pendingJobs) {
    pendingJobs.delete(id);
    void fetchAndVerifyTraceWith(job.cid, job.onChainHash, { signal: job.signal, onProgress: job.onProgress }).then(job.resolve);
  }
}

function getWorker(): Worker | null {
  if (workerDisabled) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    workerDisabled = true;
    return null;
  }
  try {
    worker = new Worker(new URL("./trace.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerDisabled = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<TraceWorkerResponse>) => {
    const message = event.data;
    const job = pendingJobs.get(message.id);
    if (!job) return;
    if (message.type === "progress") {
      job.onProgress?.({ received: message.received, total: message.total });
      return;
    }
    pendingJobs.delete(message.id);
    job.resolve(rebuildCheck(message));
  };
  // A worker that fails at runtime is abandoned for this page, and its pending jobs run on the main thread.
  const onWorkerFailure = () => {
    worker?.terminate();
    worker = null;
    workerDisabled = true;
    settleAllInThread();
  };
  worker.onerror = onWorkerFailure;
  worker.onmessageerror = onWorkerFailure;
  return worker;
}

/**
 * Verifies a trace in the trace worker: streaming download, incremental hash and
 * JSON decode happen off the main thread. Falls back to the main thread when
 * workers aren't available. Aborting `signal` cancels the download.
 */
export function verifyTraceInWorker(cid: string, onChainHash: string, opts: WorkerVerifyOptions = {}): Promise<TraceCheck> {
  const target = getWorker();
  if (!target) return fetchAndVerifyTraceWith(cid, onChainHash, { signal: opts.signal, onProgress: opts.onProgress });
  if (opts.signal?.aborted) return Promise.resolve({ status: "unavailable", reason: "Cancelled" });

  const id = String(++nextJobId);
  return new Promise<TraceCheck>((resolve) => {
    const cancel = () => {
      if (!pendingJobs.delete(id)) return;
      target.postMessage({ type: "cancel", id } satisfies TraceWorkerRequest);
      resolve({ status: "unavailable", reason: "Cancelled" });
    };
    pendingJobs.set(id, {
      cid,
      onChainHash,
      signal: opts.signal,
      onProgress: opts.onProgress,
      resolve: (check) => {
        opts.signal?.removeEventListener("abort", cancel);
        resolve(check);
      },
    });
    opts.signal?.addEventListener("abort", cancel, { once: true });
    target.postMessage({
      type: "verify",
      id,
      cid,
      expectedHash: onChainHash,
      gateways: [...IPFS_GATEWAYS],
      maxBytes: IPFS_MAX_TRACE_BYTES,
    } satisfies TraceWorkerRequest);
  });
}
