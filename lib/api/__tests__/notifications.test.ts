import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSubscription, getVapidKey, InvalidResponseError, listSubscriptions, putSubscription } from "../notifications";

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function stubFetch(data: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({ ok, status, statusText: "", json: async () => ({ ok, data, error: ok ? null : { code: "X", message: "nope" } }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.stubGlobal("window", { localStorage: { getItem: (k: string) => (k === "oracledesk_token" ? "tok" : null) } }));
afterEach(() => vi.unstubAllGlobals());

describe("lib/api/notifications", () => {
  it("GETs the VAPID key and validates it", async () => {
    const f = stubFetch({ publicKey: KEY });
    await expect(getVapidKey()).resolves.toBe(KEY);
    expect(String(f.mock.calls[0][0])).toMatch(/\/notifications\/vapid-key$/);
    stubFetch({ publicKey: 42 });
    await expect(getVapidKey()).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it("PUTs the subscription with auth and the documented body", async () => {
    const f = stubFetch({ id: "sub-1" });
    const body = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" }, categories: ["MARKET_RESOLVED" as const], userAgent: "UA" };
    await expect(putSubscription(body)).resolves.toEqual({ id: "sub-1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/notifications\/subscriptions$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("rejects a malformed id response", async () => {
    stubFetch({});
    await expect(
      putSubscription({ endpoint: "e", keys: { p256dh: "p", auth: "a" }, categories: [], userAgent: "" }),
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it("DELETEs by encoded id", async () => {
    const f = stubFetch(null);
    await deleteSubscription("a/b");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/notifications\/subscriptions\/a%2Fb$/);
    expect(init.method).toBe("DELETE");
  });

  it("validates the subscription list", async () => {
    stubFetch([{ id: "1", endpoint: "e", categories: ["TRADE_CONFIRMED"] }]);
    await expect(listSubscriptions()).resolves.toHaveLength(1);
    stubFetch([{ id: "1", endpoint: "e", categories: ["SPAM"] }]);
    await expect(listSubscriptions()).rejects.toBeInstanceOf(InvalidResponseError);
  });
});
