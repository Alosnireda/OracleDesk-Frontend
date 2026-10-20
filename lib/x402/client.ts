import { x402Client, x402HTTPClient } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import type { SignAuthEntry } from "@stellar/stellar-sdk/contract";
import { normalizeHash, type TraceCheck } from "@/lib/stellar/trace";
import {
  REDELIVERABLE_STATES,
  JournalUnavailableError,
  checkSettlement,
  inspectPaymentHeader,
  withTraceLock,
  type JournalEntry,
  type PaymentJournal,
  type SettlementChain,
  type X402Network,
} from "./recovery";

/**
 * Client for the contracts repo's x402 trace service
 * (`GET {X402_URL}/traces/:onChainTraceId`, @x402/express 2.26 with the
 * Stellar `exact` scheme). Protocol v2 over HTTP:
 *   402 + `PAYMENT-REQUIRED` (base64 JSON PaymentRequired)
 *   retry with `PAYMENT-SIGNATURE` (base64 JSON PaymentPayload)
 *   200 + `PAYMENT-RESPONSE` (base64 JSON SettleResponse)
 * The payment is a Soroban auth entry signed by the wallet; the facilitator
 * submits and sponsors the transaction.
 */

export type PaymentRequirementLike = PaymentRequirements;
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";

export interface TraceResponse {
  traceId: string;
  traceHash: string;
  content: unknown;
}

/** SEP-43 subset the Stellar exact scheme signs with (auth entries only). */
export interface X402Signer {
  address: string;
  signAuthEntry: SignAuthEntry;
}

export interface X402Transport {
  baseUrl: string;
  network: X402Network;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** A response from the service that is neither content nor a payment request. */
export class X402HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "X402HttpError";
  }
}

export type RequirementsResult =
  | { status: "free"; body: TraceResponse }
  | { status: "payment-required"; paymentRequired: PaymentRequired; accepts: PaymentRequirements[] };

export type Delivery =
  | { kind: "delivered"; trace: TraceResponse; settlement: SettleResponse | null }
  /** 402 to a request that carried a payment: the payload was not accepted. */
  | { kind: "rejected"; reason: string }
  | { kind: "server-error"; httpStatus: number; reason: string }
  | { kind: "client-error"; httpStatus: number; reason: string };

/** Parses headers only; payment creation builds its own client with the signer. */
const parser = new x402HTTPClient(new x402Client());

function traceUrl(baseUrl: string, onChainTraceId: string) {
  return `${baseUrl.replace(/\/+$/, "")}/traces/${encodeURIComponent(onChainTraceId)}`;
}

async function getTrace(onChainTraceId: string, paymentHeader: string | null, transport: X402Transport) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (paymentHeader) headers[PAYMENT_SIGNATURE_HEADER] = paymentHeader;
  const response = await (transport.fetchImpl ?? fetch)(traceUrl(transport.baseUrl, onChainTraceId), {
    headers,
    signal: transport.signal,
  });
  const body: unknown = await response.json().catch(() => null);
  return { response, body, header: (name: string) => response.headers.get(name) };
}

function errorText(body: unknown, status: number): string {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" && error ? error : `HTTP ${status}`;
}

function parseTraceResponse(body: unknown): TraceResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const { traceId, traceHash, content } = body as Record<string, unknown>;
  return typeof traceId === "string" && typeof traceHash === "string" && content !== undefined ? { traceId, traceHash, content } : null;
}

/** Asks for a trace without paying: content when already free/entitled, otherwise the 402 requirements. */
export async function requestRequirements(onChainTraceId: string, transport: X402Transport): Promise<RequirementsResult> {
  const { response, body, header } = await getTrace(onChainTraceId, null, transport);
  if (response.ok) {
    const trace = parseTraceResponse(body);
    if (!trace) throw new X402HttpError(response.status, "The x402 service returned an unexpected body.");
    return { status: "free", body: trace };
  }
  if (response.status === 402) {
    let paymentRequired: PaymentRequired;
    try {
      paymentRequired = parser.getPaymentRequiredResponse(header, body);
    } catch {
      throw new X402HttpError(402, "The x402 service answered 402 without readable payment requirements.");
    }
    return { status: "payment-required", paymentRequired, accepts: paymentRequired.accepts };
  }
  throw new X402HttpError(response.status, errorText(body, response.status));
}

