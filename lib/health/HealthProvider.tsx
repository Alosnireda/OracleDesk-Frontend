"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createHealthMonitor, type BackendHealth, type HealthSample, type RpcHealth } from "@/lib/stellar/health";
import { useRealtimeStatus, type SocketStatus } from "@/lib/realtime/RealtimeProvider";

/** One word for the navbar, derived from the three probes. */
export type OverallHealth = "live" | "degraded" | "offline" | "checking";

export interface HealthState {
  socket: SocketStatus;
  rpc: RpcHealth;
  backend: BackendHealth;
  overall: OverallHealth;
  /** Force an immediate re-probe of both paths. */
  retry: () => void;
}

const initialSample: HealthSample = {
  rpc: { status: "down", latestLedger: null, ledgerAgeSec: null, checkedAt: 0 },
  backend: { status: "down", checkedAt: 0 },
};

const HealthContext = createContext<HealthState | null>(null);

/**
 * Mounts the health monitor once and combines it with the realtime socket
 * state. Initial render is deterministic ("checking") on both server and
 * client, so statically prerendered pages hydrate without a warning.
 */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [sample, setSample] = useState<HealthSample>(initialSample);
  const [monitor] = useState(() => createHealthMonitor());
  const socket = useRealtimeStatus();

  useEffect(() => {
    const unsubscribe = monitor.subscribe(setSample);
    monitor.start();
    return () => {
      unsubscribe();
      monitor.stop();
    };
  }, [monitor]);

  const checked = sample.rpc.checkedAt > 0 || sample.backend.checkedAt > 0;
  const overall = useMemo<OverallHealth>(() => {
    if (!checked) return "checking";
    if (sample.rpc.status === "down" && sample.backend.status === "down" && socket === "offline") return "offline";
    if (
      sample.rpc.status !== "ok" ||
      sample.backend.status !== "ok" ||
      socket === "offline" ||
      socket === "reconnecting"
    ) {
      return "degraded";
    }
    return "live";
  }, [sample, socket, checked]);

  const value = useMemo<HealthState>(
    () => ({ socket, rpc: sample.rpc, backend: sample.backend, overall, retry: () => monitor.refresh() }),
    [socket, sample, overall, monitor],
  );

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthState {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error("HealthProvider is missing");
  return ctx;
}
