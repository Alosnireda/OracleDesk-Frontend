/* OracleDesk service worker. Plain JS, no build step: review as security-sensitive code.
 *
 * Caches ONLY same-origin GETs for prerendered route HTML and hashed build
 * assets. Never touches the backend, Soroban RPC, socket.io, IPFS, x402,
 * wallets or any other origin (see lib/pwa/routing.ts, mirrored below).
 * Never calls skipWaiting() on its own: the page asks, after the user agrees.
 *
 * Push: payloads are untrusted hints carrying ids only. Text is built from
 * public backend reads; URLs only from validated ids (lib/notifications/payload.ts).
 */
const params = new URL(self.location).searchParams;
const VERSION = params.get("v") || "dev";
const API = (() => {
  const raw = params.get("api") || "";
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.hostname === "localhost" ? raw.replace(/\/$/, "") : "";
  } catch { return ""; }
})();
const SHELL = `shell-${VERSION}`;
const CACHING = VERSION !== "dev";
const NAV_TIMEOUT_MS = 4000;
let ROUTES = new Set();

// ── routing (mirror of lib/pwa/routing.ts routeFor) ──
function routeFor(req, origin, routes) {
  if (req.method !== "GET") return null;
  if (req.headers.has("authorization") || req.headers.has("range")) return null;
  let url;
  try { url = new URL(req.url); } catch { return null; }
  if (url.origin !== origin) return null;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/socket.io")) return null;
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/") || path === "/favicon.ico") return "cache-first";
  if (routes.has(path) || routes.has(path.replace(/\/$/, "") || "/")) return "network-first";
  return null;
}

async function loadManifest() {
  const res = await fetch(`/_next/static/sw/precache-${VERSION}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`precache manifest ${res.status}`);
  const m = await res.json();
  ROUTES = new Set(m.routes);
  return m;
}

async function precache() {
  if (!CACHING) return;
  const m = await loadManifest();
  const cache = await caches.open(SHELL);
  try {
    // addAll is atomic per call; on any failure (quota, 404) drop the whole
    // cache and fail install so a half-populated shell is never activated.
    await cache.addAll([...m.routes, ...m.assets]);
  } catch (err) {
    await caches.delete(SHELL);
    throw err;
  }
}

async function dropOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k)));
  if (CACHING && ROUTES.size === 0) await loadManifest().catch(() => {});
}

self.addEventListener("install", (e) => e.waitUntil(precache())); // no skipWaiting()
self.addEventListener("activate", (e) => e.waitUntil(dropOldCaches().then(() => self.clients.claim())));
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  if (!CACHING) return;
  const strategy = routeFor(e.request, self.location.origin, ROUTES);
  if (strategy === "cache-first") e.respondWith(cacheFirst(e.request));
  else if (strategy === "network-first" && e.request.mode === "navigate") e.respondWith(networkFirst(e.request));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { cacheName: SHELL });
  return hit || fetch(req);
}

async function networkFirst(req) {
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS)),
    ]);
    if (res.ok) return res;
    throw new Error(`HTTP ${res.status}`);
  } catch {
    const path = new URL(req.url).pathname;
    const cache = await caches.open(SHELL);
    return (await cache.match(path)) || (await cache.match("/offline")) || Response.error();
  }
}

// ── push (mirror of lib/notifications/payload.ts) ──
const MARKET_ID_RE = /^\d{1,20}$/;
const TX_HASH_RE = /^[0-9a-f]{64}$/;
const TRACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const KINDS = ["TRADE_CONFIRMED", "MARKET_RESOLVED", "TRACE_PUBLISHED"];

function parsePayload(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== "object" || o.v !== 1 || !KINDS.includes(o.kind)) return null;
  if (typeof o.eventId !== "string" || !EVENT_ID_RE.test(o.eventId)) return null;
  if (typeof o.onChainMarketId !== "string" || !MARKET_ID_RE.test(o.onChainMarketId)) return null;
  if (o.txHash !== undefined && (typeof o.txHash !== "string" || !TX_HASH_RE.test(o.txHash))) return null;
  if (o.traceId !== undefined && (typeof o.traceId !== "string" || !TRACE_ID_RE.test(o.traceId))) return null;
  return { kind: o.kind, onChainMarketId: o.onChainMarketId, eventId: o.eventId };
}

// Public endpoints only: the worker has no JWT and never sends one.
async function getJson(path) {
  if (!API) return null;
  try {
    const res = await fetch(`${API}${path}`, { credentials: "omit", cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" ? body.data ?? null : null;
  } catch { return null; }
}

async function facts(p) {
  const id = p.onChainMarketId;
  const [market, state] = await Promise.all([getJson(`/markets/on-chain/${id}`), p.kind === "MARKET_RESOLVED" ? getJson(`/markets/on-chain/${id}/state`) : null]);
  const question = market && typeof market.question === "string" ? market.question.slice(0, 120) : null;
  const status = state && ["Open", "Resolved", "Void"].includes(state.status) ? state.status : null;
  const outcome = state && ["Yes", "No"].includes(state.outcome) ? state.outcome : null;
  return { question, status, outcome };
}

function build(p, f) {
  const url = `/markets/quick-view?onChainId=${p.onChainMarketId}&from=push`;
  const q = f.question || "a market you hold";
  if (p.kind === "MARKET_RESOLVED") {
    if (f.status === "Resolved" && f.outcome) return { title: "Market resolved", body: `${q} resolved ${f.outcome.toUpperCase()}. Open to check your position.`, url };
    if (f.status === "Void") return { title: "Market resolved", body: `${q} resolved void. Open to check your position.`, url };
    return { title: "OracleDesk", body: "A market you hold has an update.", url };
  }
  if (p.kind === "TRADE_CONFIRMED") return { title: "Trade confirmed", body: f.question ? `Your trade on ${q} was confirmed.` : "Your trade was confirmed.", url };
  return { title: "New reasoning trace", body: f.question ? `A new reasoning trace was published on ${q}.` : "A new reasoning trace was published on a market you hold.", url };
}

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const p = e.data ? parsePayload(await e.data.text()) : null;
    // Browsers penalise silent pushes: always show something.
    if (!p) return self.registration.showNotification("OracleDesk", { body: "OracleDesk has an update for you.", tag: "oracledesk-generic", data: { url: "/notifications" } });
    const n = build(p, await facts(p));
    return self.registration.showNotification(n.title, { body: n.body, tag: p.eventId, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: n.url } });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const raw = e.notification.data && e.notification.data.url;
  // Re-validate: only our two same-origin shapes are ever opened.
  const m = typeof raw === "string" && /^\/markets\/quick-view\?onChainId=(\d{1,20})&from=push$/.exec(raw);
  const path = m ? raw : "/notifications";
  const target = new URL(path, self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        await c.focus();
        return c.navigate ? c.navigate(target) : undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});

// Endpoint expired or rotated: there is no JWT here to re-post, so flag it and
// let the next page load resubscribe (see components/settings/push-settings.tsx).
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    all.forEach((c) => c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" }));
    const cache = await caches.open("oracledesk-flags");
    await cache.put("/__push-resubscribe", new Response("1"));
  })());
});
