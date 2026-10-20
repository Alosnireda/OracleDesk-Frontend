import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPaginationMeta, type ReasoningTrace } from "@/lib/api/traces";
import { diffHead, mergeTracePages } from "@/lib/hooks/trace-feed";

/** Strings the reasoning feed used to ship as fabricated UI content. */
const FABRICATED = [
  "124 TPS",
  "Inference Logs",
  "extraLogs",
  "Fetching market data",
  "Model divergence",
  "Node heartbeat",
  "TRACE_ID: 0x9f",
  "Inference models suggest a significant edge",
  "multi-model consensus",
  "Market Liquidity",
  "Social Sentiment",
  "Historical Correlation",
  "L3 cross-chain",
  "WETH/USDC",
];

describe("app/reasoning/page.tsx contains no fabricated data", () => {
  const source = readFileSync(join(process.cwd(), "app/reasoning/page.tsx"), "utf8");

  it.each(FABRICATED)("does not render %j", (snippet) => {
    expect(source).not.toContain(snippet);
  });

  it("reads traces from the infinite feed hook", () => {
    expect(source).toContain("useInfiniteTraces");
    expect(source).toContain("mergeTracePages");
  });
});

const trace = (id: string): ReasoningTrace => ({
  id,
  marketId: `market-${id}`,
  agentType: "TRADER",
  decisionType: "BUY",
  edge: 0.05,
  probabilityEstimate: 0.6,
  marketProbability: 0.55,
  confidenceInterval: { lower: 0.5, upper: 0.7 },
  verified: true,
  ipfsCid: null,
  previewSources: null,
  market: { question: "Q", category: "FED", settlementCurrency: "USDC" },
  createdAt: "2026-01-01T00:00:00Z",
});

describe("mergeTracePages", () => {
  it("flattens pages in order and drops duplicate ids", () => {
    const merged = mergeTracePages([[trace("a"), trace("b")], [trace("b"), trace("c")]]);
    expect(merged.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty feed for no pages", () => {
    expect(mergeTracePages([])).toEqual([]);
    expect(mergeTracePages([[]])).toEqual([]);
  });

  it("is deterministic and does not mutate its input", () => {
    const pages = [[trace("a")], [trace("b")]];
    const merged = mergeTracePages(pages);
    expect(mergeTracePages(pages)).toEqual(merged);
    expect(pages[0]).toHaveLength(1);
  });
});

describe("diffHead", () => {
  it("lists ids that fell off the newest-first head", () => {
    const previous = [trace("gone-1"), trace("gone-2"), trace("kept")];
    const current = [trace("kept"), trace("new")];
    expect(diffHead(previous, current)).toEqual(["gone-1", "gone-2"]);
  });

  it("returns nothing when the head is unchanged", () => {
    expect(diffHead([trace("a")], [trace("a"), trace("b")])).toEqual([]);
    expect(diffHead([], [trace("a")])).toEqual([]);
  });
});

describe("isPaginationMeta", () => {
  it("accepts a complete meta object and rejects anything else", () => {
    expect(isPaginationMeta({ page: 1, limit: 20, total: 40, totalPages: 2 })).toBe(true);
    expect(isPaginationMeta(undefined)).toBe(false);
    expect(isPaginationMeta(null)).toBe(false);
    expect(isPaginationMeta({ page: 1 })).toBe(false);
    expect(isPaginationMeta("meta")).toBe(false);
  });
});
