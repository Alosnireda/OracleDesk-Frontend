/**
 * Push payload validation and notification text. A push payload comes
 * through a third-party push service, so it is an untrusted hint: it carries
 * only ids, and every word the user sees is built from facts fetched
 * afterwards, never from the payload.
 *
 * public/sw.js keeps a mirrored copy of these rules (a worker can't import
 * TS); lib/notifications/__tests__/payload.test.ts checks they stay in sync.
 */

export const MARKET_ID_RE = /^\d{1,20}$/;
export const TX_HASH_RE = /^[0-9a-f]{64}$/;
export const TRACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const EVENT_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

export const PAYLOAD_KINDS = ["TRADE_CONFIRMED", "MARKET_RESOLVED", "TRACE_PUBLISHED"] as const;
export type PayloadKind = (typeof PAYLOAD_KINDS)[number];

export interface PushPayload {
  v: 1;
  kind: PayloadKind;
  onChainMarketId?: string;
  txHash?: string;
  traceId?: string;
  eventId: string;
}

export const GENERIC = { title: "OracleDesk", body: "OracleDesk has an update for you." } as const;

/** Returns the payload only if every field passes the strict rules; otherwise null. */
export function parsePushPayload(raw: unknown): PushPayload | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 1024) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.kind !== "string" || !(PAYLOAD_KINDS as readonly string[]).includes(o.kind)) return null;
  if (typeof o.eventId !== "string" || !EVENT_ID_RE.test(o.eventId)) return null;
  const out: PushPayload = { v: 1, kind: o.kind as PayloadKind, eventId: o.eventId };
  if (o.onChainMarketId !== undefined) {
    if (typeof o.onChainMarketId !== "string" || !MARKET_ID_RE.test(o.onChainMarketId)) return null;
    out.onChainMarketId = o.onChainMarketId;
  }
  if (o.txHash !== undefined) {
    if (typeof o.txHash !== "string" || !TX_HASH_RE.test(o.txHash)) return null;
    out.txHash = o.txHash;
  }
  if (o.traceId !== undefined) {
    if (typeof o.traceId !== "string" || !TRACE_ID_RE.test(o.traceId)) return null;
    out.traceId = o.traceId;
  }
  // Every kind is about a market; without a valid market id there is nothing to link to.
  if (!out.onChainMarketId) return null;
  return out;
}

/** Same-origin path built only from validated ids. */
export function notificationUrl(p: PushPayload | null): string {
  if (!p?.onChainMarketId || !MARKET_ID_RE.test(p.onChainMarketId)) return "/notifications";
  return `/markets/quick-view?onChainId=${p.onChainMarketId}&from=push`;
}

export interface FetchedFacts {
  /** Market question from the backend, or null if it couldn't be fetched. */
  question: string | null;
  /** On-chain status from the backend's chain-read endpoint. */
  status: "Open" | "Resolved" | "Void" | null;
  outcome?: "Yes" | "No" | null;
}

export interface NotificationContent {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildNotification(p: PushPayload | null, facts: FetchedFacts | null): NotificationContent {
  if (!p) return { ...GENERIC, tag: "oracledesk-generic", url: "/notifications" };
  const url = notificationUrl(p);
  const tag = p.eventId;
  const q = facts?.question ? clip(facts.question) : "a market you hold";

  if (p.kind === "MARKET_RESOLVED") {
    // The push may beat the indexer: never state an outcome the fetched state doesn't show.
    if (facts?.status === "Resolved" && (facts.outcome === "Yes" || facts.outcome === "No")) {
      return { title: "Market resolved", body: `${q} resolved ${facts.outcome.toUpperCase()}. Open to check your position.`, tag, url };
    }
    if (facts?.status === "Void") {
      return { title: "Market resolved", body: `${q} resolved void. Open to check your position.`, tag, url };
    }
    return { title: "OracleDesk", body: "A market you hold has an update.", tag, url };
  }
  if (p.kind === "TRADE_CONFIRMED") {
    return { title: "Trade confirmed", body: facts?.question ? `Your trade on ${q} was confirmed.` : "Your trade was confirmed.", tag, url };
  }
  return { title: "New reasoning trace", body: facts?.question ? `A new reasoning trace was published on ${q}.` : "A new reasoning trace was published on a market you hold.", tag, url };
}
