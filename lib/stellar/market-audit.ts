import type { ReasoningTrace } from "@/lib/api/traces";
import { listTraces } from "@/lib/api/traces";
import { reasoningRegistry } from "./clients";
import { bytesToHex, read } from "./typed-call";
import { fetchAndVerifyTraceWith, normalizeHash } from "./trace";
import type { TraceCheck } from "./trace-core";
import { IPFS_GATEWAYS, DEFAULT_IPFS_MAX_TRACE_BYTES } from "./config";

export interface OnChainMarketTrace {
  index: number;
  onChainTraceId: string;
  agent: string;
  action: string;
  ipfsCid: string;
  publishedAt: number; // Unix timestamp ms
  traceHash: string; // 64-hex lowercase
}

export type AuditItemStatus = "verified" | "mismatch" | "unavailable" | "pending" | "running";

export interface AuditedTraceItem {
  onChainTraceId: string;
  index: number;
  agent: string;
  action: string;
  ipfsCid: string;
  publishedAt: number;
  onChainHash: string;
  computedHash: string | null;
  status: AuditItemStatus;
  reason?: string;
  content?: unknown;
  backendRecord?: ReasoningTrace | null;
  disagreements: string[];
  isCriticalDisagreement: boolean;
}

export interface MarketAuditSummary {
  onChainCount: number;
  backendCount: number;
  verifiedCount: number;
  mismatchCount: number;
  unavailableCount: number;
  pendingCount: number;
  agentsInvolved: string[];
  timeSpan: {
    start: number | null;
    end: number | null;
    formatted: string;
  };
  disagreementsCount: number;
  criticalDisagreementsCount: number;
  criticalDisagreements: Array<{
    onChainTraceId: string;
    description: string;
  }>;
}

export interface AuditProgress {
  phase: "idle" | "enumerating" | "verifying" | "completed" | "paused" | "error";
  total: number;
  verified: number;
  mismatches: number;
  unavailable: number;
  currentTraceId?: string;
  error?: string;
}

export const DEFAULT_AUDIT_CONCURRENCY = 3;

/**
 * Enumerates all traces registered for a market directly from reasoning-registry contract
 * in publish order, independent of the backend.
 */
export async function enumerateOnChainMarketTraces(
  onChainMarketId: bigint | string | number,
  client = reasoningRegistry(),
): Promise<OnChainMarketTrace[]> {
  const marketIdBigInt = BigInt(onChainMarketId);

  // 1. Get count from reasoning-registry
  const countTx = await client.market_trace_count({ market_id: marketIdBigInt });
  const countU64 = read(countTx, "reasoningRegistry");
  const count = Number(countU64);

  const traces: OnChainMarketTrace[] = [];

  // 2. Enumerate in publish order
  for (let index = 0; index < count; index++) {
    const traceAtTx = await client.market_trace_at({
      market_id: marketIdBigInt,
      index: BigInt(index),
    });
    const traceId = read(traceAtTx, "reasoningRegistry");

    const getTraceTx = await client.get_trace({ trace_id: traceId });
    const trace = read(getTraceTx, "reasoningRegistry");

    traces.push({
      index,
      onChainTraceId: traceId.toString(),
      agent: trace.agent,
      action: trace.action,
      ipfsCid: trace.ipfs_cid,
      publishedAt: Number(trace.published_at) * 1000,
      traceHash: bytesToHex(trace.trace_hash),
    });
  }

  return traces;
}

/**
 * Reconciles an audited on-chain trace with the backend's trace record.
 * Flags any disagreements, especially where backend calls verified: true
 * but the browser's own check failed.
 */
export function reconcileTraceWithBackend(
  onChain: OnChainMarketTrace,
  browserStatus: AuditItemStatus,
  computedHash: string | null,
  backendRecord?: ReasoningTrace | null,
): { disagreements: string[]; isCriticalDisagreement: boolean } {
  const disagreements: string[] = [];
  let isCriticalDisagreement = false;

  if (!backendRecord) {
    disagreements.push("Trace is registered on-chain but absent from backend database feed.");
    return { disagreements, isCriticalDisagreement };
  }

  // 1. Compare hash commitments
  if (backendRecord.traceHash) {
    const backendNorm = normalizeHash(backendRecord.traceHash);
    const onChainNorm = normalizeHash(onChain.traceHash);
    if (backendNorm !== onChainNorm) {
      disagreements.push(
        `Hash mismatch: backend stores ${backendNorm.slice(0, 10)}… but chain committed ${onChainNorm.slice(0, 10)}…`,
      );
      isCriticalDisagreement = true;
    }
  }

  // 2. Compare IPFS CID
  if (backendRecord.ipfsCid && backendRecord.ipfsCid.trim() !== onChain.ipfsCid.trim()) {
    disagreements.push(
      `CID mismatch: backend stores ${backendRecord.ipfsCid} but chain recorded ${onChain.ipfsCid}`,
    );
  }

  // 3. HONEST CHECK: The most important check on the page
  // If backend claims verified: true, but browser check failed
  if (backendRecord.verified && browserStatus === "mismatch") {
    disagreements.push(
      "CRITICAL: Backend claims verified: true, but browser cryptographic check failed! The content does not hash to on-chain trace_hash.",
    );
    isCriticalDisagreement = true;
  } else if (backendRecord.verified && browserStatus === "unavailable") {
    disagreements.push(
      "Backend claims verified: true, but browser could not reach IPFS gateways to confirm content.",
    );
  } else if (!backendRecord.verified && browserStatus === "verified") {
    disagreements.push("Backend left trace marked as unverified, but browser successfully verified on-chain content.");
  }

  return { disagreements, isCriticalDisagreement };
}

