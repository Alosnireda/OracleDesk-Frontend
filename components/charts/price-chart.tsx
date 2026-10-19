"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Area,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PricePoint } from "@/lib/stellar/price-history";
import {
  CHART_PERIODS,
  handleRequest,
  type BucketInput,
  type BucketRequest,
  type BucketResponse,
  type ChartPeriod,
  type ChartRow,
} from "@/lib/charts/bucket";

export const PRICE_CHART_HEIGHT = 340;

const pad = (n: number) => String(n).padStart(2, "0");

const formatTime = (t: number, period: ChartPeriod) => {
  const d = new Date(t * 1000);
  if (period === "ALL") return `${d.toLocaleString(undefined, { month: "short", day: "numeric" })}`;
  if (period === "1W") return `${d.toLocaleString(undefined, { weekday: "short" })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const tickStyle = { fontSize: 10, fill: "var(--chart-tick)", fontFamily: "var(--font-geist-sans)" };

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ payload?: ChartRow }>;
  period?: ChartPeriod;
}

const PriceTooltip = ({ active, payload, label, period }: TooltipProps) => {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="bg-on-background text-surface px-3 py-2 rounded shadow-xl font-data-mono text-[11px] border border-primary/20">
      <p className="text-outline mb-1">{typeof label === "number" ? formatTime(label, period ?? "1D") : label}</p>
      <p className="font-bold" style={{ color: "var(--chart-yes)" }}>YES {row.yes.toFixed(1)}%</p>
      <p className="font-bold" style={{ color: "var(--chart-no)" }}>NO {(100 - row.yes).toFixed(1)}%</p>
      {row.kind === "resolved" && <p className="text-outline mt-1">RESOLVED</p>}
    </div>
  );
};

/** Step-line price chart fed by real Soroban trade events. The chart body
 * mounts only on the client so recharts never measures a zero-size container
 * during prerender; the worker keeps bucketing off the main thread. */
export default function PriceChart({ points, defaultPeriod = "1D" }: { points: readonly PricePoint[]; defaultPeriod?: ChartPeriod }) {
  const [period, setPeriod] = useState<ChartPeriod>(defaultPeriod);
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [mounted, setMounted] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Defer past the effect's synchronous window: the chart mounts after the
    // first paint, which is also what keeps recharts out of the prerender.
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    try {
      const worker = new Worker(new URL("../../lib/charts/bucket.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<BucketResponse>) => {
        if (event.data.id === requestIdRef.current) setRows(event.data.rows);
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const inputs = useMemo<BucketInput[]>(
    () => points.map(point => ({ t: point.time, yesBps: point.yesBps.toString(), ...(point.kind ? { kind: point.kind } : {}) })),
    [points],
  );

  useEffect(() => {
    const endT = inputs[inputs.length - 1]?.t ?? 0;
    const request: BucketRequest = { id: ++requestIdRef.current, points: inputs, period, endT };
    if (workerRef.current) workerRef.current.postMessage(request);
    else setRows(handleRequest(request).rows);
  }, [inputs, period]);

  const resolved = rows.length ? [...rows].reverse().find(row => row.kind === "resolved") : undefined;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded relative overflow-hidden">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div className="font-label-caps text-label-caps text-on-surface-variant">
          ON-CHAIN PRICE · {rows.length ? `${rows.length} BUCKETS` : "NO TRADES YET"}
        </div>
        <div className="flex gap-1">
          {CHART_PERIODS.map(option => (
            <button
              key={option}
              onClick={() => setPeriod(option)}
              className={`px-3 py-1 rounded font-label-caps text-label-caps transition-all ${
                period === option
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: "var(--chart-yes)" }} />
          <span className="font-label-caps text-[10px] text-on-surface-variant">YES</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: "var(--chart-no)" }} />
          <span className="font-label-caps text-[10px] text-on-surface-variant">NO</span>
        </div>
        {resolved && (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="w-4 h-0.5 border-t-2 border-dashed inline-block" style={{ borderColor: "var(--chart-axis)" }} />
            <span className="font-label-caps text-[10px]" style={{ color: "var(--chart-axis)" }}>RESOLVED</span>
          </div>
        )}
      </div>

      <div className="h-[340px] w-full">
        {mounted && rows.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={PRICE_CHART_HEIGHT}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="priceChartYes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-yes)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--chart-yes)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" strokeOpacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => formatTime(t, period)}
                tick={tickStyle}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={tickStyle}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<PriceTooltip period={period} />} />
              {resolved && (
                <ReferenceLine
                  y={resolved.yes}
                  stroke="var(--chart-axis)"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  label={{ value: "RESOLVED", position: "insideTopRight", fontSize: 10, fill: "var(--chart-axis)" }}
                />
              )}
              <Area
                type="stepAfter"
                dataKey="yes"
                stroke="none"
                fill="url(#priceChartYes)"
                isAnimationActive={false}
              />
              <Line
                type="stepAfter"
                dataKey="yes"
                stroke="var(--chart-yes)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "var(--chart-yes)" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex items-center justify-center rounded border border-dashed border-outline-variant">
            <p className="font-label-caps text-label-caps text-on-surface-variant text-center px-6">
              {mounted
                ? "NO ON-CHAIN TRADES YET — THE PRICE LINE STARTS AT THE FIRST TRADE"
                : "LOADING PRICE HISTORY…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
