/** Pure bucketing for the on-chain price chart. Runs in the browser, in the
 * bucket worker, and in Node tests — no DOM, no recharts, no Date.now().
 * All times are unix seconds (ledger close time). */

export const CHART_PERIODS = ["1H", "1D", "1W", "ALL"] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

export interface BucketInput {
  t: number;
  /** bigint price crossed as a string; only the chart row loses precision */
  yesBps: string;
  kind?: "open" | "trade" | "resolved";
}

export interface ChartRow {
  t: number;
  /** percent, 0–100 */
  yes: number;
  kind?: "open" | "trade" | "resolved";
}

const PERIOD_SECONDS: Record<Exclude<ChartPeriod, "ALL">, number> = {
  "1H": 3_600,
  "1D": 86_400,
  "1W": 604_800,
};

const BUCKET_SECONDS: Record<Exclude<ChartPeriod, "ALL">, number> = {
  "1H": 300,
  "1D": 1_800,
  "1W": 21_600,
};

export function bucketWidthSeconds(period: ChartPeriod): number {
  return period === "ALL" ? 86_400 : BUCKET_SECONDS[period];
}

/** Start of the local calendar day containing t. Local midnight survives DST
 * transitions (the 2am jump), so a 23- or 25-hour day is still one bucket. */
export function dayBucketStart(t: number): number {
  const d = new Date(t * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

export function bucketStart(t: number, period: ChartPeriod): number {
  if (period === "ALL") return dayBucketStart(t);
  const w = BUCKET_SECONDS[period];
  return Math.floor(t / w) * w;
}

const toPercent = (yesBps: string) => Number(yesBps) / 100;

/** Downsample a sorted-ish point list into one row per bucket (last write
 * wins, so a resolution in a bucket pins it). The most recent point before
 * the window is carried in at the window edge so the step line enters the
 * chart at the price it actually had, not at the first in-window trade. */
export function bucketPoints(
  points: readonly BucketInput[],
  period: ChartPeriod,
  endT: number,
): ChartRow[] {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const startT = period === "ALL" ? -Infinity : endT - PERIOD_SECONDS[period];
  const inWindow = sorted.filter(point => point.t >= startT && point.t <= endT);

  const rows: ChartRow[] = [];
  if (startT !== -Infinity) {
    let entry: BucketInput | undefined;
    for (const point of sorted) {
      if (point.t >= startT) break;
      entry = point;
    }
    if (entry) rows.push({ t: startT, yes: toPercent(entry.yesBps), ...(entry.kind ? { kind: entry.kind } : {}) });
  }

  const buckets = new Map<number, ChartRow>();
  for (const point of inWindow) {
    const key = bucketStart(point.t, period);
    buckets.set(key, { t: key, yes: toPercent(point.yesBps), ...(point.kind ? { kind: point.kind } : {}) });
  }
  rows.push(...buckets.values());
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

export interface BucketRequest {
  id: number;
  points: BucketInput[];
  period: ChartPeriod;
  endT: number;
}

export interface BucketResponse {
  id: number;
  rows: ChartRow[];
}

export function handleRequest(request: BucketRequest): BucketResponse {
  return { id: request.id, rows: bucketPoints(request.points, request.period, request.endT) };
}
