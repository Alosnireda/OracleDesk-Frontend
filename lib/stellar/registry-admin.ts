import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { rpcServer } from "./clients";
import { CONTRACTS } from "./config";

/**
 * Reads a value from a contract's instance storage. Soroban has no generic
 * "get instance value" RPC method, so this uses getLedgerEntries on the
 * contract-instance ledger key. Returns null when the entry or key is absent.
 */
export async function readInstanceValue(
  contractId: string,
  keyName: string,
  server = rpcServer(),
): Promise<unknown | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const response = await server.getLedgerEntries(key);
  const entry = response.entries[0];
  if (!entry) return null;
  const value = entry.val.contractData().val();
  if (value.switch().name !== "scvContractInstance") return null;
  const storage = value.instance().storage();
  if (!storage) return null;
  for (const item of storage) {
    const itemKey = item.key();
    if (itemKey.switch().name !== "scvSymbol" || itemKey.sym().toString() !== keyName) continue;
    return scValToNative(item.val());
  }
  return null;
}

/** The reasoning registry's admin address, or null if it cannot be read. */
export async function readRegistryAdmin(server = rpcServer()): Promise<string | null> {
  const value = await readInstanceValue(CONTRACTS.reasoningRegistry, "Admin", server);
  return typeof value === "string" ? value : null;
}
