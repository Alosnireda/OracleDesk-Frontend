import { API_URL } from "@/lib/api/client";

/**
 * Service worker registration. Production + secure origin only; in dev any
 * worker left over from a production build is unregistered (stale dev caches
 * are a classic trap).
 */

export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
export const SW_ENABLED = process.env.NODE_ENV === "production";

/** v = build id (cache namespace); api = backend base for the worker's public push reads. */
export function workerUrl(): string {
  return `/sw.js?v=${encodeURIComponent(BUILD_ID || "dev")}&api=${encodeURIComponent(API_URL)}`;
}

function canRegister(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!canRegister()) return null;
  if (!SW_ENABLED) {
    // Drop production-build workers; keep the push-only dev worker (v=dev, no caching).
    await unregisterAll((r) => !r.active?.scriptURL.includes("v=dev"));
    return null;
  }
  return navigator.serviceWorker.register(workerUrl(), { scope: "/", updateViaCache: "none" });
}

export async function unregisterAll(filter: (r: ServiceWorkerRegistration) => boolean = () => true): Promise<void> {
  if (!canRegister()) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.filter(filter).map((r) => r.unregister()));
}

/**
 * The registration push needs. In production that is the app's worker; in
 * dev (no app worker) the same file is registered so push can be tested, and
 * it serves no cache because the precache manifest doesn't exist in dev.
 */
export async function ensureWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!canRegister()) throw new Error("Service workers aren't available here.");
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return navigator.serviceWorker.ready;
  await navigator.serviceWorker.register(workerUrl(), { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}
