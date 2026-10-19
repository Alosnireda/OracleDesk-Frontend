import { describe, expect, it } from "vitest";
import { mapLimit, mergeAgentSources, sortAgentRows, type AgentObservation } from "../useAgents";

const A = "GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF";
const B = "GD2NB2VUME7ECMHFHQN5M3KUZLLJF3R6Z4OFCBLE4SJNHIQHITRPQGHQ";
const C = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("mergeAgentSources", () => {
  it("dedupes addresses and unions their sources", () => {
    const observations: AgentObservation[] = [
      { address: A, source: "event:registered" },
      { address: A, source: "event:published", trace: { id: "1", publishedAt: 100 } },
      { address: B, source: "deployments" },
      { address: B, source: "env" },
    ];
    const rows = mergeAgentSources(observations);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.address === A)?.sources.sort()).toEqual(["event:published", "event:registered"]);
    expect(rows.find((row) => row.address === B)?.sources.sort()).toEqual(["deployments", "env"]);
    expect(rows.find((row) => row.address === B)?.tracesInWindow).toBe(0);
  });

  it("counts published traces and keeps the newest publish and its trace id", () => {
    const rows = mergeAgentSources([
      { address: A, source: "event:published", trace: { id: "5", publishedAt: 500 } },
      { address: A, source: "event:published", trace: { id: "9", publishedAt: 900 } },
      { address: A, source: "event:published", trace: { id: "7", publishedAt: 700 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tracesInWindow: 3, lastPublishedAt: 900, lastTraceId: "9" });
  });

  it("keeps configured agents that have no events", () => {
    const rows = mergeAgentSources([
      { address: A, source: "deployments" },
      { address: C, source: "env" },
    ]);
    expect(rows.map((row) => row.address).sort()).toEqual([A, C].sort());
  });

  it("applies live registration status, including false and unknown", () => {
    const rows = mergeAgentSources(
      [
        { address: A, source: "event:registered" },
        { address: B, source: "event:registered" },
        { address: C, source: "env" },
      ],
      new Map([[A, true], [B, false], [C, null]]),
    );
    expect(rows.find((row) => row.address === A)?.registered).toBe(true);
    expect(rows.find((row) => row.address === B)?.registered).toBe(false);
    expect(rows.find((row) => row.address === C)?.registered).toBeNull();
  });

  it("sorts registered first, then newest publish", () => {
    const rows = sortAgentRows([
      { address: A, sources: ["env"], registered: false, tracesInWindow: 0, lastPublishedAt: 900, lastTraceId: "9" },
      { address: B, sources: ["event:registered"], registered: true, tracesInWindow: 2, lastPublishedAt: 100, lastTraceId: "1" },
      { address: C, sources: ["event:registered"], registered: true, tracesInWindow: 1, lastPublishedAt: 500, lastTraceId: "5" },
    ]);
    expect(rows.map((row) => row.address)).toEqual([C, B, A]);
  });
});

describe("mapLimit", () => {
  it("never exceeds the concurrency limit and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, (8 - value) * 2));
      active -= 1;
      return value * 10;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });
});
