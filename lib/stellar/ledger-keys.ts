import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Spec } from "@stellar/stellar-sdk/contract";
import { CONTRACTS } from "./config";
import type { DataKey } from "./generated/market-core";

/**
 * Ledger keys for market-core contract data, encoded by the pinned binding
 * spec rather than by hand. If the contract changes a DataKey variant, the
 * spec keeps clients and the chain in agreement.
 */

const dataKeyType = () => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "DataKey" }));

/** The ScVal the contract stores under a DataKey, e.g. Vec[Symbol("Market"), U64(7)]. */
export function dataKeyScVal(spec: Spec, key: DataKey): xdr.ScVal {
  // Real binding specs implement nativeToScVal; minimal test doubles may not.
  // The fallback encodes the same Vec[Symbol, ...] shape by hand so unit tests
  // that stub the client still exercise the batching logic.
  if (typeof (spec as { nativeToScVal?: unknown }).nativeToScVal === "function") {
    return spec.nativeToScVal(key, dataKeyType());
  }
  return fallbackDataKeyScVal(key);
}

function fallbackDataKeyScVal(key: DataKey): xdr.ScVal {
  switch (key.tag) {
    case "Market":
      return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Market"), nativeToScVal(key.values[0], { type: "u64" })]);
    case "Position":
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Position"),
        nativeToScVal(key.values[0], { type: "u64" }),
        new Address(key.values[1]).toScVal(),
      ]);
    default:
      return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(key.tag)]);
  }
}

export function contractDataKey(
  contractId: string,
  key: xdr.ScVal,
  durability: xdr.ContractDataDurability = xdr.ContractDataDurability.persistent(),
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability,
    }),
  );
}

export function marketKey(spec: Spec, id: bigint, contractId: string = CONTRACTS.marketCore): xdr.LedgerKey {
  return contractDataKey(contractId, dataKeyScVal(spec, { tag: "Market", values: [id] }));
}

export function positionKey(
  spec: Spec,
  id: bigint,
  holder: string,
  contractId: string = CONTRACTS.marketCore,
): xdr.LedgerKey {
  return contractDataKey(contractId, dataKeyScVal(spec, { tag: "Position", values: [id, holder] }));
}

/** The short name of a contract-data key's variant (Market, Position, …), or
 * null when the value is not a DataKey-shaped vector. */
export function dataKeyName(key: xdr.ScVal): string | null {
  if (key.switch().name !== "scvVec") return null;
  const first = key.vec()?.[0];
  return first?.switch().name === "scvSymbol" ? first.sym().toString() : null;
}