/**
 * Computes the aggregate integrity summary for a market audit.
 */
export function computeMarketAuditSummary(
  items: AuditedTraceItem[],
  onChainCount: number,
  backendCount: number,
): MarketAuditSummary {
  let verifiedCount = 0;
  let mismatchCount = 0;
  let unavailableCount = 0;
  let pendingCount = 0;
  let disagreementsCount = 0;
  let criticalDisagreementsCount = 0;

  const criticalDisagreements: Array<{ onChainTraceId: string; description: string }> = [];
  const agentsSet = new Set<string>();

  let minTime: number | null = null;
  let maxTime: number | null = null;

  for (const item of items) {
    if (item.agent) agentsSet.add(item.agent);

    if (item.publishedAt > 0) {
      if (minTime === null || item.publishedAt < minTime) minTime = item.publishedAt;
      if (maxTime === null || item.publishedAt > maxTime) maxTime = item.publishedAt;
    }

    if (item.status === "verified") verifiedCount++;
    else if (item.status === "mismatch") mismatchCount++;
    else if (item.status === "unavailable") unavailableCount++;
    else pendingCount++;

    if (item.disagreements.length > 0) {
      disagreementsCount += item.disagreements.length;
      if (item.isCriticalDisagreement) {
        criticalDisagreementsCount++;
        criticalDisagreements.push({
          onChainTraceId: item.onChainTraceId,
          description: item.disagreements.find((d) => d.startsWith("CRITICAL")) ?? item.disagreements[0],
        });
      }
    }
  }

  // Format time span
  let formattedTimeSpan = "No time span";
  if (minTime !== null && maxTime !== null) {
    const startDate = new Date(minTime).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const endDate = new Date(maxTime).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const durationHours = Math.round((maxTime - minTime) / (1000 * 60 * 60));
    formattedTimeSpan = minTime === maxTime
      ? `${startDate}`
      : `${startDate} — ${endDate} (${durationHours}h span)`;
  }

  return {
    onChainCount,
    backendCount,
    verifiedCount,
    mismatchCount,
    unavailableCount,
    pendingCount,
    agentsInvolved: Array.from(agentsSet),
    timeSpan: {
      start: minTime,
      end: maxTime,
      formatted: formattedTimeSpan,
    },
    disagreementsCount,
    criticalDisagreementsCount,
    criticalDisagreements,
  };
}

export interface RunMarketAuditOptions {
  onChainMarketId: string | bigint | number;
  marketId?: string | null;
  concurrency?: number;
  signal?: AbortSignal;
  existingItems?: Map<string, AuditedTraceItem>;
  fetchImpl?: typeof fetch;
  client?: any;
  backendTraces?: ReasoningTrace[];
  onProgress?: (progress: AuditProgress, currentItems: AuditedTraceItem[]) => void;
}

/**
 * Runs a bounded-concurrency market trace integrity audit:
 * 1. Enumerates all traces published on-chain for the market
 * 2. Fetches backend traces for cross-reconciliation
 * 3. Verifies each trace's content against IPFS gateways with bounded concurrency
 * 4. Is resumable (keeps existing verified items) and cancellable via AbortSignal
 */
