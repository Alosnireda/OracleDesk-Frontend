"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TraceDiff, TraceVersion } from "@/lib/services/trace-history";

interface TraceHistoryViewerProps {
  marketId: string;
  diffs: TraceDiff[];
  isLoading?: boolean;
  error?: string | null;
}

export function TraceHistoryViewer({
  marketId,
  diffs,
  isLoading = false,
  error = null,
}: TraceHistoryViewerProps) {
  const [expandedDiff, setExpandedDiff] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-32 bg-surface-container-low animate-pulse rounded-lg border border-outline-variant"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-surface-container-low rounded-lg border border-error/20">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (diffs.length === 0) {
    return (
      <div className="p-6 text-center bg-surface-container-low rounded-lg border border-outline-variant">
        <p className="text-on-surface-variant">No trace history available for this market.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <h3 className="font-headline-sm text-headline-sm text-on-surface">Agent Trace History</h3>
        <span className="font-label-caps text-label-caps text-on-surface-variant">
          {diffs.length} version{diffs.length !== 1 ? "s" : ""}
        </span>
      </div>

      <AnimatePresence mode="popLayout">
        {diffs.map((diff, idx) => (
          <motion.div
            key={`${diff.from.traceId}-${diff.to.traceId}`}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="border border-outline-variant rounded-lg overflow-hidden bg-surface-container-low"
          >
            <button
              onClick={() => setExpandedDiff(expandedDiff === idx ? null : idx)}
              className="w-full p-4 flex items-center justify-between hover:bg-surface-container-high transition-colors"
            >
              <div className="flex-1 text-left">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-label-caps text-label-caps text-on-surface-variant">
                    v{idx + 1} → v{idx + 2}
                  </span>
                  {diff.decisionFlipped && (
                    <span className="px-2 py-0.5 bg-tertiary/20 text-tertiary rounded font-label-caps text-[10px] font-bold">
                      DECISION FLIPPED
                    </span>
                  )}
                  {diff.significantChange && !diff.decisionFlipped && (
                    <span className="px-2 py-0.5 bg-secondary/20 text-secondary rounded font-label-caps text-[10px] font-bold">
                      SIGNIFICANT CHANGE
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  {diff.probabilityChange && (
                    <div>
                      <span className="text-on-surface-variant text-xs">Probability:</span>
                      <span className="ml-2 font-data-mono text-on-surface font-bold">
                        {(diff.probabilityChange.from * 100).toFixed(1)}% →{" "}
                        {(diff.probabilityChange.to * 100).toFixed(1)}%
                      </span>
                      <span
                        className={`ml-2 font-bold ${
                          diff.probabilityChange.delta > 0 ? "text-secondary" : "text-tertiary"
                        }`}
                      >
                        {diff.probabilityChange.delta > 0 ? "+" : ""}
                        {(diff.probabilityChange.delta * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}

                  {diff.estimateChange && (
                    <div>
                      <span className="text-on-surface-variant text-xs">Edge:</span>
                      <span className="ml-2 font-data-mono text-on-surface font-bold">
                        {(diff.estimateChange.from * 100).toFixed(1)}% →{" "}
                        {(diff.estimateChange.to * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-on-surface-variant">
                <span className="material-symbols-outlined">
                  {expandedDiff === idx ? "expand_less" : "expand_more"}
                </span>
              </div>
            </button>

            <AnimatePresence>
              {expandedDiff === idx && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border-t border-outline-variant bg-surface p-4 space-y-6"
                >
                  {/* Source Changes */}
                  {(diff.sourceDiff.added.length > 0 ||
                    diff.sourceDiff.removed.length > 0 ||
                    diff.sourceDiff.modified.length > 0) && (
                    <div>
                      <h4 className="font-label-caps text-label-caps text-on-surface-variant mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-base">analytics</span>
                        Source Changes
                      </h4>
                      <div className="space-y-2 text-sm">
                        {diff.sourceDiff.added.length > 0 && (
                          <div className="p-3 bg-secondary/10 rounded border border-secondary/20">
                            <p className="font-bold text-secondary mb-2">
                              Added ({diff.sourceDiff.added.length})
                            </p>
                            <ul className="space-y-1 text-on-surface">
                              {diff.sourceDiff.added.map((src, i) => (
                                <li key={i} className="text-xs">
                                  <span className="font-medium">{src.name}</span>
                                  <span className="text-on-surface-variant ml-2">({(src.weight * 100).toFixed(1)}%)</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {diff.sourceDiff.removed.length > 0 && (
                          <div className="p-3 bg-tertiary/10 rounded border border-tertiary/20">
                            <p className="font-bold text-tertiary mb-2">
                              Removed ({diff.sourceDiff.removed.length})
                            </p>
                            <ul className="space-y-1 text-on-surface">
                              {diff.sourceDiff.removed.map((src, i) => (
                                <li key={i} className="text-xs">
                                  <span className="font-medium">{src.name}</span>
                                  <span className="text-on-surface-variant ml-2">({(src.weight * 100).toFixed(1)}%)</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {diff.sourceDiff.modified.length > 0 && (
                          <div className="p-3 bg-primary/10 rounded border border-primary/20">
                            <p className="font-bold text-primary mb-2">
                              Weight Changes ({diff.sourceDiff.modified.length})
                            </p>
                            <ul className="space-y-2 text-on-surface">
                              {diff.sourceDiff.modified.map((src, i) => (
                                <li key={i} className="text-xs">
                                  <div className="font-medium">{src.name}</div>
                                  <div className="text-on-surface-variant">
                                    {(src.weightBefore * 100).toFixed(1)}% → {(src.weightAfter * 100).toFixed(1)}%
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Trace Metadata */}
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div>
                      <span className="text-on-surface-variant">From (v{idx + 1}):</span>
                      <div className="text-on-surface font-data-mono mt-1">
                        {new Date(diff.from.publishedAt).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-on-surface-variant">To (v{idx + 2}):</span>
                      <div className="text-on-surface font-data-mono mt-1">
                        {new Date(diff.to.publishedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
