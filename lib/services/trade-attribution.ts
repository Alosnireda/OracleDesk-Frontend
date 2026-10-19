import { ReasoningTrace } from "@/lib/api/traces";

export interface TradeRecord {
  marketId: string;
  agentAddress: string;
  outcome: "YES" | "NO";
  shares: number;
  collateral: number;
  fee: number;
  timestamp: number;
  txHash?: string;
}

export interface TraceRecord {
  traceId: string;
  marketId: string;
  agentAddress: string;
  action: string;
  timestamp: number;
  verified: boolean;
  onChainTraceId?: string;
}

export interface TradeAttributionMatch {
  trade: TradeRecord;
  trace: TraceRecord | null;
  confidence: "high" | "medium" | "low" | "unverified";
  reason: string;
  flag?: string;
}

export function convertTraceToRecord(trace: ReasoningTrace): TraceRecord {
  return {
    traceId: trace.id,
    marketId: trace.marketId,
    agentAddress: trace.onChainTraceId || "unknown",
    action: trace.decisionType || "analysis",
    timestamp: new Date(trace.createdAt).getTime(),
    verified: trace.verified,
    onChainTraceId: trace.onChainTraceId || undefined,
  };
}

export function matchTradeToTrace(
  trade: TradeRecord,
  traces: TraceRecord[],
): TradeAttributionMatch {
  const contextWindow = 60 * 60 * 1000;
  const marketTraces = traces.filter((t) => t.marketId === trade.marketId);

  if (marketTraces.length === 0) {
    return {
      trade,
      trace: null,
      confidence: "unverified",
      reason: `No traces found for market ${trade.marketId}`,
      flag: "TRADE_WITHOUT_TRACE",
    };
  }

  const agentTraces = marketTraces.filter((t) => t.agentAddress === trade.agentAddress);

  if (agentTraces.length === 0) {
    return {
      trade,
      trace: null,
      confidence: "unverified",
      reason: `No traces from agent ${trade.agentAddress} for market ${trade.marketId}`,
      flag: "TRADE_AGENT_MISMATCH",
    };
  }

  const tradeAction = trade.outcome === "YES" ? "buy" : "sell";
  const actionMatches = agentTraces.filter((t) =>
    t.action.toLowerCase().includes(tradeAction) ||
    t.action.toLowerCase().includes("trade") ||
    t.action.toLowerCase().includes("decision"),
  );

  const matchByProximity = (candidates: TraceRecord[]): TradeAttributionMatch => {
    const closest = candidates
      .filter((t) => Math.abs(t.timestamp - trade.timestamp) <= contextWindow)
      .sort((a, b) => Math.abs(a.timestamp - trade.timestamp) - Math.abs(b.timestamp - trade.timestamp))[0];

    if (!closest) {
      const anyClose = candidates[0];
      const timeDiff = Math.abs(anyClose.timestamp - trade.timestamp);
      return {
        trade,
        trace: anyClose,
        confidence: timeDiff < contextWindow * 2 ? "medium" : "low",
        reason: `Matched by market+agent proximity; time diff: ${(timeDiff / 1000).toFixed(0)}s`,
      };
    }

    const timeDiff = Math.abs(closest.timestamp - trade.timestamp);
    const confidence =
      timeDiff < 5 * 60 * 1000
        ? ("high" as const)
        : timeDiff < 30 * 60 * 1000
          ? ("medium" as const)
          : ("low" as const);

    return {
      trade,
      trace: closest,
      confidence,
      reason: `Matched on market+agent+action within ${(timeDiff / 1000).toFixed(0)}s`,
    };
  };

  if (actionMatches.length > 0) {
    return matchByProximity(actionMatches);
  }

  return matchByProximity(agentTraces);
}

export function attributeTradesToTraces(
  trades: TradeRecord[],
  traces: TraceRecord[],
): TradeAttributionMatch[] {
  return trades.map((trade) => matchTradeToTrace(trade, traces));
}

export function flagUnattributedTrades(
  attributions: TradeAttributionMatch[],
): TradeAttributionMatch[] {
  return attributions.map((attr) => {
    if (!attr.trace && !attr.flag) {
      return {
        ...attr,
        flag: "TRADE_WITHOUT_TRACE",
      };
    }
    return attr;
  });
}
