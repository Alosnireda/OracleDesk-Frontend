import { apiClient } from "./client";

/**
 * Web Push subscription endpoints (backend contract; see the PR description
 * and docs/api.md once the backend ships them). Responses are validated with
 * hand-written guards: a malformed response throws instead of leaking `any`.
 */

export const PUSH_CATEGORIES = ["TRADE_CONFIRMED", "MARKET_RESOLVED", "TRACE_PUBLISHED"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  categories: PushCategory[];
  userAgent: string;
}

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  categories: PushCategory[];
  createdAt?: string;
}

export class InvalidResponseError extends Error {
  constructor(what: string) {
    super(`The server sent an unexpected ${what} response.`);
    this.name = "InvalidResponseError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCategory = (v: unknown): v is PushCategory => typeof v === "string" && (PUSH_CATEGORIES as readonly string[]).includes(v);

export function isVapidKeyResponse(v: unknown): v is { publicKey: string } {
  return isObject(v) && typeof v.publicKey === "string" && /^[A-Za-z0-9_-]{40,}={0,2}$/.test(v.publicKey);
}

export function isIdResponse(v: unknown): v is { id: string } {
  return isObject(v) && typeof v.id === "string" && v.id.length > 0 && v.id.length <= 128;
}

export function isStoredSubscription(v: unknown): v is StoredPushSubscription {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.endpoint === "string" &&
    Array.isArray(v.categories) &&
    v.categories.every(isCategory) &&
    (v.createdAt === undefined || typeof v.createdAt === "string")
  );
}

/** Unauthenticated. */
export async function getVapidKey(): Promise<string> {
  const { data } = await apiClient.get<unknown>("/notifications/vapid-key");
  if (!isVapidKeyResponse(data)) throw new InvalidResponseError("VAPID key");
  return data.publicKey;
}

/** Authenticated (Bearer from the wallet session). Idempotent on endpoint. */
export async function putSubscription(body: PushSubscriptionBody): Promise<{ id: string }> {
  if (!body.categories.every(isCategory)) throw new Error("Unknown notification category");
  const { data } = await apiClient.put<unknown>("/notifications/subscriptions", body);
  if (!isIdResponse(data)) throw new InvalidResponseError("subscription");
  return { id: data.id };
}

export async function deleteSubscription(id: string): Promise<void> {
  await apiClient.delete<unknown>(`/notifications/subscriptions/${encodeURIComponent(id)}`);
}

export async function listSubscriptions(): Promise<StoredPushSubscription[]> {
  const { data } = await apiClient.get<unknown>("/notifications/subscriptions");
  if (!Array.isArray(data) || !data.every(isStoredSubscription)) throw new InvalidResponseError("subscription list");
  return data;
}
