"use client";

import React, { useMemo, useState } from "react";
import { validateTraceContent, type ValidatedTraceContent } from "@/lib/stellar/trace-schema";

export interface SafeTraceViewerProps {
  content: unknown;
  verified?: boolean;
  ipfsCid?: string | null;
  traceHash?: string | null;
  className?: string;
  title?: string;
}

export function SafeTraceViewer({
  content,
  verified = true,
  ipfsCid,
  traceHash,
  className = "",
  title,
}: SafeTraceViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const validation = useMemo(() => validateTraceContent(content), [content]);

  const copyJson = () => {
    if (!validation.ok) return;
    navigator.clipboard?.writeText(JSON.stringify(validation.data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!validation.ok) {
    return (
      <div className={`rounded-xl border border-error/30 bg-error-container/10 p-6 ${className}`}>
        <div className="flex items-center gap-3 text-error mb-2">
          <span className="material-symbols-outlined">warning</span>
          <h4 className="font-headline-sm text-headline-sm">Trace Content Schema Error</h4>
        </div>
        <p className="text-body-md text-on-surface-variant mb-4">{validation.error}</p>
        <div className="p-4 bg-surface-container-low rounded-lg font-data-mono text-xs overflow-x-auto text-on-surface">
          {String(content)}
        </div>
      </div>
    );
  }

  const { data, warnings } = validation;
  const hasUnknownFields = Object.keys(data.rawUnknownFields).length > 0;
  const probPercent = data.probabilityEstimate !== undefined ? Math.round(data.probabilityEstimate * 100) : null;
  const edgePercent = data.edge !== undefined ? (data.edge > 0 ? `+${(data.edge * 100).toFixed(1)}%` : `${(data.edge * 100).toFixed(1)}%`) : null;

  return (
    <div className={`rounded-xl border border-outline-variant bg-surface overflow-hidden ${className}`}>
      {/* Header bar */}
      <div className="p-6 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-primary/10 text-primary px-2.5 py-0.5 rounded text-label-caps font-label-caps font-bold">
              SCHEMA v{data.version}
            </span>
            {data.agent && (
              <span className="bg-surface-container text-on-surface px-2.5 py-0.5 rounded text-label-caps font-label-caps font-bold">
                AGENT: {data.agent}
              </span>
            )}
            {data.action && (
              <span
                className={`px-2.5 py-0.5 rounded text-label-caps font-label-caps font-bold uppercase ${
                  data.action.toUpperCase().includes("BUY") || data.action.toUpperCase().includes("YES")
                    ? "bg-secondary-container text-on-secondary-container"
                    : data.action.toUpperCase().includes("SELL") || data.action.toUpperCase().includes("NO")
                      ? "bg-tertiary-container text-on-tertiary-container"
                      : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {data.action}
              </span>
            )}
            {verified ? (
              <span className="flex items-center gap-1 text-secondary text-label-caps font-label-caps font-bold">
                <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  verified
                </span>
                Verified Content
              </span>
            ) : (
              <span className="flex items-center gap-1 text-on-surface-variant text-label-caps font-label-caps">
                <span className="material-symbols-outlined text-[16px]">visibility</span>
                Preview Content
              </span>
            )}
          </div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface">
            {title || data.decisionType || "Agent Decision Reasoning"}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyJson}
            className="px-3 py-1.5 bg-surface border border-outline-variant rounded font-label-caps text-xs text-on-surface hover:bg-surface-container transition-colors flex items-center gap-1.5"
            title="Copy sanitized JSON"
          >
            <span className="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
            {copied ? "COPIED" : "COPY JSON"}
          </button>
        </div>
      </div>

      {/* Warnings Banner if any URLs or fields were filtered */}
      {warnings && warnings.length > 0 && (
        <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2">
          <span className="material-symbols-outlined text-sm mt-0.5 text-amber-600">info</span>
          <div>
            <span className="font-bold">Sanitization notes: </span>
            {warnings.join("; ")}
          </div>
        </div>
      )}

      {/* Metric Tiles: Probability, Edge, Confidence */}
      {(probPercent !== null || edgePercent !== null || data.confidence !== undefined || data.betSizeUsdc !== undefined) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6 border-b border-outline-variant bg-surface-container-lowest">
          {probPercent !== null && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">PROBABILITY</p>
              <p className="font-data-mono text-headline-md text-primary font-bold">{probPercent}%</p>
              <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mt-1.5">
                <div className="h-full bg-primary" style={{ width: `${probPercent}%` }}></div>
              </div>
            </div>
          )}

          {edgePercent !== null && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">EDGE</p>
              <p className="font-data-mono text-headline-md text-secondary font-bold">{edgePercent}</p>
              {data.confidenceInterval && (
                <p className="text-[10px] text-on-surface-variant font-data-mono mt-1">
                  CI: {Math.round(data.confidenceInterval.lower * 100)}% - {Math.round(data.confidenceInterval.upper * 100)}%
                </p>
              )}
            </div>
          )}

          {data.confidence !== undefined && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">CONFIDENCE</p>
              <p className="font-data-mono text-headline-md text-on-surface font-bold">
                {Math.round(data.confidence * 100)}%
              </p>
            </div>
          )}

          {data.betSizeUsdc !== undefined && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">BET SIZE</p>
              <p className="font-data-mono text-headline-md text-on-surface font-bold">
                ${data.betSizeUsdc.toLocaleString()} USDC
              </p>
              {data.betFraction !== undefined && (
                <p className="text-[10px] text-on-surface-variant font-data-mono mt-1">
                  Fraction: {(data.betFraction * 100).toFixed(1)}%
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Reasoning Body */}
      {data.reasoning && (
        <div className="p-6 border-b border-outline-variant">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-base">psychology</span>
            Reasoning & Analysis
          </h4>
          <div className="space-y-3 font-body-md text-on-surface leading-relaxed whitespace-pre-wrap break-words bg-surface-container-low/50 p-4 rounded-lg border border-outline-variant/50">
            {data.reasoning}
          </div>
        </div>
      )}

      {/* Sources Used */}
      {data.sources.length > 0 && (
        <div className="p-6 border-b border-outline-variant">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-base">balance</span>
            Sources & Weighting ({data.sources.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.sources.map((source, i) => (
              <div
                key={`${source.name}-${i}`}
                className="p-4 bg-surface-container-low rounded-lg border border-outline-variant flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-body-md font-semibold text-on-surface truncate pr-2">
                      {source.name}
                    </span>
                    <span className="font-data-mono text-xs font-bold text-primary">
                      {Math.round(source.weight * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.round(source.weight * 100)}%` }}
                    ></div>
                  </div>
                  {source.signal && (
                    <p className="text-xs text-on-surface-variant italic leading-relaxed break-words line-clamp-4">
                      &quot;{source.signal}&quot;
                    </p>
                  )}
                </div>

                {source.url && (
                  <div className="mt-3 pt-2 border-t border-outline-variant/30 flex justify-end">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline flex items-center gap-1 font-label-caps"
                    >
                      <span>External Source</span>
                      <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conditions / Hedge Requirements */}
      {data.conditions && data.conditions.length > 0 && (
        <div className="p-6 border-b border-outline-variant">
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-base">verified_user</span>
            Hedge & Execution Conditions
          </h4>
          <ul className="space-y-2">
            {data.conditions.map((cond, i) => (
              <li
                key={i}
                className="text-xs text-on-surface bg-surface-container-low p-2.5 rounded border border-outline-variant/60 flex items-start gap-2"
              >
                <span className="material-symbols-outlined text-secondary text-sm shrink-0 mt-0.5">check_circle</span>
                <span className="break-words">{cond}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inert / Additional Fields Accordion */}
      {hasUnknownFields && (
        <div className="p-6 bg-surface-container-lowest border-t border-outline-variant">
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="w-full flex items-center justify-between text-left font-label-caps text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">data_object</span>
              Additional Fields (Inert Data)
            </span>
            <span className="material-symbols-outlined text-sm">
              {showRaw ? "expand_less" : "expand_more"}
            </span>
          </button>

          {showRaw && (
            <div className="mt-4 p-4 bg-on-background text-[#6ffbbe] rounded-lg font-data-mono text-xs overflow-x-auto max-h-80 custom-scrollbar">
              <pre>{JSON.stringify(data.rawUnknownFields, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Metadata footer */}
      {(ipfsCid || traceHash) && (
        <div className="p-4 bg-surface-container-low border-t border-outline-variant text-[11px] text-on-surface-variant flex flex-wrap gap-4 items-center justify-between font-data-mono">
          {traceHash && <span>HASH: {traceHash.slice(0, 16)}…{traceHash.slice(-8)}</span>}
          {ipfsCid && <span>IPFS: {ipfsCid}</span>}
        </div>
      )}
    </div>
  );
}