export async function runMarketTraceAudit(opts: RunMarketAuditOptions): Promise<{
  items: AuditedTraceItem[];
  summary: MarketAuditSummary;
  cancelled: boolean;
}> {
  const concurrency = opts.concurrency ?? DEFAULT_AUDIT_CONCURRENCY;
  const itemsMap = new Map<string, AuditedTraceItem>(opts.existingItems);
  const signal = opts.signal;

  // 1. Enumerate on-chain traces
  opts.onProgress?.(
    { phase: "enumerating", total: 0, verified: 0, mismatches: 0, unavailable: 0 },
    Array.from(itemsMap.values()),
  );

  let onChainTraces: OnChainMarketTrace[] = [];
  try {
    onChainTraces = await enumerateOnChainMarketTraces(opts.onChainMarketId, opts.client);
  } catch (err) {
    if (signal?.aborted) {
      return {
        items: Array.from(itemsMap.values()),
        summary: computeMarketAuditSummary(Array.from(itemsMap.values()), 0, 0),
        cancelled: true,
      };
    }
    throw err;
  }

  // 2. Fetch backend trace records for reconciliation
  let backendTraces: ReasoningTrace[] = opts.backendTraces ?? [];
  if (!opts.backendTraces) {
    try {
      const res = await listTraces({ marketId: opts.marketId ?? undefined, limit: 100 });
      backendTraces = res.traces;
    } catch {
      // If backend is unreachable or dry-run, continue with on-chain traces only
    }
  }

  const backendByOnChainId = new Map<string, ReasoningTrace>();
  for (const t of backendTraces) {
    if (t.onChainTraceId) backendByOnChainId.set(t.onChainTraceId, t);
  }

  // Populate initial pending items
  for (const onChain of onChainTraces) {
    if (!itemsMap.has(onChain.onChainTraceId)) {
      const backendRecord = backendByOnChainId.get(onChain.onChainTraceId) ?? null;
      itemsMap.set(onChain.onChainTraceId, {
        onChainTraceId: onChain.onChainTraceId,
        index: onChain.index,
        agent: onChain.agent,
        action: onChain.action,
        ipfsCid: onChain.ipfsCid,
        publishedAt: onChain.publishedAt,
        onChainHash: onChain.traceHash,
        computedHash: null,
        status: "pending",
        backendRecord,
        disagreements: [],
        isCriticalDisagreement: false,
      });
    }
  }

  const total = onChainTraces.length;
  let verified = 0;
  let mismatches = 0;
  let unavailable = 0;

  // Count already verified / settled items from resume
  for (const item of itemsMap.values()) {
    if (item.status === "verified") verified++;
    else if (item.status === "mismatch") mismatches++;
    else if (item.status === "unavailable") unavailable++;
  }

  const updateProgress = (currentTraceId?: string) => {
    opts.onProgress?.(
      {
        phase: signal?.aborted ? "paused" : "verifying",
        total,
        verified,
        mismatches,
        unavailable,
        currentTraceId,
      },
      Array.from(itemsMap.values()),
    );
  };

  updateProgress();

  // 3. Bounded concurrency verification of pending traces
  const pendingItems = Array.from(itemsMap.values()).filter(
    (item) => item.status === "pending" || item.status === "running",
  );

  let nextIndex = 0;
  let activeWorkers = 0;
  let wasCancelled = false;

  await new Promise<void>((resolve) => {
    if (pendingItems.length === 0 || signal?.aborted) {
      resolve();
      return;
    }

    const startWorker = () => {
      if (signal?.aborted) {
        wasCancelled = true;
        if (activeWorkers === 0) resolve();
        return;
      }

      if (nextIndex >= pendingItems.length) {
        if (activeWorkers === 0) resolve();
        return;
      }

      const item = pendingItems[nextIndex++];
      item.status = "running";
      activeWorkers++;
      updateProgress(item.onChainTraceId);

      const onChain = onChainTraces.find((t) => t.onChainTraceId === item.onChainTraceId);
      const onChainHash = onChain ? onChain.traceHash : item.onChainHash;

      fetchAndVerifyTraceWith(item.ipfsCid, onChainHash, {
        signal,
        gateways: IPFS_GATEWAYS,
        maxBytes: DEFAULT_IPFS_MAX_TRACE_BYTES,
        timeoutMs: 8_000,
        fetchImpl: opts.fetchImpl,
      })
        .then((check: TraceCheck) => {
          activeWorkers--;
          if (signal?.aborted) {
            item.status = "pending";
            wasCancelled = true;
            if (activeWorkers === 0) resolve();
            return;
          }

          if (check.status === "verified") {
            item.status = "verified";
            item.computedHash = check.computedHash;
            item.content = check.content;
            verified++;
          } else if (check.status === "mismatch") {
            item.status = "mismatch";
            item.computedHash = check.computedHash;
            mismatches++;
          } else {
            item.status = "unavailable";
            item.reason = check.reason;
            unavailable++;
          }

          // Reconcile with backend
          const reconciliation = reconcileTraceWithBackend(
            onChain ?? {
              index: item.index,
              onChainTraceId: item.onChainTraceId,
              agent: item.agent,
              action: item.action,
              ipfsCid: item.ipfsCid,
              publishedAt: item.publishedAt,
              traceHash: item.onChainHash,
            },
            item.status,
            item.computedHash,
            item.backendRecord,
          );
          item.disagreements = reconciliation.disagreements;
          item.isCriticalDisagreement = reconciliation.isCriticalDisagreement;

          updateProgress(item.onChainTraceId);
          startWorker();
        })
        .catch(() => {
          activeWorkers--;
          item.status = "unavailable";
          item.reason = "Verification threw error";
          unavailable++;
          updateProgress(item.onChainTraceId);
          startWorker();
        });
    };

    // Launch worker pool up to concurrency limit
    const poolSize = Math.min(concurrency, pendingItems.length);
    for (let i = 0; i < poolSize; i++) {
      startWorker();
    }
  });

  const finalItems = Array.from(itemsMap.values()).sort((a, b) => a.index - b.index);
  const summary = computeMarketAuditSummary(finalItems, onChainTraces.length, backendTraces.length);

  opts.onProgress?.(
    {
      phase: wasCancelled || signal?.aborted ? "paused" : "completed",
      total,
      verified,
      mismatches,
      unavailable,
    },
    finalItems,
  );

  return {
    items: finalItems,
    summary,
    cancelled: wasCancelled || Boolean(signal?.aborted),
  };
}
