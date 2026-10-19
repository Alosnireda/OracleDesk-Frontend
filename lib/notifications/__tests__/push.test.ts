import { describe, expect, it } from "vitest";
import { detectPushSupport, urlBase64ToUint8Array, type PushEnv } from "../push";

const env = (over: Partial<PushEnv> = {}): PushEnv => ({
  isSecureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130",
  maxTouchPoints: 0,
  standalone: false,
  ...over,
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a VAPID public key (65-byte uncompressed P-256 point)", () => {
    const key = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("handles url-safe characters and missing padding", () => {
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
  });
});

describe("detectPushSupport", () => {
  it("reports supported on a secure desktop browser", () => {
    expect(detectPushSupport(env())).toBe("supported");
  });

  it("reports needs-install-ios for non-standalone iOS", () => {
    const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1";
    expect(detectPushSupport(env({ userAgent: ios, hasPushManager: false }))).toBe("needs-install-ios");
    expect(detectPushSupport(env({ userAgent: ios, standalone: true }))).toBe("supported");
  });

  it("treats iPadOS desktop-mode user agents as iOS", () => {
    expect(detectPushSupport(env({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 5 }))).toBe("needs-install-ios");
  });

  it("reports insecure-context on http", () => {
    expect(detectPushSupport(env({ isSecureContext: false }))).toBe("insecure-context");
  });

  it("reports unsupported without PushManager", () => {
    expect(detectPushSupport(env({ hasPushManager: false }))).toBe("unsupported");
    expect(detectPushSupport(null)).toBe("unsupported");
  });
});
