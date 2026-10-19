"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { registerWorker } from "@/lib/pwa/register";
import { UpdatePendingContext } from "@/lib/pwa/update-context";

export const LAST_URL_KEY = "oracledesk_last_url";

/**
 * Registers the service worker (production, secure origins only) and owns
 * the update flow: when a new worker is waiting, a non-dismissable banner
 * asks the user to reload, and signing is blocked until they do.
 */
export function PwaRegistrar({ children }: { children: ReactNode }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);
  const pathname = usePathname();

  // Remember where the user was, for the offline page's "Try again".
  useEffect(() => {
    if (pathname === "/offline") return;
    try {
      window.sessionStorage.setItem(LAST_URL_KEY, `${pathname}${window.location.search}`);
    } catch {
      // storage blocked
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    let reg: ServiceWorkerRegistration | null = null;

    const track = (r: ServiceWorkerRegistration) => {
      // Only a waiting worker *while another controls the page* is an update.
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const sw = r.installing;
        sw?.addEventListener("statechange", () => {
          if (!cancelled && sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(r.waiting ?? sw);
        });
      });
    };

    registerWorker()
      .then((r) => {
        if (!r || cancelled) return;
        reg = r;
        track(r);
      })
      .catch((err) => console.warn("[pwa] service worker registration failed", err));

    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Look for a new deployment when the tab comes back.
    const onVisible = () => document.visibilityState === "visible" && void reg?.update().catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <UpdatePendingContext.Provider value={waiting !== null}>
      {waiting && (
        <div role="alert" className="fixed bottom-0 inset-x-0 z-[100] bg-primary text-white px-4 py-3 flex flex-wrap items-center justify-center gap-3 text-sm">
          <span>A new version of OracleDesk is available. Reload to update.</span>
          <button
            type="button"
            onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
            className="px-4 py-1.5 bg-white text-primary rounded-md font-bold"
          >
            Reload
          </button>
        </div>
      )}
      {children}
    </UpdatePendingContext.Provider>
  );
}
