/**
 * Which requests the service worker may touch. Everything not explicitly
 * matched here goes straight to the network: other origins (RPC, backend,
 * socket.io, IPFS, x402, wallets), anything with Authorization, non-GET,
 * range requests and /api/ paths.
 *
 * public/sw.js keeps a mirrored copy of routeFor (a worker has no build step);
 * lib/pwa/__tests__/routing.test.ts runs the same cases against both.
 */

export type Strategy = "network-first" | "cache-first";

export interface RequestLike {
  url: string;
  method: string;
  headers: { has(name: string): boolean };
}

export function routeFor(req: RequestLike, origin: string, routes: ReadonlySet<string>): Strategy | null {
  if (req.method !== "GET") return null;
  if (req.headers.has("authorization") || req.headers.has("range")) return null;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/socket.io")) return null;
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/") || path === "/favicon.ico") return "cache-first";
  if (routes.has(path) || routes.has(path.replace(/\/$/, "") || "/")) return "network-first";
  return null;
}
