import { reasoningRegistry } from "./clients";
import { verifyTraceInWorker, type TraceCheck } from "./trace";
import { bytesToHex, read } from "./typed-call";

export interface VerifiedTrace {
  onChainTraceId: string;
  marketId: string;
  agent: string;
  action: string;
  ipfsCid: string;
  onChainHash: string;
  publishedAt: number;
  check: TraceCheck;
}

/**
 * Reads the trace from reasoning-registry, then fetches its IPFS content and
 * checks it against the on-chain hash. Shared by the trace pages and the x402
 * unlock flows, which mark a trace unlocked only when `check` is verified.
 */
export async function fetchVerifiedTrace(onChainTraceId: bigint | string, signal?: AbortSignal): Promise<VerifiedTrace> {
  const trace = read(await reasoningRegistry().get_trace({ trace_id: BigInt(onChainTraceId) }), "reasoningRegistry");
  const onChainHash = bytesToHex(trace.trace_hash);
  return {
    onChainTraceId: String(onChainTraceId),
    marketId: trace.market_id.toString(),
    agent: trace.agent,
    action: trace.action,
    ipfsCid: trace.ipfs_cid,
    onChainHash,
    publishedAt: Number(trace.published_at),
    check: await verifyTraceInWorker(trace.ipfs_cid, onChainHash, { signal }),
  };
}
