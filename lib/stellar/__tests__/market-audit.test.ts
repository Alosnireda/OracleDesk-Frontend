import { describe, expect, it } from "vitest";
import {
  computeMarketAuditSummary,
  enumerateOnChainMarketTraces,
  reconcileTraceWithBackend,
  runMarketTraceAudit,
  type AuditedTraceItem,
  type OnChainMarketTrace,
} from "../market-audit";
import type { ReasoningTrace } from "@/lib/api/traces";

describe("enumerateOnChainMarketTraces", () => {
  it("enumerates all traces in publish order directly from reasoning-registry", async () => {
    const mockTraces = [
      {
        id: 101n,
        trace: {
          agent: "GAGENT111",
          action: "analyze_sentiment",
          ipfs_cid: "bafytest1",
          published_at: 1700000000n,
          trace_hash: new Uint8Array(32).fill(1),
        },
      },
      {
        id: 102n,
        trace: {
          agent: "GAGENT222",
          action: "rebalance_pool",
          ipfs_cid: "bafytest2",
          published_at: 1700003600n,
          trace_hash: new Uint8Array(32).fill(2),
        },
      },
    ];

    const mockClient = {
      market_trace_count: async () => ({ result: BigInt(mockTraces.length) }),
      market_trace_at: async ({ index }: { index: bigint }) => ({
        result: mockTraces[Number(index)].id,
      }),
      get_trace: async ({ trace_id }: { trace_id: bigint }) => {
        const found = mockTraces.find((t) => t.id === trace_id);
        if (!found) throw new Error("Trace not found");
        return { result: found.trace };
      },
    };

    const traces = await enumerateOnChainMarketTraces(42, mockClient as any);

    expect(traces).toHaveLength(2);
    expect(traces[0]).toEqual({
      index: 0,
      onChainTraceId: "101",
      agent: "GAGENT111",
      action: "analyze_sentiment",
      ipfsCid: "bafytest1",
      publishedAt: 1700000000000,
      traceHash: "01".repeat(32),
    });
    expect(traces[1]).toEqual({
      index: 1,
      onChainTraceId: "102",
      agent: "GAGENT222",
      action: "rebalance_pool",
      ipfsCid: "bafytest2",
      publishedAt: 1700003600000,
      traceHash: "02".repeat(32),
    });
  });
});

describe("reconcileTraceWithBackend", () => {
  const onChain: OnChainMarketTrace = {
    index: 0,
    onChainTraceId: "123",
    agent: "GAGENTAAA",
    action: "make_market",
    ipfsCid: "bafybasecid",
    publishedAt: 1700000000000,
    traceHash: "aa".repeat(32),
  };

  it("reports no disagreements when on-chain and backend match", () => {
    const backend: ReasoningTrace = {
      id: "trace-uuid-1",
      onChainTraceId: "123",
      agentId: "agent-1",
      marketId: "market-1",
      action: "make_market",
      ipfsCid: "bafybasecid",
      traceHash: "aa".repeat(32),
      verified: true,
      probabilityEstimate: 0.65,
      edge: 0.1,
      confidence: 0.8,
      createdAt: new Date().toISOString(),
    };

    const result = reconcileTraceWithBackend(onChain, "verified", "aa".repeat(32), backend);
    expect(result.disagreements).toHaveLength(0);
    expect(result.isCriticalDisagreement).toBe(false);
  });

  it("flags disagreement when trace is on-chain but absent from backend feed", () => {
    const result = reconcileTraceWithBackend(onChain, "verified", "aa".repeat(32), null);
    expect(result.disagreements).toHaveLength(1);
    expect(result.disagreements[0]).toContain("Trace is registered on-chain but absent from backend database feed");
    expect(result.isCriticalDisagreement).toBe(false);
  });

  it("CRITICAL: flags when backend claims verified: true but browser verification failed (mismatch)", () => {
    const backend: ReasoningTrace = {
      id: "trace-uuid-2",
      onChainTraceId: "123",
      agentId: "agent-1",
      marketId: "market-1",
      action: "make_market",
      ipfsCid: "bafybasecid",
      traceHash: "aa".repeat(32),
      verified: true, // Backend claims verified!
      probabilityEstimate: 0.7,
      edge: 0.15,
      confidence: 0.85,
      createdAt: new Date().toISOString(),
    };

    // But local browser check computed a different hash!
    const result = reconcileTraceWithBackend(onChain, "mismatch", "ff".repeat(32), backend);
    expect(result.isCriticalDisagreement).toBe(true);
    expect(result.disagreements.some((d) => d.startsWith("CRITICAL"))).toBe(true);
  });

  it("CRITICAL: flags when backend traceHash commitment differs from on-chain traceHash", () => {
    const backend: ReasoningTrace = {
      id: "trace-uuid-3",
      onChainTraceId: "123",
      agentId: "agent-1",
      marketId: "market-1",
      action: "make_market",
      ipfsCid: "bafybasecid",
      traceHash: "bb".repeat(32), // Differs from onChain "aa".repeat(32)
      verified: false,
      probabilityEstimate: 0.5,
      edge: 0.05,
      confidence: 0.7,
      createdAt: new Date().toISOString(),
    };

    const result = reconcileTraceWithBackend(onChain, "verified", "aa".repeat(32), backend);
    expect(result.isCriticalDisagreement).toBe(true);
    expect(result.disagreements.some((d) => d.includes("Hash mismatch"))).toBe(true);
  });

  it("flags CID disagreement when backend CID differs from on-chain CID", () => {
    const backend: ReasoningTrace = {
      id: "trace-uuid-4",
      onChainTraceId: "123",
      agentId: "agent-1",
      marketId: "market-1",
      action: "make_market",
      ipfsCid: "bafydifferentcid",
      traceHash: "aa".repeat(32),
      verified: false,
      probabilityEstimate: 0.5,
      edge: 0.05,
      confidence: 0.7,
      createdAt: new Date().toISOString(),
    };

    const result = reconcileTraceWithBackend(onChain, "verified", "aa".repeat(32), backend);
    expect(result.disagreements.some((d) => d.includes("CID mismatch"))).toBe(true);
  });
});

