import { apiClient } from "./client";
import type { MarketCategory, SettlementCurrency } from "./markets";

export type AgentType = "MARKET_MAKER" | "TRADER";
export type UnlockType = "PER_TRACE" | "DAILY_PASS";

export interface ReasoningSource {
  source: string;
  weight: number;
  signal: string;
}

export interface ReasoningTrace {
  id: string;
  marketId: string;
  agentType: AgentType;
  decisionType: string;
  edge: number;
  probabilityEstimate: number;
  marketProbability: number;
  confidenceInterval: { lower: number; upper: number };
  verified: boolean;
  ipfsCid: string | null;
  /** sha256 of the exact bytes pinned to IPFS. */
  traceHash?: string | null;
  /** reasoning-registry trace id; null until published on-chain. */
  onChainTraceId?: string | null;
  publishTxHash?: string | null;
  accessLevel?: "FREE_PREVIEW" | "PER_TRACE" | "DAILY_PASS" | "NO_ACCESS";
  dailyPassPriceRaw?: string;
  previewSources: ReasoningSource[] | null;
  sourcesUsed?: ReasoningSource[];
  betFraction?: number;
  betSizeUsdc?: number;
  hedgeConditions?: string[];
  market: {
    question: string;
    category: MarketCategory;
    settlementCurrency: SettlementCurrency;
    onChainMarketId?: string | null;
  };
  createdAt: string;
}

export interface ListTracesParams {
  agentType?: AgentType | "";
  page?: number;
  limit?: number;
}

export interface TraceVerification {
  traceId: string;
  onChainTraceId: string;
  ipfsCid: string;
  onChainHash: string;
  computedHash: string;
  storedHash: string | null;
  verified: boolean;
  verifiedAt: string;
}

export interface SpendingAllowance {
  id?: string;
  dailyLimit: number;
  perTraceLimit: number;
  currency: SettlementCurrency;
}

export async function listTraces(params: ListTracesParams = {}) {
  const { data, meta } = await apiClient.get<ReasoningTrace[]>("/traces", { ...params });
  return { traces: data, meta };
}

export async function getTrace(id: string) {
  const { data } = await apiClient.get<ReasoningTrace>(`/traces/${id}`);
  return data;
}

export async function verifyTrace(traceId: string) {
  const { data } = await apiClient.post<TraceVerification>("/traces/verify", {
    traceId,
  });

  return data;
}

/** The backend unlock route needs a trace id in the path; a daily pass covers every trace. */
export const DAILY_PASS_TRACE_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

/**
 * Daily pass: after paying with a USDC transfer to PAYMENTS_RECIPIENT, hand
 * the backend the transaction hash; it verifies the transfer on-chain.
 * Per-trace unlocks go through the x402 service instead.
 */
export async function unlockDailyPass(traceId: string, txHash: string, amountRaw: string) {
  const { data } = await apiClient.post<{
    subscription: unknown;
    trace: ReasoningTrace | null;
  }>(`/traces/${traceId}/unlock`, { txHash, amountRaw, type: "DAILY_PASS" satisfies UnlockType });

  return data;
}

/**
 * Activates a daily pass for a paid transaction. The only place that knows the
 * backend route still needs a placeholder trace id; swap the body once a
 * dedicated pass endpoint exists.
 */
export function activateDailyPass(txHash: string, amountRaw: string) {
  return unlockDailyPass(DAILY_PASS_TRACE_PLACEHOLDER, txHash, amountRaw);
}

export async function getSpendingAllowance() {
  const { data } = await apiClient.get<SpendingAllowance | null>("/traces/access/allowance");
  return data;
}

export async function setSpendingAllowance(allowance: {
  dailyLimit: number;
  perTraceLimit: number;
  currency?: SettlementCurrency;
}) {
  const { data } = await apiClient.put<SpendingAllowance>("/traces/access/allowance", allowance);
  return data;
}

export interface PaymentEvent {
  id: string;
  txHash: string;
  type: string;
  amountRaw: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

export async function getPaymentEvents() {
  const { data } = await apiClient.get<PaymentEvent[]>("/traces/payments");
  return data;
}
