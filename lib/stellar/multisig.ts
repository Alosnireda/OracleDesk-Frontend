import {
  FeeBumpTransaction,
  Keypair,
  SignerKey,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";

/**
 * On-ledger multisig configuration for a classic Stellar account.
 *
 * `thresholds` on the ledger are 4 bytes: [masterWeight, low, med, high].
 * `signers` lists the additional signers from the AccountEntry; the master
 * key itself is included as an `ed25519` entry with `masterWeight` so UI
 * weight math has a single list to work from.
 */
export interface MultisigSigner {
  /** StrKey-encoded signer (G…/T…/X…/P… via SignerKey encoding). */
  key: string;
  weight: number;
  type: "ed25519" | "preAuthTx" | "hashX" | "signedPayload";
}

export interface AccountAuth {
  masterWeight: number;
  low: number;
  med: number;
  high: number;
  signers: MultisigSigner[];
  /** Current account sequence (ledger `seqNum`), as bigint. */
  sequence: bigint;
}

/** Public-only session persisted while co-signers collect signatures. */
export interface MultisigSession {
  id: string;
  kind: "buy" | "sell" | "redeem" | "transfer";
  /** Base64 transaction envelope XDR (unsigned or partially signed). */
  xdr: string;
  /** Lowercase hex transaction hash. */
  hash: string;
  builtAt: number;
  /** Unix seconds from `timeBounds.maxTime`. Compared against ledger close time. */
  maxTime: number;
  sourceAccount: string;
  /** Transaction sequence (string, as in `built.sequence`). */
  sequence: string;
  fee: string;
  contractId: string;
  fn: string;
  requiredThreshold: number;
  auth: AccountAuth;
  /** Ledger the quote/simulation was taken at, for staleness warnings. */
  quoteLedger?: number;
  ledgerSequence?: number;
  /** Addresses (other than the source) that must sign auth entries, if any. */
  nonInvoker: string[];
  /** Unix seconds of the market `close_time`, when known (buy/sell). */
  closeTime?: number;
  /** Human-readable decoded args for the review UI (raw strings). */
  args?: Record<string, string>;
}

export const MULTISIG_SESSIONS_KEY = "oracledesk_multisig_sessions";
/** Default validity window for multisig prepares (1 hour). */
export const MULTISIG_DEFAULT_TIMEOUT_S = 3600;
/** Default slippage for the long-lived multisig window (3%). */
export const MULTISIG_DEFAULT_SLIPPAGE_BPS = 300;
/** Mean ledger close time on Stellar (~5s), used for auth-entry expiry math. */
export const LEDGER_CLOSE_S = 5;

function signerTypeFromKey(key: xdr.SignerKey): MultisigSigner["type"] {
  switch (key.switch().name) {
    case "signerKeyTypeEd25519":
      return "ed25519";
    case "signerKeyTypePreAuthTx":
      return "preAuthTx";
    case "signerKeyTypeHashX":
      return "hashX";
    case "signerKeyTypeEd25519SignedPayload":
      return "signedPayload";
    default:
      return "ed25519";
  }
}

/**
 * Reads a classic account's signers, thresholds and sequence via RPC
 * `getLedgerEntries` on the account key.
 */
export async function readAccountAuth(
  address: string,
  server: rpc.Server,
): Promise<AccountAuth> {
  const kp = Keypair.fromPublicKey(address);
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: kp.xdrPublicKey() }),
  );
  const res = await server.getLedgerEntries(key);
  const entries = (res as unknown as { entries?: unknown[] }).entries ?? [];
  if (!entries || entries.length === 0) {
    throw new Error(
      `Stellar account ${address} was not found. Fund it with XLM first.`,
    );
  }
  const raw = entries[0] as unknown as {
    val?: xdr.LedgerEntryData;
    xdr?: string;
  };
  let accountEntry: xdr.AccountEntry | null = null;
  if (raw.val && typeof (raw.val as xdr.LedgerEntryData).account === "function") {
    accountEntry = (raw.val as xdr.LedgerEntryData).account();
  } else if (typeof raw.xdr === "string") {
    accountEntry = xdr.LedgerEntryData.fromXDR(raw.xdr, "base64").account();
  }
  if (!accountEntry) {
    throw new Error(`Could not decode the account entry for ${address}.`);
  }
  const thresholds = accountEntry.thresholds();
  if (!thresholds || thresholds.length !== 4) {
    throw new Error(`The account entry for ${address} has invalid thresholds.`);
  }
  const [masterWeight, low, med, high] = [
    thresholds[0],
    thresholds[1],
    thresholds[2],
    thresholds[3],
  ];
  const signers: MultisigSigner[] = [];
  // The master key counts with masterWeight (possibly 0 when disabled).
  signers.push({ key: address, weight: masterWeight, type: "ed25519" });
  for (const s of accountEntry.signers() ?? []) {
    const sk = s.key();
    let encoded: string;
    try {
      encoded = SignerKey.encodeSignerKey(sk);
    } catch {
      continue;
    }
    signers.push({
      key: encoded,
      weight: s.weight(),
      type: signerTypeFromKey(sk),
    });
  }
  const sequence = BigInt(accountEntry.seqNum().toString());
  return { masterWeight, low, med, high, signers, sequence };
}

