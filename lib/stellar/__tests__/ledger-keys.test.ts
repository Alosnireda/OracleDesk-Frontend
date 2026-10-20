import { describe, expect, it } from "vitest";
import { Address, xdr } from "@stellar/stellar-sdk";
import { marketCore } from "../clients";
import { contractDataKey, dataKeyName, dataKeyScVal, marketKey, positionKey } from "../ledger-keys";

// A stable contract id so the pinned base64 below does not depend on env.
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const HOLDER = "GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF";

const MARKET_0_KEY = "AAAABgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAABAAAAAgAAAA8AAAAGTWFya2V0AAAAAAAFAAAAAAAAAAAAAAAB";
const MARKET_42_KEY = "AAAABgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAABAAAAAgAAAA8AAAAGTWFya2V0AAAAAAAFAAAAAAAAACoAAAAB";
const MARKET_MAX_KEY = "AAAABgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAABAAAAAgAAAA8AAAAGTWFya2V0AAAAAAAF//////////8AAAAB";
const POSITION_7_KEY = "AAAABgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAABAAAAAwAAAA8AAAAIUG9zaXRpb24AAAAFAAAAAAAAAAcAAAASAAAAAAAAAACZ+1NxAMIkKCsz3gJivbHBKzCQv4NO65CO4FtInwosKwAAAAE=";
const DATA_KEY_MARKET_0 = "AAAAEAAAAAEAAAACAAAADwAAAAZNYXJrZXQAAAAAAAUAAAAAAAAAAA==";

const spec = marketCore().spec;

describe("market-core ledger keys", () => {
  it("encodes DataKey::Market through the binding spec", () => {
    expect(dataKeyScVal(spec, { tag: "Market", values: [0n] }).toXDR("base64")).toBe(DATA_KEY_MARKET_0);
    expect(dataKeyName(dataKeyScVal(spec, { tag: "Market", values: [0n] }))).toBe("Market");
  });

  it("pins Market(0), Market(42) and Market(u64::MAX)", () => {
    expect(marketKey(spec, 0n, CONTRACT).toXDR("base64")).toBe(MARKET_0_KEY);
    expect(marketKey(spec, 42n, CONTRACT).toXDR("base64")).toBe(MARKET_42_KEY);
    expect(marketKey(spec, 18_446_744_073_709_551_615n, CONTRACT).toXDR("base64")).toBe(MARKET_MAX_KEY);
  });

  it("encodes a Position key with the holder address", () => {
    expect(positionKey(spec, 7n, HOLDER, CONTRACT).toXDR("base64")).toBe(POSITION_7_KEY);
  });

  it("uses the requested contract and persistent durability", () => {
    const key = marketKey(spec, 42n, CONTRACT);
    expect(key.switch().name).toBe("contractData");
    expect(key.contractData().durability().name).toBe("persistent");
    expect(key.contractData().contract().toXDR("base64")).toBe(
      new Address(CONTRACT).toScAddress().toXDR("base64"),
    );
  });

  it("returns null for non-DataKey ScVals", () => {
    expect(dataKeyName(xdr.ScVal.scvSymbol("Market"))).toBeNull();
    expect(dataKeyName(contractDataKey(CONTRACT, xdr.ScVal.scvSymbol("x")).contractData().key())).toBeNull();
  });
});
