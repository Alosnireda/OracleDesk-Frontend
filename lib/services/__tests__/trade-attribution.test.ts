import { describe, it, expect } from "vitest";
import {
  matchTradeToTrace,
  attributeTradesToTraces,
  flagUnattributedTrades,
  TradeRecord,
  TraceRecord,
} from "../trade-attribution";

describe("trade-attribution service", () => {
  const createMockTrade = (marketId: string, agentAddress: string): TradeRecord => ({
    marketId,
    agentAddress,
    outcome: "YES",
    shares: 100,
    collateral: 1000,
    fee: 10,
    timestamp: Date.now(),
  });

  const createMockTrace = (
    traceId: string,
    marketId: string,
    agentAddress: string,
    timestamp: number = Date.now(),
  ): TraceRecord => ({
    traceId,
    marketId,
    agentAddress,
    action: "buy",
    timestamp,
    verified: true,
  });

  describe("matchTradeToTrace", () => {
    it("matches trade to trace on same market and agent", () => {
      const trade = createMockTrade("MKT-123", "AGENT-1");
      const traces = [createMockTrace("TRACE-1", "MKT-123", "AGENT-1")];

      const match = matchTradeToTrace(trade, traces);

      expect(match.trace).toBeDefined();
      expect(match.trace?.traceId).toBe("TRACE-1");
      expect(match.confidence).toBe("high");
    });

    it("flags trade with no matching traces", () => {
      const trade = createMockTrade("MKT-123", "AGENT-1");
      const traces: TraceRecord[] = [];

      const match = matchTradeToTrace(trade, traces);

      expect(match.trace).toBeNull();
      expect(match.flag).toBe("TRADE_WITHOUT_TRACE");
    });

    it("flags trade with mismatched agent", () => {
      const trade = createMockTrade("MKT-123", "AGENT-1");
      const traces = [createMockTrace("TRACE-1", "MKT-123", "AGENT-2")];

      const match = matchTradeToTrace(trade, traces);

      expect(match.flag).toBe("TRADE_AGENT_MISMATCH");
    });

    it("prefers traces within context window", () => {
      const now = Date.now();
      const trade = createMockTrade("MKT-123", "AGENT-1");
      trade.timestamp = now;

      const closeTrace = createMockTrace("TRACE-1", "MKT-123", "AGENT-1", now - 30000);
      const farTrace = createMockTrace("TRACE-2", "MKT-123", "AGENT-1", now - 120000);

      const match = matchTradeToTrace(trade, [farTrace, closeTrace]);

      expect(match.trace?.traceId).toBe("TRACE-1");
      expect(match.confidence).toBe("high");
    });

    it("reduces confidence for distant traces", () => {
      const now = Date.now();
      const trade = createMockTrade("MKT-123", "AGENT-1");
      trade.timestamp = now;

      const distantTrace = createMockTrace("TRACE-1", "MKT-123", "AGENT-1", now - 3600000);
      const match = matchTradeToTrace(trade, [distantTrace]);

      expect(match.confidence).toBe("low");
    });
  });

  describe("attributeTradesToTraces", () => {
    it("attributes multiple trades", () => {
      const trades = [
        createMockTrade("MKT-1", "AGENT-1"),
        createMockTrade("MKT-2", "AGENT-1"),
      ];
      const traces = [
        createMockTrace("TRACE-1", "MKT-1", "AGENT-1"),
        createMockTrace("TRACE-2", "MKT-2", "AGENT-1"),
      ];

      const attributions = attributeTradesToTraces(trades, traces);

      expect(attributions).toHaveLength(2);
      expect(attributions[0].trace?.traceId).toBe("TRACE-1");
      expect(attributions[1].trace?.traceId).toBe("TRACE-2");
    });
  });

  describe("flagUnattributedTrades", () => {
    it("adds TRADE_WITHOUT_TRACE flag to unattributed trades", () => {
      const attributions = [
        {
          trade: createMockTrade("MKT-1", "AGENT-1"),
          trace: null,
          confidence: "unverified" as const,
          reason: "No traces found",
        },
      ];

      const flagged = flagUnattributedTrades(attributions);

      expect(flagged[0].flag).toBe("TRADE_WITHOUT_TRACE");
    });

    it("preserves existing flags", () => {
      const attributions = [
        {
          trade: createMockTrade("MKT-1", "AGENT-1"),
          trace: null,
          confidence: "unverified" as const,
          reason: "No traces found",
          flag: "CUSTOM_FLAG" as const,
        },
      ];

      const flagged = flagUnattributedTrades(attributions);

      expect(flagged[0].flag).toBe("CUSTOM_FLAG");
    });
  });
});
