import { describe, expectTypeOf, it } from "vitest";
import type { Client as MarketCoreClient } from "../generated/market-core";
import type { Client as ReasoningRegistryClient } from "../generated/reasoning-registry";
import { marketCore, reasoningRegistry } from "../clients";

/**
 * The factories cast a base contract.Client (built from the cached spec) to the
 * generated Client type. These assertions fail at typecheck if a generated
 * method's signature diverges from the factory's public surface. `fromJSON` is
 * intentionally excluded: no call site in this repo deserialises assembled
 * transactions with it; every call uses a spec-installed method.
 */
describe("client factory types", () => {
  it("keeps generated market-core method types on cached and signer-bound clients", () => {
    type Factory = ReturnType<typeof marketCore>;
    expectTypeOf<Factory>().not.toBeAny();
    expectTypeOf<Factory["buy"]>().toEqualTypeOf<MarketCoreClient["buy"]>();
    expectTypeOf<Factory["sell"]>().toEqualTypeOf<MarketCoreClient["sell"]>();
    expectTypeOf<Factory["redeem"]>().toEqualTypeOf<MarketCoreClient["redeem"]>();
    expectTypeOf<Factory["market_count"]>().toEqualTypeOf<MarketCoreClient["market_count"]>();
    expectTypeOf<Factory["get_market"]>().toEqualTypeOf<MarketCoreClient["get_market"]>();
    expectTypeOf<Factory["get_position"]>().toEqualTypeOf<MarketCoreClient["get_position"]>();
    expectTypeOf<Factory["quote_buy"]>().toEqualTypeOf<MarketCoreClient["quote_buy"]>();
    expectTypeOf<Factory["get_config"]>().toEqualTypeOf<MarketCoreClient["get_config"]>();
  });

  it("keeps generated reasoning-registry method types", () => {
    type Factory = ReturnType<typeof reasoningRegistry>;
    expectTypeOf<Factory>().not.toBeAny();
    expectTypeOf<Factory["is_registered"]>().toEqualTypeOf<ReasoningRegistryClient["is_registered"]>();
    expectTypeOf<Factory["register_agent"]>().toEqualTypeOf<ReasoningRegistryClient["register_agent"]>();
    expectTypeOf<Factory["unregister_agent"]>().toEqualTypeOf<ReasoningRegistryClient["unregister_agent"]>();
    expectTypeOf<Factory["trace_count"]>().toEqualTypeOf<ReasoningRegistryClient["trace_count"]>();
    expectTypeOf<Factory["get_trace"]>().toEqualTypeOf<ReasoningRegistryClient["get_trace"]>();
  });
});
