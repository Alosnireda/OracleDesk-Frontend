import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNotification, EVENT_ID_RE, GENERIC, MARKET_ID_RE, notificationUrl, parsePushPayload, TRACE_ID_RE, TX_HASH_RE } from "../payload";

const HASH = "a".repeat(64);
const ok = { v: 1, kind: "MARKET_RESOLVED", onChainMarketId: "12", eventId: "evt-1" };

describe("parsePushPayload", () => {
  it("accepts a valid payload (object or JSON string)", () => {
    expect(parsePushPayload(ok)).toMatchObject({ kind: "MARKET_RESOLVED", onChainMarketId: "12" });
    expect(parsePushPayload(JSON.stringify({ ...ok, txHash: HASH }))).toMatchObject({ txHash: HASH });
  });

  it("rejects a payload with the wrong version", () => {
    expect(parsePushPayload({ ...ok, v: 2 })).toBeNull();
  });

  it("rejects a non-numeric market id", () => {
    expect(parsePushPayload({ ...ok, onChainMarketId: "12; DROP" })).toBeNull();
    expect(parsePushPayload({ ...ok, onChainMarketId: "https://evil.example" })).toBeNull();
  });

  it("rejects a tx hash with the wrong length", () => {
    expect(parsePushPayload({ ...ok, txHash: "a".repeat(63) })).toBeNull();
    expect(parsePushPayload({ ...ok, txHash: "A".repeat(64) })).toBeNull();
  });

  it("rejects bad trace ids, unknown kinds and garbage", () => {
    expect(parsePushPayload({ ...ok, traceId: "not-a-uuid" })).toBeNull();
    expect(parsePushPayload({ ...ok, kind: "OPEN_URL" })).toBeNull();
    expect(parsePushPayload("{not json")).toBeNull();
    expect(parsePushPayload(null)).toBeNull();
  });
});

describe("notificationUrl", () => {
  it("builds the quick-view url only from a validated id", () => {
    expect(notificationUrl(parsePushPayload(ok))).toBe("/markets/quick-view?onChainId=12&from=push");
    expect(notificationUrl(parsePushPayload({ ...ok, onChainMarketId: "//evil.example" }))).toBe("/notifications");
    expect(notificationUrl(null)).toBe("/notifications");
  });
});

describe("buildNotification", () => {
  const p = parsePushPayload(ok)!;

  it("uses the fetched state, not the payload, for the resolution text", () => {
    const forged = parsePushPayload({ ...ok, outcome: "Yes", body: "You won 120 USDC" })!;
    const n = buildNotification(forged, { question: "Will BTC close above 100k?", status: "Resolved", outcome: "No" });
    expect(n.body).toBe("Will BTC close above 100k? resolved NO. Open to check your position.");
    expect(n.body).not.toMatch(/USDC|won/);
    expect(n.tag).toBe("evt-1");
  });

  it("falls back to generic text when the state is still Open", () => {
    const n = buildNotification(p, { question: "Q?", status: "Open" });
    expect(n.body).toBe("A market you hold has an update.");
    expect(n.body).not.toMatch(/YES|NO/);
  });

  it("shows the generic notification for an invalid payload", () => {
    expect(buildNotification(null, null)).toMatchObject({ ...GENERIC, url: "/notifications" });
  });

  it("never includes amounts in trade confirmations", () => {
    const n = buildNotification(parsePushPayload({ ...ok, kind: "TRADE_CONFIRMED", txHash: HASH })!, { question: "Q?", status: "Open" });
    expect(n.body).toBe("Your trade on Q? was confirmed.");
  });
});

describe("public/sw.js mirror", () => {
  it("uses the same validation rules as payload.ts", () => {
    const sw = readFileSync(join(__dirname, "../../../public/sw.js"), "utf8");
    for (const re of [MARKET_ID_RE, TX_HASH_RE, TRACE_ID_RE, EVENT_ID_RE]) expect(sw).toContain(re.source);
  });
});