/** The `exact` requirement for the configured network; throws when the service offers none. */
export function selectRequirement(paymentRequired: PaymentRequired, network: X402Network): PaymentRequirements {
  const requirement = paymentRequired.accepts.find((accept) => accept.scheme === "exact" && accept.network === network);
  if (!requirement) throw new X402HttpError(402, `The x402 service doesn't accept exact payments on ${network}.`);
  if (!/^\d+$/.test(requirement.amount)) throw new X402HttpError(402, `The x402 service quoted an invalid amount (${requirement.amount}).`);
  return requirement;
}

export const amountOf = (requirement: PaymentRequirements): bigint => BigInt(requirement.amount);

/**
 * Builds and signs the payment for `requirement` (one wallet prompt). The
 * scheme simulates the SEP-41 transfer on `rpcUrl`, asks the wallet to sign
 * the payer's auth entry, and re-simulates the signed result.
 */
export async function createPaymentHeader(
  paymentRequired: PaymentRequired,
  requirement: PaymentRequirements,
  signer: X402Signer,
  rpcUrl: string,
): Promise<string> {
  const client = new x402Client(() => requirement).register(requirement.network, new ExactStellarScheme(signer, { url: rpcUrl }));
  return encodePaymentSignatureHeader(await client.createPaymentPayload(paymentRequired));
}

/** Sends the trace request with a signed payment header. Network failures throw. */
export async function deliverWithPayment(onChainTraceId: string, paymentHeader: string, transport: X402Transport): Promise<Delivery> {
  const { response, body, header } = await getTrace(onChainTraceId, paymentHeader, transport);
  if (response.ok) {
    const trace = parseTraceResponse(body);
    if (!trace) return { kind: "server-error", httpStatus: response.status, reason: "The x402 service returned an unexpected body." };
    let settlement: SettleResponse | null = null;
    try {
      settlement = parser.getPaymentSettleResponse(header);
    } catch {
      // Cross-origin reads need Access-Control-Expose-Headers: PAYMENT-RESPONSE.
    }
    return { kind: "delivered", trace, settlement };
  }
  if (response.status === 402) {
    let reason = errorText(body, 402);
    try {
      reason = parser.getPaymentRequiredResponse(header, body).error ?? reason;
    } catch {
      // Keep the body's error text.
    }
    return { kind: "rejected", reason };
  }
  const reason = errorText(body, response.status);
  return response.status >= 500
    ? { kind: "server-error", httpStatus: response.status, reason }
    : { kind: "client-error", httpStatus: response.status, reason };
}

/**
 * Pays for one trace and returns the delivered content, without a journal.
 * Low-level: app flows use {@link unlockTrace}, which journals first.
 */
export async function payAndFetch(
  onChainTraceId: string,
  quote: { paymentRequired: PaymentRequired; requirement: PaymentRequirements },
  signer: X402Signer,
  opts: X402Transport & { rpcUrl: string },
): Promise<TraceResponse> {
  const header = await createPaymentHeader(quote.paymentRequired, quote.requirement, signer, opts.rpcUrl);
  const delivery = await deliverWithPayment(onChainTraceId, header, opts);
  if (delivery.kind === "delivered") return delivery.trace;
  throw new X402HttpError(delivery.kind === "rejected" ? 402 : delivery.httpStatus, delivery.reason);
}

// ─── Journaled unlock ───────────────────────────────────────────────────────

export type PolicyDecision = { allow: true } | { allow: false; reason: string; message?: string };

/**
 * Runs before every signature with the requirement about to be signed. The
 * spending policy, the cart's price-change rule, or the single-unlock
 * confirmation all plug in here.
 */
export type PolicyEvaluator = (requirement: PaymentRequirements, paymentRequired: PaymentRequired) => PolicyDecision | Promise<PolicyDecision>;

/** Conservative fallback when no spending policy is available: never more than the user confirmed. */
export function conservativePolicy(limits: { maxItemRaw: bigint; maxTotalRaw: bigint; spentRaw: () => bigint }): PolicyEvaluator {
  return (requirement) => {
    const amount = amountOf(requirement);
    if (amount > limits.maxItemRaw) return { allow: false, reason: "price-increased", message: "The price is higher than the amount you confirmed." };
    if (limits.spentRaw() + amount > limits.maxTotalRaw) return { allow: false, reason: "over-confirmed-total", message: "This would exceed the total you confirmed." };
    return { allow: true };
  };
}