describe("computeMarketAuditSummary", () => {
  it("accurately tallies status counts, unique agents, and critical disagreements", () => {
    const items: AuditedTraceItem[] = [
      {
        onChainTraceId: "1",
        index: 0,
        agent: "AgentAlpha",
        action: "action1",
        ipfsCid: "cid1",
        publishedAt: 1700000000000,
        onChainHash: "11".repeat(32),
        computedHash: "11".repeat(32),
        status: "verified",
        disagreements: [],
        isCriticalDisagreement: false,
      },
      {
        onChainTraceId: "2",
        index: 1,
        agent: "AgentBeta",
        action: "action2",
        ipfsCid: "cid2",
        publishedAt: 1700036000000,
        onChainHash: "22".repeat(32),
        computedHash: "99".repeat(32),
        status: "mismatch",
        disagreements: ["CRITICAL: Backend claims verified: true, but browser cryptographic check failed!"],
        isCriticalDisagreement: true,
      },
      {
        onChainTraceId: "3",
        index: 2,
        agent: "AgentAlpha",
        action: "action3",
        ipfsCid: "cid3",
        publishedAt: 1700072000000,
        onChainHash: "33".repeat(32),
        computedHash: null,
        status: "unavailable",
        disagreements: [],
        isCriticalDisagreement: false,
      },
    ];

    const summary = computeMarketAuditSummary(items, 3, 3);

    expect(summary.onChainCount).toBe(3);
    expect(summary.backendCount).toBe(3);
    expect(summary.verifiedCount).toBe(1);
    expect(summary.mismatchCount).toBe(1);
    expect(summary.unavailableCount).toBe(1);
    expect(summary.pendingCount).toBe(0);
    expect(summary.agentsInvolved).toEqual(["AgentAlpha", "AgentBeta"]);
    expect(summary.criticalDisagreementsCount).toBe(1);
    expect(summary.criticalDisagreements[0].onChainTraceId).toBe("2");
    expect(summary.timeSpan.start).toBe(1700000000000);
    expect(summary.timeSpan.end).toBe(1700072000000);
    expect(summary.timeSpan.formatted).toContain("span");
  });
});

describe("runMarketTraceAudit", () => {
  const hash1 = "11".repeat(32);
  const hash2 = "22".repeat(32);

  const mockClient = {
    market_trace_count: async () => ({ result: 2n }),
    market_trace_at: async ({ index }: { index: bigint }) => ({
      result: index === 0n ? 1n : 2n,
    }),
    get_trace: async ({ trace_id }: { trace_id: bigint }) => {
      if (trace_id === 1n) {
        return {
          result: {
            agent: "Agent1",
            action: "predict",
            ipfs_cid: "bafytrace1",
            published_at: 1700000000n,
            trace_hash: new Uint8Array(32).fill(0x11),
          },
        };
      }
      return {
        result: {
          agent: "Agent2",
          action: "arbitrage",
          ipfs_cid: "bafytrace2",
          published_at: 1700010000n,
          trace_hash: new Uint8Array(32).fill(0x22),
        },
      };
    },
  };

  const backendTraces: ReasoningTrace[] = [
    {
      id: "b1",
      onChainTraceId: "1",
      agentId: "ag1",
      marketId: "m1",
      action: "predict",
      ipfsCid: "bafytrace1",
      traceHash: hash1,
      verified: true,
      probabilityEstimate: 0.6,
      edge: 0.1,
      confidence: 0.8,
      createdAt: new Date().toISOString(),
    },
  ];

  it("runs bounded concurrency verification and produces completed audit summary", async () => {
    // Mock fetchImpl returning the exact bytes for trace 1
    const mockContent1 = { reasoning: "Market looks bullish based on on-chain data." };
    const contentBytes1 = new TextEncoder().encode(JSON.stringify(mockContent1));

    // Calculate sha256 to match or mismatch
    const mockFetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("bafytrace1")) {
        return new Response(contentBytes1, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const progressReports: string[] = [];

    const result = await runMarketTraceAudit({
      onChainMarketId: 1,
      concurrency: 2,
      client: mockClient,
      backendTraces,
      fetchImpl: mockFetch,
      onProgress: (prog) => {
        progressReports.push(prog.phase);
      },
    });

    expect(result.cancelled).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(progressReports).toContain("enumerating");
    expect(progressReports).toContain("completed");
    expect(result.summary.onChainCount).toBe(2);
  });

  it("handles cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted

    const result = await runMarketTraceAudit({
      onChainMarketId: 1,
      client: mockClient,
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
  });

  it("preserves already verified items on resume", async () => {
    const existingMap = new Map<string, AuditedTraceItem>();
    existingMap.set("1", {
      onChainTraceId: "1",
      index: 0,
      agent: "Agent1",
      action: "predict",
      ipfsCid: "bafytrace1",
      publishedAt: 1700000000000,
      onChainHash: hash1,
      computedHash: hash1,
      status: "verified",
      disagreements: [],
      isCriticalDisagreement: false,
    });

    const result = await runMarketTraceAudit({
      onChainMarketId: 1,
      client: mockClient,
      existingItems: existingMap,
    });

    const item1 = result.items.find((i) => i.onChainTraceId === "1");
    expect(item1?.status).toBe("verified");
    expect(item1?.computedHash).toBe(hash1);
  });
});
