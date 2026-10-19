import type { MarketCategory, MarketStatus } from "@/lib/api/markets";
import { BACKEND_CATEGORIES } from "@/lib/stellar/categories";

export type SortKey = "newest" | "close-asc" | "close-desc" | "liquidity-desc" | "movement-desc";

export interface DiscoveryState {
  q: string;
  status: MarketStatus | "ALL";
  category: MarketCategory | "";
  sort: SortKey;
}

export const DEFAULTS: DiscoveryState = { q: "", status: "ACTIVE", category: "", sort: "newest" };

const SORT_KEYS: SortKey[] = ["newest", "close-asc", "close-desc", "liquidity-desc", "movement-desc"];
const STATUSES: DiscoveryState["status"][] = ["ALL", "PENDING", "ACTIVE", "RESOLVING", "RESOLVED", "CANCELLED"];
const MAX_QUERY_LENGTH = 100;

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Reads discovery state from the URL. Unknown values fall back to the defaults. */
export function parseDiscovery(sp: URLSearchParams): DiscoveryState {
  return {
    q: (sp.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    status: oneOf(sp.get("status"), STATUSES, DEFAULTS.status),
    category: oneOf<MarketCategory | "">(sp.get("category"), BACKEND_CATEGORIES, DEFAULTS.category),
    sort: oneOf(sp.get("sort"), SORT_KEYS, DEFAULTS.sort),
  };
}

/** Writes discovery state in a stable key order, leaving out defaults. */
export function serializeDiscovery(state: DiscoveryState): string {
  const sp = new URLSearchParams();
  if (state.q !== DEFAULTS.q) sp.set("q", state.q);
  if (state.status !== DEFAULTS.status) sp.set("status", state.status);
  if (state.category !== DEFAULTS.category) sp.set("category", state.category);
  if (state.sort !== DEFAULTS.sort) sp.set("sort", state.sort);
  return sp.toString();
}
