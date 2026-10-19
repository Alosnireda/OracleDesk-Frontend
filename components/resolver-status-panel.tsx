"use client";

import React, { useEffect, useState } from "react";
import type { ResolutionSpec } from "@/lib/api/markets";
import {
  formatResolutionSpec,
  verifyResolutionCommitment,
  type ResolutionVerificationResult,
} from "@/lib/stellar/resolution-spec";

const SourceTag = ({ source }: { source: "chain" | "backend" }) => (
  <span
    title={source === "chain" ? "Read live from the market contract" : "OracleDesk backend estimate; may lag the chain"}
    className={`ml-1 text-[9px] font-bold uppercase px-1 rounded ${
      source === "chain"
        ? "bg-secondary-container text-on-secondary-container"
        : "bg-surface-container-highest text-on-surface-variant"
    }`}
  >
    {source}
  </span>
);

export interface ResolverStatusPanelProps {
  resolverState?: "Unconfigured" | "SignersPending" | "Finalized" | string;
  marketStatus?: string;
  resolutionHash?: Buffer | Uint8Array | string | null;
  resolutionSpec?: ResolutionSpec | null;
  className?: string;
}

export function ResolverStatusPanel({
  resolverState = "Unconfigured",
  marketStatus,
  resolutionHash,
  resolutionSpec,
  className = "",
}: ResolverStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [verification, setVerification] = useState<ResolutionVerificationResult | null>(null);

  useEffect(() => {
    let active = true;
    void verifyResolutionCommitment(resolutionSpec, resolutionHash).then((res) => {
      if (active) setVerification(res);
    });
    return () => {
      active = false;
    };
  }, [resolutionSpec, resolutionHash]);

  const formattedWords = formatResolutionSpec(resolutionSpec);
  const hashString = verification?.onChainHash ?? "";

  return (
    <div className={`rounded-xl border border-outline-variant bg-surface overflow-hidden ${className}`}>
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between bg-surface-container-low hover:bg-surface-container transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-base">rule</span>
          <h3 className="font-headline-sm text-headline-sm text-on-surface">Market Resolution & Commitment</h3>
          {verification?.status === "verified" && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20">
              <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified
              </span>
              Commitment Verified
            </span>
          )}
          {verification?.status === "mismatch" && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-error bg-error/15 px-2 py-0.5 rounded border border-error animate-pulse">
              <span className="material-symbols-outlined text-[13px]">warning</span>
              Spec Hash Mismatch
            </span>
          )}
        </div>
        <span className="material-symbols-outlined text-on-surface-variant text-sm">
          {isOpen ? "expand_less" : "expand_more"}
        </span>
      </button>

      {/* Panel Content */}
      {isOpen && (
        <div className="p-5 space-y-4 border-t border-outline-variant bg-surface">
          {/* Status Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
              <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                RESOLVER STATE <SourceTag source="chain" />
              </span>
              <span className="font-data-mono text-body-md text-on-surface font-semibold">
                {resolverState}
              </span>
            </div>

            {marketStatus && (
              <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
                <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                  MARKET-CORE STATUS <SourceTag source="chain" />
                </span>
                <span className="font-data-mono text-body-md text-on-surface font-semibold">
                  {marketStatus}
                </span>
              </div>
            )}
          </div>

          {/* Revealed Spec in Plain Words */}
          <div className="p-4 bg-surface-container-lowest rounded-lg border border-outline-variant">
            <div className="flex items-center justify-between mb-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                REVEALED RESOLUTION SPEC <SourceTag source="backend" />
              </span>
              {verification?.status === "verified" ? (
                <span className="text-[11px] font-bold text-secondary flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>
                    check_circle
                  </span>
                  Matches on-chain commitment
                </span>
              ) : verification?.status === "mismatch" ? (
                <span className="text-[11px] font-bold text-error flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">error</span>
                  Hash mismatch (do not trust!)
                </span>
              ) : null}
            </div>

            {resolutionSpec ? (
              <p className="font-body-md text-on-surface font-medium leading-relaxed">
                {formattedWords}
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant italic">
                A market without a revealed spec has not yet disclosed its resolution rule on-chain.
              </p>
            )}
          </div>

          {/* Commitment Hash Verification Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
              <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                COMMITTED HASH (ON-CHAIN) <SourceTag source="chain" />
              </span>
              <code className="text-xs break-all font-data-mono text-on-surface block">
                {hashString ? hashString : "No commitment hash on-chain"}
              </code>
            </div>

            <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
              <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                RECOMPUTED SPEC HASH (LOCAL)
              </span>
              <code
                className={`text-xs break-all font-data-mono block ${
                  verification?.status === "verified"
                    ? "text-secondary font-bold"
                    : verification?.status === "mismatch"
                      ? "text-error font-bold"
                      : "text-on-surface-variant"
                }`}
              >
                {verification?.computedHash ?? (resolutionSpec ? "Computing…" : "No revealed spec to hash")}
              </code>
            </div>
          </div>

          {/* Strong Warning on Mismatch */}
          {verification?.status === "mismatch" && (
            <div
              role="alert"
              className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-xs flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">warning</span>
              <div>
                <span className="font-bold">CRITICAL WARNING: </span>
                The backend&apos;s displayed resolution spec does not hash to the on-chain commitment hash.
                The market may settle according to different rules!
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
