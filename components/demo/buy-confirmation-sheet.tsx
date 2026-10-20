"use client";
import { Icon, type IconName } from "@/components/ui/icon";

import React from "react";

/**
 * Data-agnostic buy-confirmation sheet, extracted from the retired
 * buy-yes-demo, buy-no-demo and execution-terminal demo pages (issue #49).
 * Presentational only: every number comes in through props and every action
 * is a callback. It is rendered by the design gallery under /dev/gallery; it
 * is not wired into any production flow.
 */

export interface BuySheetDetailRow {
  label: string;
  value: string;
  /** Emphasised colouring for the value (e.g. payout). */
  emphasis?: boolean;
  /** Small second line under the value. */
  sub?: string;
}

export interface BuyConfirmationSheetProps {
  /** Small caps kicker above the title, e.g. "Execution Terminal". */
  eyebrow: string;
  title: React.ReactNode;
  /** 0–100. */
  yesPercent: number;
  /** 0–100. */
  noPercent: number;
  amount: string;
  onAmountChange?: (value: string) => void;
  /** Right-hand hint next to the amount label, e.g. an available balance. */
  available?: string;
  /** Grid of computed rows (shares, fees, payout…). */
  details: BuySheetDetailRow[];
  /** Optional side note above the action button. */
  insight?: { icon: IconName; text: React.ReactNode };
  action: { label: React.ReactNode; tone: "yes" | "no"; onAction: () => void; disabled?: boolean };
  footnote?: string;
  onClose?: () => void;
}

export function BuyConfirmationSheet({
  eyebrow,
  title,
  yesPercent,
  noPercent,
  amount,
  onAmountChange,
  available,
  details,
  insight,
  action,
  footnote,
  onClose,
}: BuyConfirmationSheetProps) {
  const toneClass = action.tone === "yes" ? "bg-secondary" : "bg-tertiary";
  return (
    <div className="bg-surface-container-lowest w-full max-w-[480px] rounded-xl shadow-2xl overflow-hidden border border-outline-variant animate-in fade-in zoom-in duration-300">
      {/* Header */}
      <div className="p-5 sm:p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <div>
          <span
            className={`font-label-caps text-label-caps uppercase tracking-widest block mb-1 ${
              action.tone === "yes" ? "text-secondary" : "text-tertiary"
            }`}
          >
            {eyebrow}
          </span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="text-on-surface-variant hover:text-on-surface transition-colors p-2">
            <Icon name="close" />
          </button>
        )}
      </div>

      {/* Probability bar */}
      <div className="px-4 sm:px-6 py-4 bg-surface-container-lowest">
        <div className="flex justify-between font-label-caps text-label-caps mb-2 text-[10px] sm:text-xs font-bold">
          <span className="text-secondary">YES {yesPercent}%</span>
          <span className="text-tertiary">NO {noPercent}%</span>
        </div>
        <div className="h-1.5 w-full bg-surface-container rounded-full flex overflow-hidden">
          <div className="h-full bg-secondary transition-all duration-700" style={{ width: `${yesPercent}%` }}></div>
          <div className="h-full bg-tertiary transition-all duration-700" style={{ width: `${noPercent}%` }}></div>
        </div>
      </div>

      {/* Form */}
      <div className="p-5 sm:p-6 space-y-6">
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <label className="font-label-caps text-label-caps text-on-surface-variant" htmlFor="buy-sheet-amount">
              Investment Amount
            </label>
            {available && (
              <span className="text-[10px] sm:text-[11px] text-on-surface-variant">
                Available: <span className="font-data-mono font-bold text-on-surface">{available}</span>
              </span>
            )}
          </div>
          <div className="relative">
            <input
              id="buy-sheet-amount"
              className="w-full bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-4 py-3 sm:py-4 font-headline-md text-xl sm:text-headline-md text-on-surface outline-none transition-all placeholder:text-outline-variant"
              placeholder="0.00"
              type="number"
              value={amount}
              onChange={onAmountChange ? (e) => onAmountChange(e.target.value) : undefined}
              readOnly={!onAmountChange}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-label-caps text-label-caps text-on-surface-variant">
              USDC
            </span>
          </div>
        </div>

        {/* Details grid */}
        <div className="bg-surface-container-low rounded-lg p-4 space-y-3 border border-outline-variant">
          {details.map((row) => (
            <div key={row.label} className="flex justify-between items-center text-sm sm:text-base">
              <span className="font-body-md text-on-surface-variant">{row.label}</span>
              <span className="text-right">
                <span className={`font-data-mono font-bold ${row.emphasis ? "text-secondary" : "text-on-surface"}`}>
                  {row.value}
                </span>
                {row.sub && <span className="block text-[10px] text-on-surface-variant">{row.sub}</span>}
              </span>
            </div>
          ))}
        </div>

        {insight && (
          <div className={`${action.tone === "yes" ? "bg-secondary/5 border-secondary/10" : "bg-tertiary/5 border-tertiary/10"} border rounded-lg p-3 flex gap-3`}>
            <Icon
              name={insight.icon}
              filled
              className={`${action.tone === "yes" ? "text-secondary" : "text-tertiary"} text-lg shrink-0`}
            />
            <p className="font-body-md text-[12px] sm:text-[13px] text-on-surface-variant leading-tight">{insight.text}</p>
          </div>
        )}

        <button
          onClick={action.onAction}
          disabled={action.disabled}
          className={`w-full ${toneClass} text-white py-3 sm:py-4 rounded-lg font-headline-sm text-lg sm:text-headline-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50`}
        >
          {action.label}
        </button>
        {footnote && (
          <p className="text-center font-label-caps text-[9px] sm:text-[10px] text-on-surface-variant uppercase tracking-tighter">
            {footnote}
          </p>
        )}
      </div>
    </div>
  );
}
