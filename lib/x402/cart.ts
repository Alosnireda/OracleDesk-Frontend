import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { TraceCheck } from "@/lib/stellar/trace";
import {
  amountOf,
  selectRequirement,
  type PolicyDecision,
  type PolicyEvaluator,
  type RequirementsResult,
  type UnlockResult,
} from "./client";
import { JournalUnavailableError, type X402Network } from "./recovery";

/**
 * Unlock cart: pick several locked traces, quote each from its live 402, and
 * pay them one after another. x402 has no multi-resource payment, so each
 * item is its own 402 → sign → retry round trip (and its own wallet prompt);
 * the cart makes the batch predictable: re-quote before each signature, pause
 * on price increases, stop on policy limits, and end with one receipt.
 * All amounts are bigint atomic units.
 */

export type CartStatus = "queued" | "quoting" | "ready" | "paying" | "verifying" | "unlocked" | "skipped" | "failed";

export interface CartQuote {
  /** Null when the trace was already free for this wallet (200 without payment). */
  paymentRequired: PaymentRequired | null;
  requirement: PaymentRequirements | null;
  amountRaw: bigint;
  quotedAt: number;
}

export interface CartItem {
  onChainTraceId: string;
  backendTraceId: string;
  marketQuestion: string;
  /** Backend's unlockPriceRaw: a display hint before quoting, never the charged amount. */
  hintPriceRaw?: bigint;
  quote?: CartQuote;
  status: CartStatus;
  reason?: string;
  txHash?: string;
  verification?: TraceCheck["status"];
  paidRaw?: bigint;
  /** Paid (or possibly paid) without a verified unlock: show in the receipt for support. */
  needsSupport?: boolean;
}

export interface CartTrace {
  id: string;
  onChainTraceId?: string | null;
  unlockPriceRaw?: string;
  market?: { question: string } | null;
}

export const NOT_ON_CHAIN = "Not published on-chain yet";
export const QUOTE_CONCURRENCY = 3;

const parseRaw = (value: string | undefined) => (value && /^\d+$/.test(value) ? BigInt(value) : undefined);

/** Adds a trace, deduplicated by on-chain id. Traces not on-chain can't be bought through x402. O(n). */
export function addToCart(items: readonly CartItem[], trace: CartTrace): { items: CartItem[]; error?: string } {
  if (!trace.onChainTraceId) return { items: [...items], error: NOT_ON_CHAIN };
  if (items.some((item) => item.onChainTraceId === trace.onChainTraceId)) return { items: [...items] };
  return {
    items: [
      ...items,
      {
        onChainTraceId: trace.onChainTraceId,
        backendTraceId: trace.id,
        marketQuestion: trace.market?.question ?? "Reasoning trace",
        hintPriceRaw: parseRaw(trace.unlockPriceRaw),
        status: "queued",
      },
    ],
  };
}

export const removeFromCart = (items: readonly CartItem[], onChainTraceId: string) =>
  items.filter((item) => item.onChainTraceId !== onChainTraceId);

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Quotes every item from its live 402, three at a time. */
export async function quoteCart(
  items: readonly CartItem[],
  deps: { requestRequirements: (onChainTraceId: string) => Promise<RequirementsResult>; network: X402Network; now?: () => number },
  onUpdate: (item: CartItem) => void,
  signal?: AbortSignal,
): Promise<CartItem[]> {
  const now = deps.now ?? Date.now;
  return mapWithConcurrency(items, QUOTE_CONCURRENCY, async (item) => {
    if (signal?.aborted) return item;
    onUpdate({ ...item, status: "quoting" });
    let quoted: CartItem;
    try {
      const result = await deps.requestRequirements(item.onChainTraceId);
      if (result.status === "free") {
        quoted = { ...item, status: "ready", reason: undefined, quote: { paymentRequired: null, requirement: null, amountRaw: 0n, quotedAt: now() } };
      } else {
        const requirement = selectRequirement(result.paymentRequired, deps.network);
        quoted = {
          ...item,
          status: "ready",
          reason: undefined,
          quote: { paymentRequired: result.paymentRequired, requirement, amountRaw: amountOf(requirement), quotedAt: now() },
        };
      }
    } catch (error) {
      quoted = { ...item, status: "failed", reason: error instanceof Error ? error.message : "Couldn't get a price" };
    }
    onUpdate(quoted);
    return quoted;
  });
}

export interface CheckoutPlan {
  totalRaw: bigint;
  /** Quoted items that fit the remaining daily allowance, in cart order. */
  affordable: CartItem[];
  overLimit: CartItem[];
  /** True when the daily pass costs no more than these unlocks. */
  recommendDailyPass: boolean;
}

