"use client";

import { tryParseUsdc } from "@/lib/stellar/units";

export function UsdcInput({ value, onValueChange, label, error }: { value: string; onValueChange: (raw: bigint | null, text: string) => void; label: string; error?: string }) {
  const raw = tryParseUsdc(value);
  const invalid = value.length > 0 && raw === null;
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold text-on-surface-variant">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        aria-label={label}
        aria-invalid={Boolean(error || invalid)}
        onChange={(event) => onValueChange(tryParseUsdc(event.target.value), event.target.value)}
        className="w-full rounded border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono outline-none focus:border-primary"
      />
      {(error || invalid) && <span className="text-xs text-error">{error ?? "Enter a USDC amount with up to 7 decimal places."}</span>}
    </label>
  );
}