export interface VerifiedContent {
  onChainHash: string;
  check: TraceCheck;
}

export interface UnlockDeps {
  journal: PaymentJournal | null;
  chain: SettlementChain;
  /** Reads the on-chain hash and hash-checks the content from IPFS (fetchVerifiedTrace). */
  verify: (onChainTraceId: string) => Promise<VerifiedContent>;
  /** Builds and signs the payment header (wallet prompt). */
  sign: (paymentRequired: PaymentRequired, requirement: PaymentRequirements) => Promise<string>;
  transport: X402Transport;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to an exclusive Web Lock per wallet, network and trace. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Backoff between redelivery attempts after network errors or 5xx. */
  retryDelaysMs?: readonly number[];
}

export interface UnlockOptions {
  onChainTraceId: string;
  wallet: string;
  evaluate: PolicyEvaluator;
  /** Allows a new payment when the journal holds a payment that expired unsettled. */
  payAgainIfExpired?: boolean;
  /** Resend the stored header of a settled-but-undelivered payment. */
  retryDelivery?: boolean;
  /** Checked before signing only: a signed payment is always delivered or journaled. */
  signal?: AbortSignal;
}

export type UnlockResult =
  /** Content delivered (now or earlier); `check` is the IPFS hash check against the chain. */
  | { status: "unlocked"; paidRaw: bigint; check: TraceCheck; entry?: JournalEntry; settlementTxHash?: string }
  | { status: "denied"; reason: string; message?: string }
  /** Payment saved; delivery failed and can be retried with the same header. */
  | { status: "retryable"; entry: JournalEntry; error: string }
  /** Paid (settled) but no verified content: evidence for support; never pay again. */
  | { status: "settled-undelivered"; entry: JournalEntry; reason: string }
  /** The earlier payment expired unsettled; paying again is safe. */
  | { status: "expired"; entry: JournalEntry };

export const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 10_000] as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Error text for storage: the payment header never appears in it. */
function safeErrorText(error: unknown, paymentHeader: string): string {
  const text = error instanceof Error ? error.message : String(error);
  return paymentHeader ? text.split(paymentHeader).join("[payment header]") : text;
}

/**
 * Unlocks one trace through x402 so a payment is never made twice:
 *  0. an open journal entry is redelivered (or resolved on-chain once expired);
 *  1. otherwise ask without paying (free/entitled → done);
 *  2. on 402, run the policy, then sign (wallet prompt);
 *  3. journal the signed header and wait for the durable commit;
 *  4. send; network errors and 5xx keep the header and retry with backoff.
 * Refuses to sign when no journal is available.
 */
