import { sha256Hex } from "./trace";

/**
 * Deterministic canonicalization shared with the backend's canonicalBytes
 * (src/utils/hash.util.ts): object keys sorted recursively, bigints as
 * strings, Dates as ISO strings, undefined values dropped, no whitespace.
 * Both sides must hash identical bytes for a given question document.
 */
export function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = canonicalize((value as Record<string, unknown>)[key]);
      if (entry !== undefined) sorted[key] = entry;
    }
    return sorted;
  }
  return value;
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalize(value)));
}

/** sha256 of the canonical bytes of a question document, as lowercase hex. */
export async function questionHash(doc: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalBytes(doc));
}
