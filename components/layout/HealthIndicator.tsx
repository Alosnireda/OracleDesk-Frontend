"use client";

import { useEffect, useRef, useState } from "react";
import { useHealth, type OverallHealth } from "@/lib/health/HealthProvider";
import type { SocketStatus } from "@/lib/realtime/RealtimeProvider";

const OVERALL_LABEL: Record<OverallHealth, string> = {
  live: "Live",
  degraded: "Degraded",
  offline: "Offline",
  checking: "Checking…",
};

const OVERALL_DOT: Record<OverallHealth, string> = {
  live: "bg-secondary",
  degraded: "bg-tertiary",
  offline: "bg-error",
  checking: "bg-outline",
};

const SOCKET_LABEL: Record<SocketStatus, string> = {
  connected: "connected",
  reconnecting: "reconnecting",
  offline: "offline",
  unknown: "checking…",
};

function ago(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/**
 * Honest status for the three data paths. Replaces the decorative pulsing dot:
 * the label is text, not colour-only, and the popover lists each probe with a
 * manual retry. Polling itself lives in the health monitor.
 */
export function HealthIndicator() {
  const health = useHealth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const rows = [
    { name: "Socket", value: SOCKET_LABEL[health.socket] },
    {
      name: "Stellar RPC",
      value:
        health.rpc.status === "ok"
          ? `ok · ledger ${health.rpc.latestLedger ?? "—"} (${ago(health.rpc.ledgerAgeSec)})`
          : `${health.rpc.status}${health.rpc.latestLedger !== null ? ` · ledger ${health.rpc.latestLedger}` : ""}`,
    },
    { name: "Backend API", value: health.backend.status },
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Connection status: ${OVERALL_LABEL[health.overall]}`}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-outline-variant hover:bg-surface-container transition-colors"
      >
        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${OVERALL_DOT[health.overall]}`} />
        <span className="font-label-caps text-label-caps text-on-surface-variant">{OVERALL_LABEL[health.overall]}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Data freshness and connection health"
          className="absolute right-0 top-full mt-2 w-72 bg-white border border-outline-variant rounded-lg shadow-xl p-4 z-50"
        >
          <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-3">Data sources</p>
          <ul className="space-y-2 mb-3">
            {rows.map((row) => (
              <li key={row.name} className="flex justify-between gap-3 text-body-md">
                <span className="text-on-surface-variant">{row.name}</span>
                <span className="font-data-mono text-on-surface text-right">{row.value}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-on-surface-variant mb-3">
            Health polling pauses while this tab is hidden and backs off when a probe fails.
          </p>
          <button
            type="button"
            onClick={() => health.retry()}
            className="w-full py-2 bg-primary text-primary-foreground rounded font-label-caps text-label-caps hover:opacity-90"
          >
            Retry now
          </button>
        </div>
      )}
    </div>
  );
}
