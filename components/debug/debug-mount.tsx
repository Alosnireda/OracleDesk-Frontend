"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { DEBUG_ENABLED } from "@/lib/diagnostics/flags";

// DEBUG_ENABLED is a compile-time constant, so in production builds without
// the flag these imports are dead code and never reach the bundle.
const DebugPanel = DEBUG_ENABLED ? dynamic(() => import("./debug-panel"), { ssr: false }) : () => null;

const OPEN_KEY = "oracledesk_debug_open";

export type DebugTab = "config" | "wallet" | "cache" | "simulations" | "rpc" | "errors";

/** Opens with ?debug=1 (or ?debug=rpc) or Ctrl/Cmd+Shift+D. "Open" lives in sessionStorage only. */
export function DebugMount() {
  const [tab, setTab] = useState<DebugTab | null>(null);

  useEffect(() => {
    if (!DEBUG_ENABLED) return;
    const q = new URLSearchParams(window.location.search).get("debug");
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(OPEN_KEY);
    } catch {
      // storage blocked
    }
    const initial = q === "rpc" ? "rpc" : q === "1" ? "config" : (stored as DebugTab | null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only state once on mount
    if (initial) setTab(initial);

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setTab((t) => (t ? null : "config"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!DEBUG_ENABLED) return;
    try {
      if (tab) window.sessionStorage.setItem(OPEN_KEY, tab);
      else window.sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // storage blocked
    }
  }, [tab]);

  if (!DEBUG_ENABLED || !tab) return null;
  return <DebugPanel initialTab={tab} onClose={() => setTab(null)} />;
}