/** Totals the quoted items and splits them by the remaining daily allowance. O(n). */
export function planCheckout(
  items: readonly CartItem[],
  ctx: { remainingTodayRaw: bigint | null; dailyPassPriceRaw: bigint | null },
): CheckoutPlan {
  let totalRaw = 0n;
  let running = 0n;
  const affordable: CartItem[] = [];
  const overLimit: CartItem[] = [];
  for (const item of items) {
    if (item.status !== "ready" || !item.quote) continue;
    totalRaw += item.quote.amountRaw;
    running += item.quote.amountRaw;
    if (ctx.remainingTodayRaw === null || running <= ctx.remainingTodayRaw) affordable.push(item);
    else overLimit.push(item);
  }
  const recommendDailyPass = ctx.dailyPassPriceRaw !== null && totalRaw > 0n && totalRaw >= ctx.dailyPassPriceRaw;
  return { totalRaw, affordable, overLimit, recommendDailyPass };
}

export type PriceChangeChoice = "accept" | "accept-all" | "skip";

export interface CheckoutDeps {
  wallet: string;
  network: X402Network;
  /** The journaled unlock (unlockTrace with payAgainIfExpired). */
  unlock: (item: CartItem, evaluate: PolicyEvaluator) => Promise<UnlockResult>;
  /** The spending policy; without one, the conservative fallback applies. */
  policy?: (requirement: PaymentRequirements, ctx: { spentRaw: bigint }) => PolicyDecision | Promise<PolicyDecision>;
  /** The total the user confirmed before starting. */
  confirmedTotalRaw: bigint;
  /** Pauses the run on a price increase until the user chooses. */
  decidePriceChange: (item: CartItem, quotedRaw: bigint, newRaw: bigint) => Promise<PriceChangeChoice>;
  now?: () => number;
}

export interface ReceiptLine {
  onChainTraceId: string;
  backendTraceId: string;
  marketQuestion: string;
  status: CartStatus;
  quotedRaw: bigint | null;
  paidRaw: bigint;
  txHash?: string;
  verification?: TraceCheck["status"];
  reason?: string;
  needsSupport: boolean;
}

export interface CheckoutReceipt {
  wallet: string;
  network: X402Network;
  startedAt: string;
  finishedAt: string;
  totalPaidRaw: bigint;
  lines: ReceiptLine[];
  needsSupport: boolean;
}

/** Policy denials that end the run: later items would hit the same limit. */
const RUN_ENDING_DENIALS = new Set(["over-daily", "over-per-trace", "over-confirmed-total"]);

function settledItem(item: CartItem, result: UnlockResult): CartItem {
  switch (result.status) {
    case "unlocked": {
      const paid = result.paidRaw > 0n;
      const base = { ...item, paidRaw: result.paidRaw, txHash: result.settlementTxHash, verification: result.check.status };
      if (result.check.status === "verified") return { ...base, status: "unlocked", reason: undefined };
      const reason = result.check.status === "mismatch" ? "hash-mismatch" : "verification-unavailable";
      return { ...base, status: "failed", reason, needsSupport: paid };
    }
    case "settled-undelivered":
      return {
        ...item,
        status: "failed",
        reason: result.reason,
        paidRaw: BigInt(result.entry.amountRaw),
        txHash: result.entry.settlementTxHash,
        verification: result.reason === "hash-mismatch" ? "mismatch" : undefined,
        needsSupport: true,
      };
    case "retryable":
      // Signed and saved; it may still settle. Reopening the trace redelivers it.
      return { ...item, status: "failed", reason: result.error, paidRaw: 0n, needsSupport: true };
    case "expired":
      return { ...item, status: "failed", reason: "previous-payment-expired", paidRaw: 0n };
    case "denied":
      return { ...item, status: result.reason === "terms-changed" ? "failed" : "skipped", reason: result.reason, paidRaw: 0n };
  }
}

/**
 * Pays the items one by one (each waits for its wallet prompt to resolve).
 * Before every signature the item is re-quoted by the unlock's own 402:
 *   - a different payTo, asset or network is never accepted;
 *   - a higher price pauses the run for the user's choice;
 *   - a lower price proceeds and the receipt keeps both amounts;
 *   - then the spending policy (or the conservative fallback) runs.
 * Aborting stops before the next item; remaining items are skipped.
 */
