import type { ContractName } from "@/lib/stellar/errors";

/** One simulation or submission, as recorded for the debug panel. No XDR, no secrets. */
export interface SimRecord {
  at: number;
  contract: ContractName | "usdc";
  method: string;
  latestLedger?: number;
  readEntries?: number;
  writeEntries?: number;
  minResourceFee?: string;
  error?: string;
  txHash?: string | null;
}

const MAX = 50;
let buffer: SimRecord[] = [];
const listeners = new Set<() => void>();

/** Keeps the last 50. Never throws into the caller. */
export function recordSimulation(r: SimRecord): void {
  try {
    buffer = [...buffer, r].slice(-MAX);
    for (const fn of listeners) fn();
  } catch {
    // diagnostics only
  }
}

export function snapshot(): readonly SimRecord[] {
  return buffer;
}

export function subscribeSimulations(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test helper. */
export function resetSimulations(): void {
  buffer = [];
}