export async function unlockTrace(opts: UnlockOptions, deps: UnlockDeps): Promise<UnlockResult> {
  const { journal } = deps;
  if (!journal) throw new JournalUnavailableError();
  const network = deps.transport.network;
  const lock = deps.lock ?? (<T,>(fn: () => Promise<T>) => withTraceLock(opts.wallet, network, opts.onChainTraceId, fn));
  const sleep = deps.sleep ?? defaultSleep;
  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  const finish = async (entry: JournalEntry | null, trace: TraceResponse | null, paidRaw: bigint, txHash?: string): Promise<UnlockResult> => {
    let verified: VerifiedContent;
    try {
      verified = await deps.verify(opts.onChainTraceId);
    } catch (error) {
      if (entry) entry = await journal.update(entry.id, { state: "delivered", settlementTxHash: txHash ?? entry.settlementTxHash });
      return { status: "unlocked", paidRaw, entry: entry ?? undefined, settlementTxHash: txHash, check: { status: "unavailable", reason: safeErrorText(error, "") } };
    }
    if (trace && normalizeHash(trace.traceHash) !== normalizeHash(verified.onChainHash)) {
      // The service delivered something other than the on-chain trace: a delivery failure, not a success.
      if (!entry) return { status: "unlocked", paidRaw, check: { status: "mismatch", computedHash: normalizeHash(trace.traceHash) } };
      entry = await journal.update(entry.id, { state: "settled-undelivered", lastError: "hash-mismatch", settlementTxHash: txHash ?? entry.settlementTxHash });
      return { status: "settled-undelivered", entry, reason: "hash-mismatch" };
    }
    if (entry) {
      entry = await journal.update(entry.id, { state: "delivered", contentHash: verified.onChainHash, settlementTxHash: txHash ?? entry.settlementTxHash });
    }
    return { status: "unlocked", paidRaw, check: verified.check, entry: entry ?? undefined, settlementTxHash: txHash ?? entry?.settlementTxHash };
  };

  /** After a rejection or an expired payload: decide from the chain, never by guessing. */
  const resolveOnChain = async (entry: JournalEntry, why: string): Promise<UnlockResult> => {
    const settlement = await checkSettlement(entry, deps.chain);
    if (settlement.status === "settled") {
      const settled = await journal.update(entry.id, { state: "settled-undelivered", settlementTxHash: settlement.txHash, lastError: why });
      return { status: "settled-undelivered", entry: settled, reason: why };
    }
    if (settlement.status === "not-settled" && settlement.final) {
      return { status: "expired", entry: await journal.update(entry.id, { state: "expired", lastError: why }) };
    }
    const error = settlement.status === "unknown" ? `${why} (${settlement.reason})` : `${why}; the payment can still settle until ledger ${entry.expirationLedger}`;
    return { status: "retryable", entry: await journal.update(entry.id, { state: "failed-retryable", lastError: error }), error };
  };

  const redeliver = async (start: JournalEntry): Promise<UnlockResult> => {
    let entry = start;
    for (let attempt = 0; ; attempt++) {
      entry = await journal.update(entry.id, { state: "sent", attempts: entry.attempts + 1 });
      let delivery: Delivery | { kind: "network-error"; reason: string };
      try {
        delivery = await deliverWithPayment(opts.onChainTraceId, entry.paymentHeader, { ...deps.transport, signal: undefined });
      } catch (error) {
        delivery = { kind: "network-error", reason: safeErrorText(error, entry.paymentHeader) };
      }
      switch (delivery.kind) {
        case "delivered":
          return finish(entry, delivery.trace, BigInt(entry.amountRaw), delivery.settlement?.success ? delivery.settlement.transaction : undefined);
        case "rejected":
          return resolveOnChain(entry, `The x402 service rejected the payment: ${delivery.reason}`);
        case "client-error": {
          const error = `The x402 service answered ${delivery.httpStatus}: ${delivery.reason}`;
          return { status: "retryable", entry: await journal.update(entry.id, { state: "failed-retryable", lastError: error }), error };
        }
        default: {
          const error =
            delivery.kind === "server-error"
              ? `The x402 service answered ${delivery.httpStatus}: ${delivery.reason}`
              : `Couldn't reach the x402 service: ${delivery.reason}`;
          entry = await journal.update(entry.id, { state: "failed-retryable", lastError: error });
          if (attempt >= delays.length) return { status: "retryable", entry, error };
          await sleep(delays[attempt]);
        }
      }
    }
  };

  return lock(async () => {
    const open = await journal.findOpen(opts.wallet, network, opts.onChainTraceId);
    if (open?.state === "delivered") return finish(open, null, 0n);
    if (open?.state === "settled-undelivered") {
      return opts.retryDelivery ? redeliver(open) : { status: "settled-undelivered", entry: open, reason: open.lastError ?? "undelivered" };
    }
    if (open && REDELIVERABLE_STATES.includes(open.state)) {
      const expired = open.expirationLedger !== undefined && (await deps.chain.latestLedger()) > open.expirationLedger;
      if (!expired) return redeliver(open);
      const resolved = await resolveOnChain(open, "The saved payment expired before it was delivered");
      if (resolved.status !== "expired" || !opts.payAgainIfExpired) return resolved;
    }

    const first = await requestRequirements(opts.onChainTraceId, deps.transport);
    if (first.status === "free") return finish(null, first.body, 0n);

    const requirement = selectRequirement(first.paymentRequired, network);
    const decision = await opts.evaluate(requirement, first.paymentRequired);
    if (!decision.allow) return { status: "denied", reason: decision.reason, message: decision.message };

    opts.signal?.throwIfAborted();
    const paymentHeader = await deps.sign(first.paymentRequired, requirement);
    const now = Date.now();
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      wallet: opts.wallet,
      network,
      x402Origin: new URL(deps.transport.baseUrl).origin,
      onChainTraceId: opts.onChainTraceId,
      requirement,
      amountRaw: requirement.amount,
      paymentHeader,
      ...inspectPaymentHeader(paymentHeader, opts.wallet),
      state: "signed",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    // Write-ahead: the signed payment is durable before it leaves the browser.
    await journal.put(entry);
    return redeliver(entry);
  });
}