/**
 * The weight threshold the network enforces for OracleDesk's writes.
 *
 * An `invokeHostFunction` operation from a classic source account requires
 * the **medium** threshold, and Soroban address-credential authorization
 * (`SorobanAuthorizationEntry` with an address) on a classic account also
 * requires the account's **medium** threshold.
 *
 * Confirmed against:
 * - https://developers.stellar.org/docs/learn/encyclopedia/security/signatures-multisig
 *   ("Multi-signature operation thresholds": invokeHostFunction is a
 *   medium-threshold operation)
 * - https://developers.stellar.org/docs/learn/encyclopedia/security/authorization
 *   (Soroban address auth on a classic account is authorized at the
 *   account's medium threshold)
 */
export function requiredThreshold(
  _tx: Transaction,
  auth: AccountAuth,
): number {
  return auth.med;
}

/** Heuristic: an account needs the multisig path when it has extra signers or a raised medium threshold. */
export function isMultisigAccount(auth: AccountAuth): boolean {
  return auth.signers.length > 1 || auth.med > auth.masterWeight;
}

export interface WeightResult {
  weight: number;
  signedBy: string[];
  /** Signatures that match no ed25519 signer or fail verification. */
  unknown: number;
}

/**
 * Computes collected ed25519 weight for a (possibly partially signed)
 * transaction envelope.
 *
 * For each `DecoratedSignature`, the 4-byte hint is matched against the last
 * 4 bytes of each ed25519 signer key, then verified with
 * `Keypair.verify(tx.hash(), sig)`. Each signer counts once; duplicates
 * never double-count. Unknown or invalid signatures are tallied in
 * `unknown` (leaving them in causes `tx_bad_auth_extra` at submission, so
 * callers should offer to strip them).
 */
export function signatureWeight(
  tx: Transaction,
  auth: AccountAuth,
  networkPassphrase: string,
): WeightResult {
  if (
    networkPassphrase &&
    tx.networkPassphrase &&
    tx.networkPassphrase !== networkPassphrase
  ) {
    throw new Error(
      "The transaction was built for a different network passphrase.",
    );
  }
  const hash = tx.hash();
  const edSigners = auth.signers.filter((s) => s.type === "ed25519");
  const hintToKeys = new Map<string, string[]>();
  for (const s of edSigners) {
    try {
      const hint = Keypair.fromPublicKey(s.key).signatureHint().toString("hex");
      const list = hintToKeys.get(hint) ?? [];
      list.push(s.key);
      hintToKeys.set(hint, list);
    } catch {
      // A non-G signer key (shouldn't happen for ed25519) is skipped.
    }
  }
  const weightByKey = new Map(auth.signers.map((s) => [s.key, s.weight]));
  const signed = new Set<string>();
  let unknown = 0;
  for (const dec of tx.signatures ?? []) {
    const hintHex = Buffer.from(dec.hint()).toString("hex");
    const sigBytes = Buffer.from(dec.signature());
    const candidates = hintToKeys.get(hintHex) ?? [];
    let matched: string | null = null;
    for (const key of candidates) {
      if (signed.has(key)) {
        // Already counted; a second valid sig from the same key still counts once.
        // Treat an exact duplicate as matched so it isn't reported as unknown.
        try {
          if (Keypair.fromPublicKey(key).verify(hash, sigBytes)) {
            matched = key;
            break;
          }
        } catch {
          // fall through to unknown
        }
        continue;
      }
      try {
        if (Keypair.fromPublicKey(key).verify(hash, sigBytes)) {
          matched = key;
          break;
        }
      } catch {
        // Invalid key/signature pair; try the next candidate.
      }
    }
    if (matched) signed.add(matched);
    else unknown += 1;
  }
  let weight = 0;
  for (const key of signed) weight += weightByKey.get(key) ?? 0;
  return { weight, signedBy: [...signed], unknown };
}

/** Removes signatures that don't verify against any ed25519 signer (avoids `tx_bad_auth_extra`). */
export function stripUnknownSignatures(
  tx: Transaction,
  auth: AccountAuth,
  networkPassphrase: string,
): Transaction {
  const hash = tx.hash();
  const edSigners = auth.signers.filter((s) => s.type === "ed25519");
  const kept: xdr.DecoratedSignature[] = [];
  for (const dec of tx.signatures ?? []) {
    const hintHex = Buffer.from(dec.hint()).toString("hex");
    const sigBytes = Buffer.from(dec.signature());
    let ok = false;
    for (const s of edSigners) {
      try {
        const kp = Keypair.fromPublicKey(s.key);
        if (
          kp.signatureHint().toString("hex") === hintHex &&
          kp.verify(hash, sigBytes)
        ) {
          ok = true;
          break;
        }
      } catch {
        // ignore
      }
    }
    if (ok) kept.push(dec);
  }
  // Transaction setters are immutable (`set signatures` throws); mutate the
  // live array in place instead of assigning.
  tx.signatures.splice(0, tx.signatures.length, ...kept);
  void networkPassphrase;
  return tx;
}

