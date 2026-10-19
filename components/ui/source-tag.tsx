"use client";

import { isStale } from "@/lib/stellar/health";
import { useNow } from "@/lib/health/useTicker";

export interface SourceTagProps {
  /** "chain" values are read from the contract; "backend" are estimates. */
  source: "chain" | "backend";
  /** Ledger the value was read at, when known. */
  ledger?: number | null;
  /** Client wall-clock ms when the value was read (e.g. React Query dataUpdatedAt). */
  readAt?: number;
  /** Age past which a chain value is flagged stale. Default 60 s. */
  staleAfterSec?: number;
}

function ageLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} m ago`;
  return `${Math.floor(seconds / 3_600)} h ago`;
}

/**
 * The single source-of-truth pill used everywhere a value can come from the
 * chain or the backend. It carries the ledger and age in its accessible text
 * and switches to a "stale" variant once the value is too old to trust.
 */
export function SourceTag({ source, ledger = null, readAt, staleAfterSec = 60 }: SourceTagProps) {
  const now = useNow();
  const hasRead = typeof readAt === "number" && readAt > 0;
  const ageSec = hasRead ? Math.max(0, Math.round((now - (readAt as number)) / 1_000)) : null;
  const stale = hasRead && isStale(readAt, now, staleAfterSec);
  const chain = source === "chain";

  const detail = [
    ledger !== null ? `at ledger ${ledger}` : null,
    ageSec !== null ? ageLabel(ageSec) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const title = chain
    ? `Read live from the market contract${detail ? `, ${detail}` : ""}`
    : "OracleDesk backend estimate; may lag the chain";

  const palette = chain
    ? stale
      ? "bg-error-container text-on-error-container"
      : "bg-secondary-container text-on-secondary-container"
    : "bg-surface-container-highest text-on-surface-variant";

  return (
    <span title={title} className={`ml-1 text-[9px] font-bold uppercase px-1 rounded ${palette}`}>
      {stale ? `${source} · stale` : source}
      {detail && <span className="sr-only">{`, ${detail}`}</span>}
    </span>
  );
}