export async function runCheckout(
  items: readonly CartItem[],
  deps: CheckoutDeps,
  onUpdate: (item: CartItem) => void,
  signal: AbortSignal,
): Promise<CheckoutReceipt> {
  const now = deps.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const done: CartItem[] = [];
  let spentRaw = 0n;
  let acceptAllIncreases = false;
  let approvedExtraRaw = 0n;
  let stopReason: string | null = null;

  for (const item of items) {
    if (stopReason === null && signal.aborted) stopReason = typeof signal.reason === "string" ? signal.reason : "cancelled";
    if (item.status !== "ready" || !item.quote) {
      done.push(item);
      continue;
    }
    if (stopReason !== null) {
      const skipped = { ...item, status: "skipped" as const, reason: stopReason, paidRaw: 0n };
      onUpdate(skipped);
      done.push(skipped);
      continue;
    }

    const quote = item.quote;
    let current: CartItem = { ...item, status: "paying" };
    onUpdate(current);

    const evaluate: PolicyEvaluator = async (requirement) => {
      const quoted = quote.requirement;
      if (quoted && (requirement.payTo !== quoted.payTo || requirement.asset !== quoted.asset || requirement.network !== quoted.network)) {
        return { allow: false, reason: "terms-changed", message: "The payee or asset changed since the quote." };
      }
      const amount = amountOf(requirement);
      if (amount > quote.amountRaw) {
        if (!acceptAllIncreases) {
          current = { ...current, status: "failed", reason: "price-increased" };
          onUpdate(current);
          const choice = await deps.decidePriceChange(current, quote.amountRaw, amount);
          if (choice === "skip") return { allow: false, reason: "price-increased", message: "Skipped after a price increase." };
          if (choice === "accept-all") acceptAllIncreases = true;
          current = { ...current, status: "paying", reason: undefined };
          onUpdate(current);
        }
        approvedExtraRaw += amount - quote.amountRaw;
      }
      if (deps.policy) return deps.policy(requirement, { spentRaw });
      // Conservative fallback: the item is within its quote (or an increase the user
      // accepted) by now, and the run stays within the confirmed total plus accepted increases.
      if (spentRaw + amount > deps.confirmedTotalRaw + approvedExtraRaw) return { allow: false, reason: "over-confirmed-total" };
      return { allow: true };
    };

    let next: CartItem;
    try {
      next = settledItem(current, await deps.unlock(current, evaluate));
    } catch (error) {
      if (error instanceof JournalUnavailableError) stopReason = "storage-unavailable";
      next = { ...current, status: "failed", reason: error instanceof Error ? error.message : "Unlock failed", paidRaw: 0n };
    }
    if (next.status === "skipped" && next.reason && RUN_ENDING_DENIALS.has(next.reason)) stopReason = next.reason;
    spentRaw += next.paidRaw ?? 0n;
    onUpdate(next);
    done.push(next);
  }

  const lines: ReceiptLine[] = done.map((item) => ({
    onChainTraceId: item.onChainTraceId,
    backendTraceId: item.backendTraceId,
    marketQuestion: item.marketQuestion,
    status: item.status,
    quotedRaw: item.quote?.amountRaw ?? null,
    paidRaw: item.paidRaw ?? 0n,
    txHash: item.txHash,
    verification: item.verification,
    reason: item.reason,
    needsSupport: Boolean(item.needsSupport),
  }));
  return {
    wallet: deps.wallet,
    network: deps.network,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    totalPaidRaw: lines.reduce((sum, line) => sum + line.paidRaw, 0n),
    lines,
    needsSupport: lines.some((line) => line.needsSupport),
  };
}

/** Receipt as JSON with amounts as decimal strings of atomic units. */
export const receiptToJson = (receipt: CheckoutReceipt) =>
  JSON.stringify(receipt, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);

// ─── Session persistence (ids only; quotes are always re-fetched) ───────────

interface StoredCartItem {
  onChainTraceId: string;
  backendTraceId: string;
  marketQuestion: string;
  hintPriceRaw?: string;
}

export const cartKey = (wallet: string, network: X402Network) => `oracledesk_x402_cart:${network}:${wallet}`;

export function saveCart(storage: Storage | null, key: string, items: readonly CartItem[]): void {
  const stored: StoredCartItem[] = items.map(({ onChainTraceId, backendTraceId, marketQuestion, hintPriceRaw }) => ({
    onChainTraceId,
    backendTraceId,
    marketQuestion,
    hintPriceRaw: hintPriceRaw?.toString(),
  }));
  try {
    storage?.setItem(key, JSON.stringify(stored));
  } catch {
    // Blocked storage: the cart lives for this page only.
  }
}

/** Restores the cart as queued items; a stale quote is never reused. */
export function loadCart(storage: Storage | null, key: string): CartItem[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw: Partial<StoredCartItem>) =>
      typeof raw?.onChainTraceId === "string" && typeof raw.backendTraceId === "string"
        ? [
            {
              onChainTraceId: raw.onChainTraceId,
              backendTraceId: raw.backendTraceId,
              marketQuestion: typeof raw.marketQuestion === "string" ? raw.marketQuestion : "Reasoning trace",
              hintPriceRaw: parseRaw(raw.hintPriceRaw),
              status: "queued" as const,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}