function authEntriesOf(tx: Transaction): xdr.SorobanAuthorizationEntry[] {
  const op = (tx.operations?.[0] ?? null) as unknown as {
    auth?: xdr.SorobanAuthorizationEntry[];
  } | null;
  return op?.auth ?? [];
}

/**
 * Merges signatures from an imported (possibly partially signed) envelope
 * into the built transaction.
 *
 * - Rejects fee-bump envelopes (fee-bumps are a non-goal for multisig).
 * - Requires `imported.hash().equals(built.hash())`: the hash covers
 *   operations, fee, sequence, time bounds and Soroban data, so any change
 *   in fee, sequence, time bounds, footprint or quote-derived bounds is
 *   rejected.
 * - Unions signatures by (hint, signature) bytes; duplicates are ignored.
 * - Rejects envelopes whose Soroban auth entries differ from the built ones
 *   except for added signatures: each entry's `rootInvocation` XDR must
 *   match (credentials may gain signatures, the invocation may not change).
 */
export function mergeSigned(
  built: Transaction,
  importedXdr: string,
  networkPassphrase: string,
): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(importedXdr, networkPassphrase);
  } catch (err) {
    throw new Error(
      `Could not parse the imported XDR: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error(
      "Fee-bump envelopes are not supported for multisig. Export a plain transaction envelope instead.",
    );
  }
  const imported = parsed as Transaction;
  if (!imported.hash().equals(built.hash())) {
    throw new Error(
      "The imported transaction does not match the prepared one (operations, fee, sequence, time bounds or Soroban data changed). Ask every co-signer to sign the exact exported XDR.",
    );
  }
  const builtAuth = authEntriesOf(built);
  const importedAuth = authEntriesOf(imported);
  if (builtAuth.length !== importedAuth.length) {
    throw new Error(
      "The imported transaction has different authorization entries. Sign the exact exported XDR without modifying it.",
    );
  }
  for (let i = 0; i < builtAuth.length; i++) {
    const a = builtAuth[i].rootInvocation().toXDR("base64");
    const b = importedAuth[i].rootInvocation().toXDR("base64");
    if (a !== b) {
      throw new Error(
        "The imported transaction's authorization entries changed. Sign the exact exported XDR without modifying it.",
      );
    }
  }
  const seen = new Set(
    (built.signatures ?? []).map(
      (s) =>
        `${Buffer.from(s.hint()).toString("hex")}:${Buffer.from(s.signature()).toString("base64")}`,
    ),
  );
  for (const sig of imported.signatures ?? []) {
    const id = `${Buffer.from(sig.hint()).toString("hex")}:${Buffer.from(sig.signature()).toString("base64")}`;
    if (seen.has(id)) continue;
    seen.add(id);
    built.addDecoratedSignature(sig);
  }
  return built;
}

/** Ledger-sequence expiry for `signAuthEntries`: `currentLedger + ceil(windowS / 5)`. */
export function authExpirationLedger(
  currentLedgerSequence: number,
  validityWindowS: number,
): number {
  return (
    currentLedgerSequence + Math.max(1, Math.ceil(validityWindowS / LEDGER_CLOSE_S))
  );
}

/** True when the wall clock has passed `maxTime` (ledger close time governs on-chain; this is a UI approximation). */
export function isExpiredByWallClock(maxTime: number, nowMs = Date.now()): boolean {
  return Math.floor(nowMs / 1000) >= maxTime;
}

/** True when the ledger close time has passed `maxTime`. */
export function isExpiredByLedger(
  maxTime: number,
  latestLedgerCloseTime: number,
): boolean {
  return latestLedgerCloseTime >= maxTime;
}

/** Loads persisted multisig sessions (public data only). */
export function loadMultisigSessions(): MultisigSession[] {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return [];
    const raw = window.sessionStorage.getItem(MULTISIG_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MultisigSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMultisigSessions(sessions: MultisigSession[]): void {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(MULTISIG_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Storage may be disabled; coordination still works in-memory.
  }
}

export function upsertMultisigSession(session: MultisigSession): MultisigSession[] {
  const all = loadMultisigSessions();
  const next = [session, ...all.filter((s) => s.id !== session.id)].slice(0, 20);
  saveMultisigSessions(next);
  return next;
}

export function removeMultisigSession(id: string): MultisigSession[] {
  const next = loadMultisigSessions().filter((s) => s.id !== id);
  saveMultisigSessions(next);
  return next;
}

/**
 * Non-source authorization entries still unsigned on an assembled write.
 * For OracleDesk's buy/sell/redeem/USDC-transfer the trader/holder/from is
 * the source account, so this list is normally empty; a non-empty list (e.g.
 * a future treasury flow) must be signed out-of-band via `signAuthEntries`.
 */
export function nonInvokerAddresses(
  tx: AssembledTransaction<unknown>,
): string[] {
  try {
    return tx.needsNonInvokerSigningBy();
  } catch {
    return [];
  }
}
