import { ReasoningTrace } from "@/lib/api/traces";
import { fetchAndVerifyTrace } from "@/lib/stellar/trace";

export interface TraceVersion {
  traceId: string;
  content: unknown;
  publishedAt: number;
  verified: boolean;
  ipfsCid: string;
  traceHash?: string;
}

export interface SourceDiff {
  added: Array<{ name: string; weight: number; signal: string }>;
  removed: Array<{ name: string; weight: number; signal: string }>;
  modified: Array<{
    name: string;
    weightBefore: number;
    weightAfter: number;
    signalBefore: string;
    signalAfter: string;
  }>;
}

export interface TraceDiff {
  from: TraceVersion;
  to: TraceVersion;
  probabilityChange: {
    from: number;
    to: number;
    delta: number;
  } | null;
  estimateChange: {
    from: number;
    to: number;
    delta: number;
  } | null;
  sourceDiff: SourceDiff;
  decisionFlipped: boolean;
  significantChange: boolean;
}

export async function fetchTraceVersion(
  trace: ReasoningTrace,
): Promise<TraceVersion | null> {
  if (!trace.ipfsCid || !trace.traceHash) return null;

  const check = await fetchAndVerifyTrace(
    trace.ipfsCid,
    trace.traceHash,
  );

  if (check.status !== "verified") {
    return null;
  }

  return {
    traceId: trace.id,
    content: check.content,
    publishedAt: new Date(trace.createdAt).getTime(),
    verified: true,
    ipfsCid: trace.ipfsCid,
    traceHash: trace.traceHash,
  };
}

export function extractSources(content: unknown): Array<{ name: string; weight: number; signal: string }> {
  if (!content || typeof content !== "object") return [];

  const obj = content as Record<string, unknown>;
  const sources = obj.sources || obj.previewSources || [];

  if (!Array.isArray(sources)) return [];

  return sources.map((s: unknown) => {
    if (typeof s !== "object" || !s) return null;
    const source = s as Record<string, unknown>;
    return {
      name: String(source.source || source.name || "Unknown"),
      weight: Number(source.weight || 0),
      signal: String(source.signal || ""),
    };
  }).filter((s): s is { name: string; weight: number; signal: string } => s !== null);
}

function extractProbability(content: unknown): number | null {
  if (!content || typeof content !== "object") return null;
  const obj = content as Record<string, unknown>;
  const prob = obj.probabilityEstimate ?? obj.probability ?? obj.yesProb;
  return prob !== null && prob !== undefined ? Number(prob) : null;
}

function extractEstimate(content: unknown): number | null {
  if (!content || typeof content !== "object") return null;
  const obj = content as Record<string, unknown>;
  const est = obj.edge ?? obj.estimate ?? obj.expectedValue;
  return est !== null && est !== undefined ? Number(est) : null;
}

export function matchSources(
  before: Array<{ name: string; weight: number; signal: string }>,
  after: Array<{ name: string; weight: number; signal: string }>,
): SourceDiff {
  const beforeMap = new Map(before.map((s) => [s.name.toLowerCase(), s]));
  const afterMap = new Map(after.map((s) => [s.name.toLowerCase(), s]));

  const added: typeof before = [];
  const removed: typeof before = [];
  const modified: Array<{
    name: string;
    weightBefore: number;
    weightAfter: number;
    signalBefore: string;
    signalAfter: string;
  }> = [];

  for (const [key, afterSource] of afterMap) {
    const beforeSource = beforeMap.get(key);
    if (!beforeSource) {
      added.push(afterSource);
    } else if (beforeSource.weight !== afterSource.weight || beforeSource.signal !== afterSource.signal) {
      modified.push({
        name: afterSource.name,
        weightBefore: beforeSource.weight,
        weightAfter: afterSource.weight,
        signalBefore: beforeSource.signal,
        signalAfter: afterSource.signal,
      });
    }
  }

  for (const [key, beforeSource] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push(beforeSource);
    }
  }

  return { added, removed, modified };
}

export function computeTraceDiff(from: TraceVersion, to: TraceVersion): TraceDiff {
  const beforeProb = extractProbability(from.content);
  const afterProb = extractProbability(to.content);
  const beforeEst = extractEstimate(from.content);
  const afterEst = extractEstimate(to.content);

  const beforeSources = extractSources(from.content);
  const afterSources = extractSources(to.content);

  const probabilityChange = beforeProb !== null && afterProb !== null
    ? {
        from: beforeProb,
        to: afterProb,
        delta: afterProb - beforeProb,
      }
    : null;

  const estimateChange = beforeEst !== null && afterEst !== null
    ? {
        from: beforeEst,
        to: afterEst,
        delta: afterEst - beforeEst,
      }
    : null;

  const sourceDiff = matchSources(beforeSources, afterSources);
  const decisionFlipped =
    beforeProb !== null &&
    afterProb !== null &&
    Math.abs(beforeProb - 0.5) > 0.1 &&
    Math.abs(afterProb - 0.5) > 0.1 &&
    (beforeProb > 0.5) !== (afterProb > 0.5);

  const significantChange =
    (probabilityChange?.delta && Math.abs(probabilityChange.delta) > 0.1) ||
    (estimateChange?.delta && Math.abs(estimateChange.delta) > 0.05) ||
    sourceDiff.added.length > 0 ||
    sourceDiff.removed.length > 0;

  return {
    from,
    to,
    probabilityChange,
    estimateChange,
    sourceDiff,
    decisionFlipped,
    significantChange,
  };
}
