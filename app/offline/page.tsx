"use client";
import { Icon } from "@/components/ui/icon";

import { useEffect, useState } from "react";
import { LAST_URL_KEY } from "@/components/pwa/pwa-registrar";

/** Served by the service worker when a navigation fails. Static: no data hooks. */
export default function OfflinePage() {
  const [target, setTarget] = useState("/markets");

  useEffect(() => {
    let cancelled = false;
    // Defer the read/setState so the effect only subscribes to the browser
    // storage side-effect; this also avoids a cascading render on mount.
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const last = window.sessionStorage.getItem(LAST_URL_KEY);
        // Same-origin paths only.
        if (last && last.startsWith("/") && !last.startsWith("//") && !last.startsWith("/offline")) {
          setTarget(last);
        }
      } catch {
        // storage blocked: keep the default
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-surface flex flex-col items-center justify-center p-6 text-center">
      <Icon name="cloud_off" className="text-outline text-6xl mb-4" aria-hidden />
      <h1 className="text-2xl font-bold text-on-surface mb-2">You&apos;re offline</h1>
      <p className="text-on-surface-variant max-w-md mb-2">
        OracleDesk can&apos;t reach the network, so prices, positions and balances can&apos;t be shown right now.
      </p>
      <p className="text-on-surface-variant max-w-md mb-6">Nothing will be signed or submitted while you&apos;re offline.</p>
      <button
        type="button"
        onClick={() => window.location.assign(target)}
        className="px-6 py-2 bg-primary text-white rounded-lg font-label-caps uppercase"
      >
        Try again
      </button>
    </main>
  );
}
