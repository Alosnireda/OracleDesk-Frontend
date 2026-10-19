import { deleteSubscription, getVapidKey, putSubscription, type PushCategory } from "@/lib/api/notifications";
import { ensureWorkerRegistration } from "@/lib/pwa/register";

export type Category = PushCategory;
export type PushSupport = "supported" | "needs-install-ios" | "unsupported" | "insecure-context";

const STORAGE_KEY = "oracledesk_push";

interface StoredPush {
  subscriptionId: string;
  wallet: string;
  categories: Category[];
}

/** Environment checks, injectable for tests. */
export interface PushEnv {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
}

function browserEnv(): PushEnv | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
  };
}

function isIos(env: PushEnv): boolean {
  // iPadOS 13+ reports a Mac user agent; touch points tell them apart.
  return /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
}

export function detectPushSupport(env: PushEnv | null = browserEnv()): PushSupport {
  if (!env) return "unsupported";
  if (!env.isSecureContext) return "insecure-context";
  // iOS/iPadOS 16.4+ exposes push only to Home Screen web apps.
  if (isIos(env) && !env.standalone) return "needs-install-ios";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  return "supported";
}

export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readStored(): StoredPush | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPush;
    return typeof v?.subscriptionId === "string" && typeof v?.wallet === "string" ? v : null;
  } catch {
    return null;
  }
}

function writeStored(v: StoredPush | null) {
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the server copy is still the source of truth
  }
}

/** The wallet that owns this browser's push subscription, if any. */
export function storedPushWallet(): string | null {
  if (typeof window === "undefined") return null;
  return readStored()?.wallet ?? null;
}

export function storedPushCategories(): Category[] | null {
  if (typeof window === "undefined") return null;
  return readStored()?.categories ?? null;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/**
 * Must be called from a user gesture (click): Safari and Firefox refuse
 * permission prompts and subscriptions otherwise. Never call on page load.
 *
 * `ensureSession` runs the wallet challenge login so the PUT is authenticated
 * for `wallet`.
 */
export async function subscribe(
  categories: Category[],
  ctx: { wallet: string; ensureSession: () => Promise<boolean> },
): Promise<{ id: string }> {
  const support = detectPushSupport();
  if (support !== "supported") throw new Error(supportMessage(support));

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? DENIED_MESSAGE : "Notifications were not enabled.");

  const registration = await ensureWorkerRegistration();
  const key = urlBase64ToUint8Array(await getVapidKey());

  let sub = await registration.pushManager.getSubscription();
  // VAPID key rotated on the server: the old subscription can't be reused.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    try {
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    } catch (err) {
      if ((err as DOMException)?.name !== "InvalidStateError") throw err;
      await (await registration.pushManager.getSubscription())?.unsubscribe().catch(() => {});
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    }
  }

  if (!(await ctx.ensureSession())) {
    await sub.unsubscribe().catch(() => {});
    throw new Error("Sign in with your wallet to enable notifications.");
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("The browser returned an incomplete push subscription.");
  const { id } = await putSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    categories,
    userAgent: navigator.userAgent.slice(0, 256),
  });
  writeStored({ subscriptionId: id, wallet: ctx.wallet, categories });
  return { id };
}

/** Best effort on the server; always removes the browser subscription and local state. */
export async function unsubscribe(): Promise<void> {
  if (typeof window === "undefined") return;
  const stored = readStored();
  writeStored(null);
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    }
  } catch {
    // ignore: nothing to remove
  }
  if (stored) await deleteSubscription(stored.subscriptionId).catch(() => {});
}

export const DENIED_MESSAGE =
  "Notifications are blocked for this site. Allow them in your browser's site settings (the lock icon in the address bar), then try again.";

export function supportMessage(s: PushSupport): string {
  switch (s) {
    case "needs-install-ios":
      return "On iPhone or iPad, add OracleDesk to your Home Screen first (Share → Add to Home Screen), then open it from there.";
    case "insecure-context":
      return "Notifications need a secure (https) connection.";
    case "unsupported":
      return "This browser doesn't support web push notifications.";
    default:
      return "";
  }
}
