import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sanitizePath, shouldSample, sendVitals, type WebVitalMetric } from "../vitals";

describe("Web Vitals Telemetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("sanitizePath", () => {
    it("strips query parameters and hashes", () => {
      const sanitized = sanitizePath("/markets/quick-view?onChainId=1&auth=secret#section");
      expect(sanitized).toBe("/markets/quick-view");
    });

    it("sanitizes Stellar public keys to prevent PII leakage", () => {
      const stellarAddr = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const sanitized = sanitizePath(`/portfolio/${stellarAddr}`);
      expect(sanitized).toBe("/portfolio/:address");
    });

    it("sanitizes hex addresses and transaction hashes", () => {
      const hexAddr = "0x71C8494f24301548e65840dca44fFd82c94F923B";
      expect(sanitizePath(`/agent/${hexAddr}`)).toBe("/agent/:address");

      const txHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      expect(sanitizePath(`/tx/${txHash}`)).toBe("/tx/:hash");
    });
  });

  describe("shouldSample", () => {
    it("respects sampling thresholds", () => {
      expect(shouldSample(0.1, () => 0.05)).toBe(true);
      expect(shouldSample(0.1, () => 0.15)).toBe(false);
      expect(shouldSample(1)).toBe(true);
      expect(shouldSample(0)).toBe(false);
    });
  });

  describe("sendVitals", () => {
    const metric: WebVitalMetric = {
      id: "v-1",
      name: "LCP",
      value: 1200.5,
      rating: "good",
      delta: 1200.5,
    };

    it("logs to console.debug in development", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const sent = sendVitals(metric, { isDev: true });
      expect(sent).toBe(true);
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0][0]).toContain("[Web-Vitals] LCP: 1201ms (good)");
    });

    it("sends via navigator.sendBeacon in production when sampled", () => {
      const sendBeaconMock = vi.fn().mockReturnValue(true);
      Object.defineProperty(globalThis, "navigator", {
        value: { sendBeacon: sendBeaconMock },
        configurable: true,
        writable: true,
      });

      const sent = sendVitals(metric, {
        isDev: false,
        sampleRate: 0.1,
        prng: () => 0.02, // sampled (< 0.1)
        pathname: "/markets?sort=asc",
        endpoint: "/telemetry/vitals",
      });

      expect(sent).toBe(true);
      expect(sendBeaconMock).toHaveBeenCalledTimes(1);
      expect(sendBeaconMock.mock.calls[0][0]).toBe("/telemetry/vitals");
      const blob = sendBeaconMock.mock.calls[0][1] as Blob;
      expect(blob).toBeInstanceOf(Blob);
    });

    it("skips dispatch when sampling rejects", () => {
      const sendBeaconMock = vi.fn();
      Object.defineProperty(globalThis, "navigator", {
        value: { sendBeacon: sendBeaconMock },
        configurable: true,
        writable: true,
      });

      const sent = sendVitals(metric, {
        isDev: false,
        sampleRate: 0.1,
        prng: () => 0.5, // not sampled (>= 0.1)
      });

      expect(sent).toBe(false);
      expect(sendBeaconMock).not.toHaveBeenCalled();
    });
  });
});
