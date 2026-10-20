// Pin the timezone before any Date work so DST assertions are deterministic
// on every machine (Node ≥16 re-reads TZ at runtime).
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import {
  bucketPoints,
  bucketStart,
  bucketWidthSeconds,
  dayBucketStart,
  handleRequest,
  type BucketInput,
} from "../bucket";

const point = (t: number, yesBps: number, kind?: BucketInput["kind"]): BucketInput =>
  ({ t, yesBps: String(yesBps), ...(kind ? { kind } : {}) });

describe("bucketPoints", () => {
  const end = Date.UTC(2026, 5, 15, 12, 0, 0) / 1000;

  it("returns nothing for an empty series", () => {
    expect(bucketPoints([], "1D", end)).toEqual([]);
  });

  it("keeps the last price per 30-minute bucket for 1D", () => {
    const rows = bucketPoints([
      point(end - 3_600, 5100),
      point(end - 3_500, 5300), // same bucket as the previous point
      point(end - 1_000, 5500),
    ], "1D", end);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.yes)).toEqual([53, 55]);
    expect(bucketWidthSeconds("1D")).toBe(1_800);
  });

  it("carries the pre-window price in at the window edge", () => {
    const old = end - 86_400; // a day before the 1H window
    const rows = bucketPoints([point(old, 4200), point(end - 60, 5800)], "1H", end);
    expect(rows[0]).toMatchObject({ t: end - 3_600, yes: 42 });
    expect(rows[1].yes).toBe(58);
  });

  it("pins a resolution to its bucket and keeps the kind", () => {
    const rows = bucketPoints([
      point(end - 600, 7300, "trade"),
      point(end - 100, 10_000, "resolved"),
    ], "1D", end);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ yes: 100, kind: "resolved" });
  });

  it("sorts out-of-order input", () => {
    const rows = bucketPoints([point(end - 60, 5500), point(end - 3_600, 5100)], "1D", end);
    expect(rows.map(row => row.yes)).toEqual([51, 55]);
  });
});

describe("day buckets across DST (America/New_York)", () => {
  // 2026-03-08: spring forward (02:00 EST → 03:00 EDT, a 23-hour day).
  const beforeJump = Date.UTC(2026, 2, 8, 6, 59) / 1000; // 01:59 EST
  const afterJump = Date.UTC(2026, 2, 8, 7, 1) / 1000; // 03:01 EDT
  // 2026-11-01: fall back (02:00 EDT → 01:00 EST, a 25-hour day).
  const firstOneThirty = Date.UTC(2026, 10, 1, 5, 30) / 1000; // 01:30 EDT
  const secondOneThirty = Date.UTC(2026, 10, 1, 6, 30) / 1000; // 01:30 EST

  it("puts both sides of the spring-forward jump in one bucket", () => {
    expect(dayBucketStart(beforeJump)).toBe(dayBucketStart(afterJump));
  });

  it("puts both occurrences of the repeated fall-back hour in one bucket", () => {
    expect(dayBucketStart(firstOneThirty)).toBe(dayBucketStart(secondOneThirty));
  });

  it("keeps neighbouring calendar days in different buckets despite the 23-hour day", () => {
    const saturday = dayBucketStart(Date.UTC(2026, 2, 7, 12) / 1000); // Mar 7 noon EST
    const sunday = dayBucketStart(beforeJump); // Mar 8 01:59 EST
    const monday = dayBucketStart(Date.UTC(2026, 2, 9, 12) / 1000); // Mar 9 noon EDT
    expect(saturday).toBeLessThan(sunday);
    expect(sunday).toBeLessThan(monday);
    expect(sunday - saturday).toBe(24 * 3_600); // DST starts at 2am, not midnight
    expect(monday - sunday).toBe(23 * 3_600); // the DST day really is 23 hours
  });

  it("buckets ALL-period rows by local midnight", () => {
    const rows = bucketPoints([
      point(firstOneThirty, 5000),
      point(secondOneThirty + 3_600, 5200), // 02:30 EST, still Nov 1
      point(Date.UTC(2026, 10, 2, 6, 0) / 1000, 5400), // Nov 2, 01:00 EST
    ], "ALL", Date.UTC(2026, 10, 2, 6, 0) / 1000);
    expect(rows.map(row => [row.t, row.yes])).toEqual([
      [dayBucketStart(firstOneThirty), 52],
      [dayBucketStart(Date.UTC(2026, 10, 2, 6, 0) / 1000), 54],
    ]);
  });
});

describe("bucketStart", () => {
  it("aligns fixed-width buckets on the period grid", () => {
    const t = 1_750_000_123;
    expect(bucketStart(t, "1H") % 300).toBe(0);
    expect(bucketStart(t, "1D")).toBe(Math.floor(t / 1_800) * 1_800);
    expect(bucketStart(t, "1W") % 21_600).toBe(0);
    expect(bucketStart(t, "ALL")).toBe(dayBucketStart(t));
  });
});

describe("handleRequest", () => {
  it("answers a worker-shaped request with rows", () => {
    const end = 1_750_000_000;
    const response = handleRequest({ id: 7, points: [point(end - 60, 6420)], period: "1D", endT: end });
    expect(response.id).toBe(7);
    expect(response.rows).toEqual([{ t: bucketStart(end - 60, "1D"), yes: 64.2 }]);
  });
});
