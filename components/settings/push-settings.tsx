"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/contexts/WalletContext";
import { listSubscriptions, PUSH_CATEGORIES, type PushCategory } from "@/lib/api/notifications";
import {
  DENIED_MESSAGE,
  detectPushSupport,
  storedPushCategories,
  storedPushWallet,
  subscribe,
  supportMessage,
  unsubscribe,
  type PushSupport,
} from "@/lib/notifications/push";

const LABELS: Record<PushCategory, { label: string; sub: string }> = {
  TRADE_CONFIRMED: { label: "My trade confirmed", sub: "When a buy, sell or redeem lands on-chain." },
  MARKET_RESOLVED: { label: "A market I hold resolved", sub: "So you know when you can redeem." },
  TRACE_PUBLISHED: { label: "New reasoning trace", sub: "On markets you hold." },
};

const DEFAULT_CATEGORIES: PushCategory[] = ["TRADE_CONFIRMED", "MARKET_RESOLVED"];

/** Real Web Push controls: opt-in, per-category, per-wallet. Every change is a user gesture. */
export function PushSettings() {
  const { address, isConnected, ensureSession, isAuthenticated, openModal } = useWallet();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [categories, setCategories] = useState<PushCategory[]>(DEFAULT_CATEGORIES);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsResubscribe, setNeedsResubscribe] = useState(false);

  useEffect(() => {
    // Browser-only state, read once after mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSupport(detectPushSupport());
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    const mine = storedPushWallet() !== null && storedPushWallet() === address;
    setEnabled(mine);
    const stored = storedPushCategories();
    if (mine && stored) setCategories(stored);
    /* eslint-enable react-hooks/set-state-in-effect */

    // The worker flags an expired/rotated endpoint; resubscribing needs a click.
    void caches?.open("oracledesk-flags").then(async (c) => {
      if (await c.match("/__push-resubscribe")) setNeedsResubscribe(true);
    }).catch(() => {});
    const onMsg = (e: MessageEvent) => e.data?.type === "PUSH_SUBSCRIPTION_CHANGED" && setNeedsResubscribe(true);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [address]);

  // Mirror server-side categories for this wallet when a session exists.
  useEffect(() => {
    if (!enabled || !isAuthenticated) return;
    let live = true;
    (async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      const endpoint = (await reg?.pushManager.getSubscription())?.endpoint;
      const subs = await listSubscriptions();
      const match = subs.find((s) => s.endpoint === endpoint);
      if (live && match) setCategories(match.categories);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, isAuthenticated]);

  const apply = async (next: PushCategory[]) => {
    if (!address) return;
    setBusy(true);
    setMessage(null);
    try {
      await subscribe(next, { wallet: address, ensureSession });
      setEnabled(true);
      setCategories(next);
      setNeedsResubscribe(false);
      await caches?.open("oracledesk-flags").then((c) => c.delete("/__push-resubscribe")).catch(() => {});
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't enable notifications.");
    } finally {
      setBusy(false);
      if (typeof Notification !== "undefined") setPermission(Notification.permission);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unsubscribe();
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (c: PushCategory) => {
    const next = categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c];
    if (enabled) {
      if (next.length === 0) void disable();
      else void apply(next);
    } else setCategories(next);
  };

  const sendTest = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.showNotification("OracleDesk", { body: "Test notification: push is working.", tag: "oracledesk-test", icon: "/icons/icon-192.png" });
  };

  if (support === null) return <p className="text-sm text-on-surface-variant">Checking notification support…</p>;

  if (support !== "supported") {
    return <p className="text-sm text-on-surface-variant" role="note">{supportMessage(support)}</p>;
  }

  if (!isConnected) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-on-surface-variant">Connect your wallet to get notified about your trades and markets.</p>
        <button type="button" onClick={() => void openModal()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold">Connect wallet</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {permission === "denied" && <p className="text-sm text-error" role="alert">{DENIED_MESSAGE}</p>}
      {needsResubscribe && enabled && (
        <p className="text-sm text-on-surface-variant" role="note">
          Your browser renewed its push subscription. <button type="button" className="underline" onClick={() => void apply(categories)}>Re-enable notifications</button>
        </p>
      )}

      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-body-md font-bold text-on-surface">Push notifications</p>
          <p className="text-[11px] text-on-surface-variant">
            For this wallet on this browser. Disconnecting or switching wallets turns them off.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || (permission === "denied" && !enabled) || (!enabled && categories.length === 0)}
          onClick={() => void (enabled ? disable() : apply(categories))}
          className="px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50 bg-primary text-white"
        >
          {busy ? "Working…" : enabled ? "Turn off" : "Turn on"}
        </button>
      </div>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="sr-only">Notification categories</legend>
        {PUSH_CATEGORIES.map((c) => (
          <label key={c} className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 accent-primary" checked={categories.includes(c)} onChange={() => toggleCategory(c)} />
            <span>
              <span className="block text-body-md font-bold text-on-surface">{LABELS[c].label}</span>
              <span className="block text-[11px] text-on-surface-variant">{LABELS[c].sub}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {enabled && (
        <button type="button" onClick={() => void sendTest()} className="text-sm underline text-primary">
          Send test notification
        </button>
      )}
      {message && <p className="text-sm text-error" role="alert">{message}</p>}
    </div>
  );
}
