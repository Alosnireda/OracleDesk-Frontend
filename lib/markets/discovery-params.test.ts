import { describe, expect, it } from "vitest";
import { DEFAULTS, parseDiscovery, serializeDiscovery, type DiscoveryState } from "./discovery-params";

const roundTrip = (s: DiscoveryState) => parseDiscovery(new URLSearchParams(serializeDiscovery(s)));

describe("discovery params", () => {
  it("omits defaults from the URL", () => {
    expect(serializeDiscovery(DEFAULTS)).toBe("");
  });

  it("round trips a full state in a stable key order", () => {
    const state: DiscoveryState = { q: "fed cut", status: "RESOLVED", category: "FED", sort: "close-asc" };
    expect(serializeDiscovery(state)).toBe("q=fed+cut&status=RESOLVED&category=FED&sort=close-asc");
    expect(roundTrip(state)).toEqual(state);
  });

  it("keeps status ALL distinct from the default", () => {
    expect(roundTrip({ ...DEFAULTS, status: "ALL" }).status).toBe("ALL");
  });

  it("ignores unknown values", () => {
    expect(parseDiscovery(new URLSearchParams("status=NOPE&category=WEATHER&sort=random"))).toEqual(DEFAULTS);
  });

  it("trims and limits the search query", () => {
    expect(parseDiscovery(new URLSearchParams(`q=${"a".repeat(150)}`)).q).toHaveLength(100);
    expect(parseDiscovery(new URLSearchParams("q=%20btc%20")).q).toBe("btc");
  });
});
