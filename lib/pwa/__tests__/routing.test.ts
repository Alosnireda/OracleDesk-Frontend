import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeFor, type RequestLike } from "../routing";

const ORIGIN = "https://app.oracledesk.example";
const ROUTES = new Set(["/", "/markets", "/portfolio", "/offline", "/markets/quick-view"]);

// The same routeFor, extracted from public/sw.js, so the worker and the TS module are tested alike.
const swSource = readFileSync(join(__dirname, "../../../public/sw.js"), "utf8");
const swFn = swSource.slice(swSource.indexOf("function routeFor"), swSource.indexOf("async function loadManifest"));
const swRouteFor = new Function(`${swFn}; return routeFor;`)() as typeof routeFor;

const req = (url: string, method = "GET", headers: Record<string, string> = {}): RequestLike => {
  const h = new Headers(headers);
  return { url, method, headers: h };
};

describe.each([
  ["lib/pwa/routing.ts", routeFor],
  ["public/sw.js", swRouteFor],
])("%s routeFor", (_name, fn) => {
  it("ignores cross-origin requests (RPC, backend, IPFS, x402)", () => {
    expect(fn(req("https://soroban-testnet.stellar.org/"), ORIGIN, ROUTES)).toBeNull();
    expect(fn(req("https://oracledesk-backend.onrender.com/api/v1/markets"), ORIGIN, ROUTES)).toBeNull();
    expect(fn(req("https://ipfs.io/ipfs/bafy"), ORIGIN, ROUTES)).toBeNull();
    expect(fn(req("chrome-extension://abc/popup.html"), ORIGIN, ROUTES)).toBeNull();
  });

  it("ignores requests with Authorization", () => {
    expect(fn(req(`${ORIGIN}/markets`, "GET", { Authorization: "Bearer x" }), ORIGIN, ROUTES)).toBeNull();
  });

  it("ignores non-GET and range requests", () => {
    expect(fn(req(`${ORIGIN}/markets`, "POST"), ORIGIN, ROUTES)).toBeNull();
    expect(fn(req(`${ORIGIN}/_next/static/media/a.mp4`, "GET", { Range: "bytes=0-" }), ORIGIN, ROUTES)).toBeNull();
  });

  it("handles hashed static assets cache-first", () => {
    expect(fn(req(`${ORIGIN}/_next/static/chunks/abc123.js`), ORIGIN, ROUTES)).toBe("cache-first");
    expect(fn(req(`${ORIGIN}/icons/icon-192.png`), ORIGIN, ROUTES)).toBe("cache-first");
  });

  it("handles prerendered routes network-first", () => {
    expect(fn(req(`${ORIGIN}/markets`), ORIGIN, ROUTES)).toBe("network-first");
    expect(fn(req(`${ORIGIN}/markets/quick-view?marketId=5`), ORIGIN, ROUTES)).toBe("network-first");
    expect(fn(req(`${ORIGIN}/not-a-route`), ORIGIN, ROUTES)).toBeNull();
  });

  it("ignores socket.io and /api paths", () => {
    expect(fn(req(`${ORIGIN}/socket.io/?EIO=4&transport=polling`), ORIGIN, ROUTES)).toBeNull();
    expect(fn(req(`${ORIGIN}/api/anything`), ORIGIN, ROUTES)).toBeNull();
  });
});
