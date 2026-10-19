import { ReasoningTrace } from "@/lib/api/traces";

export interface AgentMetrics {
  totalTraces: number;
  totalMarketsCreated: number;
  totalTrades: number;
  winRate: number | null;
  totalCapitalDeployed: number;
  successfulOutcomes: number;
  failedOutcomes: number;
  registeredAt?: number;
  lastActivityAt?: number;
  averageConfidence: number;
  averageEdge: number;
}

export interface AgentTrade {
  marketId: string;
  outcome: "YES" | "NO";
  shares: number;
  collateral: number;
  fee: number;
  timestamp: number;
  resolved?: boolean;
  result?: "won" | "lost";
}

export interface AgentCreatedMarket {
  marketId: string;
  question: string;
  category: string;
  createdAt: number;
  resolved?: boolean;
  resolvedOutcome?: "YES" | "NO";
}

export interface AgentProfile {
  agentAddress: string;
  registered: boolean;
  metrics: AgentMetrics;
  traces: ReasoningTrace[];
  trades: AgentTrade[];
  createdMarkets: AgentCreatedMarket[];
  lastUpdatedAt: number;
  eventWindowSize: {
    startBlock?: number;
    endBlock?: number;
    note: string;
  };
}

export function createEmptyProfile(agentAddress: string): AgentProfile {
  return {
    agentAddress,
    registered: false,
    metrics: {
      totalTraces: 0,
      totalMarketsCreated: 0,
      totalTrades: 0,
      winRate: null,
      totalCapitalDeployed: 0,
      successfulOutcomes: 0,
      failedOutcomes: 0,
      averageConfidence: 0,
      averageEdge: 0,
    },
    traces: [],
    trades: [],
    createdMarkets: [],
    lastUpdatedAt: Date.now(),
    eventWindowSize: {
      note: "RPC event window limited to recent blocks; historical trades/markets may not be captured.",
    },
  };
}

export function computeAgentMetrics(
  traces: ReasoningTrace[],
  trades: AgentTrade[],
  markets: AgentCreatedMarket[],
): AgentMetrics {
  const resolvedTrades = trades.filter((t) => t.resolved);
  const wonTrades = resolvedTrades.filter((t) => t.result === "won");

  const confidences = traces.map((t) => t.probabilityEstimate).filter((c) => !isNaN(c) && c !== null);
  const edges = traces.map((t) => t.edge).filter((e) => !isNaN(e) && e !== null);

  const resolvedMarkets = markets.filter((m) => m.resolved);
  const successfulMarkets = resolvedMarkets.filter((m) => m.resolvedOutcome !== undefined);

  return {
    totalTraces: traces.length,
    totalMarketsCreated: markets.length,
    totalTrades: trades.length,
    winRate: resolvedTrades.length > 0 ? wonTrades.length / resolvedTrades.length : null,
    totalCapitalDeployed: trades.reduce((sum, t) => sum + t.collateral, 0),
    successfulOutcomes: successfulMarkets.length,
    failedOutcomes: resolvedMarkets.length - successfulMarkets.length,
    averageConfidence: confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0,
    averageEdge: edges.length > 0
      ? edges.reduce((a, b) => a + b, 0) / edges.length
      : 0,
    registeredAt: undefined,
    lastActivityAt: Math.max(
      ...traces.map((t) => new Date(t.createdAt).getTime()),
      ...trades.map((t) => t.timestamp),
      ...markets.map((m) => m.createdAt),
      0,
    ),
  };
}

export function buildAgentProfile(
  agentAddress: string,
  registered: boolean,
  traces: ReasoningTrace[],
  trades: AgentTrade[],
  markets: AgentCreatedMarket[],
): AgentProfile {
  return {
    agentAddress,
    registered,
    metrics: computeAgentMetrics(traces, trades, markets),
    traces,
    trades,
    createdMarkets: markets,
    lastUpdatedAt: Date.now(),
    eventWindowSize: {
      note: "On-chain events are limited to the RPC provider's event history window. Complete historical data requires indexing.",
    },
  };
}
