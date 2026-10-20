import { bytesToHex } from "./typed-call";
import { normalizeHash, raceGateways, type RaceOptions } from "./trace-core";
import { IPFS_GATEWAYS, DEFAULT_IPFS_MAX_TRACE_BYTES } from "./config";
import { canonicalBytes, questionHash } from "./market-create";
import { sha256Hex } from "./trace";

export type QuestionIntegrityStatus = "verified" | "mismatch" | "unavailable" | "not-committed";

export interface QuestionIntegrityCheck {
  status: QuestionIntegrityStatus;
  displayedQuestion: string;
  committedQuestion: string | null;
  committedHash: string | null;
  computedHash: string | null;
  reason?: string;
  metaUri?: string | null;
}

export interface MarketQuestionCheckInput {
  displayedQuestion: string;
  metaUri?: string | null;
  questionHash?: Buffer | Uint8Array | string | null;
  gateways?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Check if a hash is empty, undefined, or all zeroes (32-byte zero buffer or 64 zero hex chars). */
export function isZeroOrEmptyHash(hash: Buffer | Uint8Array | string | null | undefined): boolean {
  if (!hash) return true;
  if (typeof hash === "string") {
    const clean = normalizeHash(hash);
    return clean.length === 0 || /^0{64}$/.test(clean);
  }
  // Buffer or Uint8Array
  if (hash.length === 0) return true;
  for (let i = 0; i < hash.length; i++) {
    if (hash[i] !== 0) return false;
  }
  return true;
}

export function formatHashHex(hash: Buffer | Uint8Array | string | null | undefined): string | null {
  if (!hash || isZeroOrEmptyHash(hash)) return null;
  if (typeof hash === "string") return normalizeHash(hash);
  return bytesToHex(hash);
}

// In-memory cache for fast repeated lookups across market lists
const questionCheckCache = new Map<string, QuestionIntegrityCheck>();

export function getCachedQuestionCheck(cacheKey: string): QuestionIntegrityCheck | undefined {
  return questionCheckCache.get(cacheKey);
}

export function setCachedQuestionCheck(cacheKey: string, result: QuestionIntegrityCheck): void {
  questionCheckCache.set(cacheKey, result);
}

export function clearQuestionCheckCache(): void {
  questionCheckCache.clear();
}

/**
 * Verifies that the displayed market question text matches the on-chain question_hash.
 *
 * 1. Checks on-chain question_hash commitment (if zero/empty -> "not-committed")
 * 2. Fetches the committed question document from meta_uri (via IPFS gateways)
 * 3. Hashes the received bytes and compares against question_hash
 * 4. Extracts the canonical question text from the document and compares with displayedQuestion
 *
 * Degrades clearly into:
 * - "verified": document matches on-chain question_hash AND displayed text matches document text
 * - "mismatch": document hash doesn't match question_hash OR displayed text doesn't match committed text
 * - "unavailable": IPFS gateway down, dry-run market, or meta_uri unreachable
 * - "not-committed": market was created without an on-chain question_hash commitment
 */
export async function verifyMarketQuestion(input: MarketQuestionCheckInput): Promise<QuestionIntegrityCheck> {
  const displayedQuestion = input.displayedQuestion.trim();
  const committedHash = formatHashHex(input.questionHash);

  // 1. Check if hash was committed on-chain
  if (!committedHash) {
    return {
      status: "not-committed",
      displayedQuestion,
      committedQuestion: null,
      committedHash: null,
      computedHash: null,
      reason: "No on-chain question commitment (question_hash is empty or zero)",
      metaUri: input.metaUri ?? null,
    };
  }

  // 2. Check metadata URI
  const metaUri = input.metaUri?.trim();
  if (!metaUri) {
    return {
      status: "unavailable",
      displayedQuestion,
      committedQuestion: null,
      committedHash,
      computedHash: null,
      reason: "No metadata URI (meta_uri is empty)",
      metaUri: null,
    };
  }

  // 3. Fetch from IPFS gateways
  const gateways = input.gateways ?? IPFS_GATEWAYS;
  let rawBytes: Uint8Array | undefined;
  let computedHash: string | null = null;

  try {
    const raceOpts: RaceOptions = {
      cid: metaUri,
      onChainHash: committedHash,
      gateways,
      maxBytes: DEFAULT_IPFS_MAX_TRACE_BYTES,
      timeoutMs: input.timeoutMs ?? 5_000,
      fetchImpl: input.fetchImpl,
    };

    const result = await raceGateways(raceOpts);
    if (result.bytes && result.check.status === "verified") {
      rawBytes = result.bytes;
      computedHash = result.check.computedHash;
    } else if (result.check.status === "mismatch") {
      computedHash = result.check.computedHash;
      return {
        status: "mismatch",
        displayedQuestion,
        committedQuestion: null,
        committedHash,
        computedHash,
        reason: "IPFS document hash does not match on-chain question_hash",
        metaUri,
      };
    } else {
      // unavailable
      return {
        status: "unavailable",
        displayedQuestion,
        committedQuestion: null,
        committedHash,
        computedHash: null,
        reason: result.check.reason ?? "IPFS gateway unreachable or document unavailable",
        metaUri,
      };
    }
  } catch (err) {
    return {
      status: "unavailable",
      displayedQuestion,
      committedQuestion: null,
      committedHash,
      computedHash: null,
      reason: err instanceof Error ? err.message : "Failed to fetch question document",
      metaUri,
    };
  }

  // 4. Parse document and check canonical bytes & question text
  let doc: unknown;
  try {
    const text = new TextDecoder().decode(rawBytes);
    doc = JSON.parse(text);
  } catch {
    // Plain text document fallback
    const committedQuestion = new TextDecoder().decode(rawBytes).trim();
    const textMatches = committedQuestion === displayedQuestion;
    return {
      status: textMatches ? "verified" : "mismatch",
      displayedQuestion,
      committedQuestion,
      committedHash,
      computedHash,
      reason: textMatches ? undefined : "Committed text does not match displayed text",
      metaUri,
    };
  }

  if (typeof doc !== "object" || doc === null) {
    return {
      status: "mismatch",
      displayedQuestion,
      committedQuestion: null,
      committedHash,
      computedHash,
      reason: "IPFS document is not a valid JSON object",
      metaUri,
    };
  }

  const docRecord = doc as Record<string, unknown>;
  const committedQuestion = String(docRecord.question ?? docRecord.title ?? docRecord.text ?? "").trim();

  // If rawBytes hash didn't match directly, check canonical questionHash(doc)
  if (computedHash !== committedHash) {
    const canonicalDocHash = await questionHash(docRecord);
    if (canonicalDocHash === committedHash) {
      computedHash = canonicalDocHash;
    } else {
      return {
        status: "mismatch",
        displayedQuestion,
        committedQuestion,
        committedHash,
        computedHash,
        reason: "Canonical question document hash does not match on-chain commitment",
        metaUri,
      };
    }
  }

  // Compare question text
  if (committedQuestion.toLowerCase() !== displayedQuestion.toLowerCase()) {
    return {
      status: "mismatch",
      displayedQuestion,
      committedQuestion,
      committedHash,
      computedHash,
      reason: "Displayed question differs from canonical on-chain commitment",
      metaUri,
    };
  }

  return {
    status: "verified",
    displayedQuestion,
    committedQuestion,
    committedHash,
    computedHash,
    metaUri,
  };
}
