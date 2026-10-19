import { xdr } from "@stellar/stellar-sdk";
import { marketCore } from "./clients";
import { CONTRACTS } from "./config";
import { marketKey, positionKey } from "./ledger-keys";
import type { Settlement } from "./generated/fpmm";
import type { Market, Position } from "./generated/market-core";

/**
 * Ledger-entry plumbing shared by the redeem-all discovery scan
 * (lib/stellar/redeem-all.ts) and the "my positions" scan
 * (lib/stellar/my-positions.ts): building the two persistent contract-data
 * keys, batching getLedgerEntries calls, and decoding the Position/Market
 * UDTs back out of raw ScVals.
 */

/** getLedgerEntries accepts at most this many keys per RPC call. */
export const LEDGER_ENTRY_CHUNK_SIZE = 200;

export function marketLedgerKey(marketId: bigint): xdr.LedgerKey {
  return marketKey(marketCore().spec, marketId, CONTRACTS.marketCore);
}

export function positionLedgerKey(marketId: bigint, holder: string): xdr.LedgerKey {
  return positionKey(marketCore().spec, marketId, holder, CONTRACTS.marketCore);
}

export function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size));
  return output;
}

export function readUdt<T>(name: string, scVal: xdr.ScVal): T {
  const type = xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
  return marketCore().spec.scValToNative<T>(scVal, type);
}

export function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return typeof position.yes === "bigint" && typeof position.no === "bigint";
}

export function isMarket(value: unknown): value is Market {
  if (!value || typeof value !== "object") return false;
  const market = value as Record<string, unknown>;
  const status = market.status;
  const validStatus =
    (Array.isArray(status) && ["Open", "Resolved", "Void"].includes(String(status[0]))) ||
    Boolean(status && typeof status === "object" && "tag" in status &&
      ["Open", "Resolved", "Void"].includes(String((status as { tag: unknown }).tag)));
  return (
    typeof market.close_time === "bigint" &&
    typeof market.sets_minted === "bigint" &&
    typeof market.reserve_yes === "bigint" &&
    typeof market.reserve_no === "bigint" &&
    validStatus
  );
}

export function settlementOf(status: Market["status"]): Settlement | null {
  const parts = Array.isArray(status)
    ? status
    : status && typeof status === "object" && "tag" in status
      ? [status.tag, ...("values" in status && Array.isArray(status.values) ? status.values : [])]
      : [];
  if (parts[0] === "Void") return "void";
  if (parts[0] !== "Resolved") return null;
  const outcome = parts[1];
  const tag =
    typeof outcome === "string"
      ? outcome
      : Array.isArray(outcome)
        ? outcome[0]
        : outcome && typeof outcome === "object" && "tag" in outcome
          ? outcome.tag
          : null;
  if (tag === "Yes") return "yes";
  if (tag === "No") return "no";
  return null;
}
