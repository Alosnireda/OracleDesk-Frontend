/**
 * Minimal CID parsing, enough to check a trace's bytes against its CID without
 * a dependency. Only the case the backend produces is checkable: a CIDv1 with
 * the raw codec and a sha2-256 multihash over the whole block (Pinata with
 * cidVersion 1 and single-block files). Anything else is reported as
 * "unsupported" rather than guessed at. See https://github.com/multiformats/cid.
 */

export type CidCheck = "match" | "mismatch" | "unsupported" | "invalid";

export interface ParsedCid {
  version: 0 | 1;
  codec: number;
  hashCode: number;
  digest: Uint8Array;
}

const RAW_CODEC = 0x55;
const SHA2_256_CODE = 0x12;
const SHA2_256_LENGTH = 32;
const DAG_PB_CODEC = 0x70;

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase32(input: string): Uint8Array | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function decodeBase58(input: string): Uint8Array | null {
  let value = 0n;
  for (const char of input) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  // Leading '1' characters are leading zero bytes.
  for (const char of input) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Unsigned LEB128 varint, as used by multiformats. Returns the value and the next offset. */
function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  for (let i = offset; i < bytes.length && i < offset + 9; i++) {
    value += (bytes[i] & 0x7f) * 2 ** shift;
    if ((bytes[i] & 0x80) === 0) return { value, next: i + 1 };
    shift += 7;
  }
  return null;
}

/** Parses a bare CID string (no ipfs:// prefix, no path). Returns null when it isn't a well-formed CID. */
export function parseCid(cid: string): ParsedCid | null {
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) {
    const bytes = decodeBase58(cid);
    if (!bytes || bytes.length !== 34 || bytes[0] !== SHA2_256_CODE || bytes[1] !== SHA2_256_LENGTH) return null;
    return { version: 0, codec: DAG_PB_CODEC, hashCode: SHA2_256_CODE, digest: bytes.slice(2) };
  }
  if (!cid.startsWith("b")) return null;
  const bytes = decodeBase32(cid.slice(1));
  if (!bytes) return null;
  const version = readVarint(bytes, 0);
  if (!version || version.value !== 1) return null;
  const codec = readVarint(bytes, version.next);
  if (!codec) return null;
  const hashCode = readVarint(bytes, codec.next);
  if (!hashCode) return null;
  const length = readVarint(bytes, hashCode.next);
  if (!length || length.value > bytes.length - length.next) return null;
  if (length.next + length.value !== bytes.length) return null;
  return {
    version: 1,
    codec: codec.value,
    hashCode: hashCode.value,
    digest: bytes.slice(length.next),
  };
}

/**
 * Compares the CID's digest with the sha256 of the bytes that were served.
 * "invalid" means the string isn't a CID at all; "unsupported" means it's a
 * CID kind this check can't verify (for example dag-pb, used for multi-block files).
 */
export function cidDigestCheck(cid: string, bytesSha256Hex: string): CidCheck {
  const parsed = parseCid(cid);
  if (!parsed) return "invalid";
  if (parsed.version !== 1 || parsed.codec !== RAW_CODEC || parsed.hashCode !== SHA2_256_CODE) return "unsupported";
  if (parsed.digest.length !== SHA2_256_LENGTH) return "unsupported";
  const digestHex = Array.from(parsed.digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return digestHex === bytesSha256Hex ? "match" : "mismatch";
}
