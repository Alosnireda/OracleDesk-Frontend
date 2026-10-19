import { formatUsdc, parseUsdc, USDC_UNIT } from "@/lib/stellar/units";

export const MAX_ALLOWANCE_RAW = 1_000_000n * USDC_UNIT;

export type RawToApiResult =
  | { ok: true; value: number }
  | { ok: false; reason: "too-large" | "not-representable" };

export function apiNumberToRaw(value: number): { raw: bigint; exact: boolean } {
  if (!Number.isFinite(value) || value < 0) throw new Error("Allowance must be a finite, non-negative number");
  const raw = parseUsdc(value.toFixed(7));
  return { raw, exact: Number(formatUsdc(raw)) === value };
}

export function rawToApiNumber(raw: bigint): RawToApiResult {
  if (raw < 0n || raw > MAX_ALLOWANCE_RAW) return { ok: false, reason: "too-large" };
  const value = Number(formatUsdc(raw));
  try {
    return apiNumberToRaw(value).raw === raw ? { ok: true, value } : { ok: false, reason: "not-representable" };
  } catch {
    return { ok: false, reason: "not-representable" };
  }
}

export interface AllowanceValidation {
  daily?: string;
  perTrace?: string;
}

export function validateAllowance(daily: bigint | null, perTrace: bigint | null): AllowanceValidation {
  const errors: AllowanceValidation = {};
  if (daily === null) errors.daily = "Enter a daily limit.";
  else if (daily <= 0n) errors.daily = "The daily limit must be greater than zero.";
  else if (!rawToApiNumber(daily).ok) errors.daily = "The daily limit is too large or not representable.";
  if (perTrace === null) errors.perTrace = "Enter a per-trace limit.";
  else if (perTrace <= 0n) errors.perTrace = "The per-trace limit must be greater than zero.";
  else if (!rawToApiNumber(perTrace).ok) errors.perTrace = "The per-trace limit is too large or not representable.";
  if (daily !== null && perTrace !== null && perTrace > daily) errors.perTrace = "The per-trace limit can't be higher than the daily limit.";
  return errors;
}

export function computeTodayUsage(events: Array<{ type: string; status?: string; createdAt: string; amountRaw?: string; amount?: number }>, now = Date.now()): bigint {
  const start = new Date(now);
  const day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return events.reduce((sum, event) => {
    if (!["PER_TRACE", "DAILY_PASS"].includes(event.type) || (event.status && !["PENDING", "CONFIRMED"].includes(event.status))) return sum;
    if (Date.parse(event.createdAt) < day) return sum;
    try {
      return sum + (event.amountRaw ? BigInt(event.amountRaw) : apiNumberToRaw(event.amount ?? 0).raw);
    } catch {
      return sum;
    }
  }, 0n);
}
