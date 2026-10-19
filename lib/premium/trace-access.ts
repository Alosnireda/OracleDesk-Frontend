import type { PaymentEvent, TraceAccessLevel, UnlockType } from "@/lib/api/traces";
import { formatUsdc } from "@/lib/stellar/units";

/** A daily pass covers every trace for 24 hours from the verified payment. */
export const DAILY_PASS_DURATION_MS = 24 * 60 * 60 * 1000;

export interface UnlockRoute {
  kind: UnlockType;
  /** Price in 7-decimal base units; null when the backend didn't quote one. */
  priceRaw: bigint | null;
  /**
   * Whether this client can actually take the route. A daily pass always can
   * (the flow exists on /premium and here); a per-trace unlock only can when
   * the contracts repo's x402 service is configured and the trace is
   * published on-chain.
   */
  available: boolean;
  /** Why the route is unavailable, for display. */
  reason?: string;
}

export interface TraceAccessFacts {
  accessLevel?: TraceAccessLevel;
  lockedFields?: string[];
  unlockPriceRaw?: string;
  dailyPassPriceRaw?: string;
  onChainTraceId?: string | null;
}

function parseRaw(value: string | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * The unlock routes this page can honestly offer for one trace, with the
 * prices the backend actually quoted (docs/api.md `GET /traces/:id`). Nothing
 * is invented: a missing price stays null and an unwired route stays
 * unavailable.
 */
export function deriveUnlockRoutes(
  trace: TraceAccessFacts,
  opts: { x402Url: string; fallbackDailyPassPriceRaw?: bigint | null },
): UnlockRoute[] {
  const routes: UnlockRoute[] = [];

  const dailyPrice = parseRaw(trace.dailyPassPriceRaw) ?? opts.fallbackDailyPassPriceRaw ?? null;
  routes.push({
    kind: "DAILY_PASS",
    priceRaw: dailyPrice,
    available: true,
  });

  const perTracePrice = parseRaw(trace.unlockPriceRaw);
  if (!opts.x402Url) {
    // Hidden state still described for tests: unavailable without the service.
    routes.push({
      kind: "PER_TRACE",
      priceRaw: perTracePrice,
      available: false,
      reason: "The per-trace x402 service is not configured.",
    });
  } else if (!trace.onChainTraceId) {
    routes.push({
      kind: "PER_TRACE",
      priceRaw: perTracePrice,
      available: false,
      reason: "This trace is not published on-chain yet.",
    });
  } else {
    routes.push({ kind: "PER_TRACE", priceRaw: perTracePrice, available: true });
  }

  return routes;
}

/**
 * When the currently-active daily pass expires, derived from the newest
 * verified DAILY_PASS payment (a pass lasts 24 hours). Null when there is no
 * unexpired pass. This is derived client-side from receipts; the backend's
 * `GET /traces/:id` accessLevel is the authority on whether access is active.
 */
export function deriveDailyPassExpiry(
  events: PaymentEvent[],
  now: Date,
): Date | null {
  let newest: PaymentEvent | null = null;
  for (const event of events) {
    if (event?.type !== "DAILY_PASS" || typeof event.createdAt !== "string") continue;
    const createdAt = Date.parse(event.createdAt);
    if (Number.isNaN(createdAt)) continue;
    if (!newest || Date.parse(newest.createdAt) < createdAt) newest = event;
  }
  if (!newest) return null;
  const expiresAt = Date.parse(newest.createdAt) + DAILY_PASS_DURATION_MS;
  return expiresAt > now.getTime() ? new Date(expiresAt) : null;
}

/** Human price for a raw 7-decimal amount, or "—" when the backend quoted none. */
export function formatRoutePrice(priceRaw: bigint | null): string {
  if (priceRaw === null) return "—";
  return `${formatUsdc(priceRaw, { minDecimals: 2 })} USDC`;
}

/** Short, stable list of locked field names for display. */
export function formatLockedFields(lockedFields: string[] | undefined): string[] {
  if (!Array.isArray(lockedFields)) return [];
  return lockedFields.filter((field): field is string => typeof field === "string" && field.length > 0);
}
