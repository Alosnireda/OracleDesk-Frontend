"use client";

import React from "react";
import type { QuestionIntegrityCheck, QuestionIntegrityStatus } from "@/lib/stellar/market-question";

export interface QuestionVerificationBadgeProps {
  status: QuestionIntegrityStatus;
  result?: QuestionIntegrityCheck | null;
  compact?: boolean;
  className?: string;
}

export function QuestionVerificationBadge({
  status,
  result,
  compact = false,
  className = "",
}: QuestionVerificationBadgeProps) {
  if (status === "verified") {
    return (
      <span
        title={`Verified: Text matches on-chain question_hash commitment (${result?.committedHash?.slice(0, 8)}…)`}
        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20 shrink-0 ${className}`}
      >
        <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          verified
        </span>
        Question Verified
      </span>
    );
  }

  if (status === "mismatch") {
    return (
      <div
        role="alert"
        title={result?.reason ?? "Displayed question text differs from on-chain committed question"}
        className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-error bg-error/15 px-2.5 py-1 rounded-md border border-error shadow-sm ${className}`}
      >
        <span className="material-symbols-outlined text-[16px] animate-pulse">warning</span>
        <span>QUESTION MISMATCH: Do not trade without verifying chain!</span>
      </div>
    );
  }

  if (status === "unavailable") {
    if (compact) return null;
    return (
      <span
        title={result?.reason ?? "Question commitment could not be verified (IPFS unavailable)"}
        className={`inline-flex items-center gap-1 text-[10px] font-medium text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-outline-variant/50 shrink-0 ${className}`}
      >
        <span className="material-symbols-outlined text-[13px]">cloud_off</span>
        Unverified
      </span>
    );
  }

  // not-committed
  if (compact) return null;
  return (
    <span
      title="This market was created without an on-chain question_hash commitment"
      className={`inline-flex items-center gap-1 text-[10px] font-medium text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-outline-variant/50 shrink-0 ${className}`}
    >
      <span className="material-symbols-outlined text-[13px]">info</span>
      Not Committed
    </span>
  );
}
