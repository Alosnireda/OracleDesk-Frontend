import { describe, expect, it } from "vitest";
import {
  MAX_TRACE_STRING_LENGTH,
  sanitizeString,
  sanitizeUrl,
  validateTraceContent,
} from "../trace-schema";

describe("sanitizeString", () => {
  it("strips bidi override characters", () => {
    // U+202E is RIGHT-TO-LEFT OVERRIDE, U+202D is LEFT-TO-RIGHT OVERRIDE, U+2066 is LRI
    const payload = "Normal text \u202E gnirts desrever \u202C \u2066 safe \u2069";
    const cleaned = sanitizeString(payload);
    expect(cleaned).not.toContain("\u202E");
    expect(cleaned).not.toContain("\u202D");
    expect(cleaned).not.toContain("\u2066");
    expect(cleaned).not.toContain("\u2069");
    expect(cleaned).toBe("Normal text  gnirts desrever   safe ");
  });

  it("strips dangerous control characters while preserving newlines and tabs", () => {
    const textWithControls = "Line 1\nLine 2\tTabbed\x00\x07\x1F\x7F";
    const cleaned = sanitizeString(textWithControls);
    expect(cleaned).toBe("Line 1\nLine 2\tTabbed");
  });

  it("enforces max string length limits", () => {
    const long = "A".repeat(MAX_TRACE_STRING_LENGTH + 500);
    const cleaned = sanitizeString(long, MAX_TRACE_STRING_LENGTH);
    expect(cleaned.length).toBe(MAX_TRACE_STRING_LENGTH + 1); // text + ellipsis
    expect(cleaned.endsWith("…")).toBe(true);
  });

  it("handles null and undefined gracefully", () => {
    expect(sanitizeString(null)).toBe("");
    expect(sanitizeString(undefined)).toBe("");
  });
});

describe("sanitizeUrl", () => {
  it("allows safe http, https, and ipfs URLs", () => {
    expect(sanitizeUrl("https://example.com/article")).toBe("https://example.com/article");
    expect(sanitizeUrl("http://localhost:3000/feed")).toBe("http://localhost:3000/feed");
    expect(sanitizeUrl("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBe(
      "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    );
  });

  it("rejects javascript: and other dangerous executable protocols", () => {
    expect(sanitizeUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(sanitizeUrl("JavaScript:window.location='https://attacker.com'")).toBeNull();
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizeUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects malformed or empty URLs", () => {
    expect(sanitizeUrl("")).toBeNull();
    expect(sanitizeUrl("not-a-url")).toBeNull();
    expect(sanitizeUrl(null)).toBeNull();
  });
});

describe("validateTraceContent", () => {
  it("validates a standard agent reasoning trace against schema", () => {
    const rawTrace = {
      version: 1,
      agent: "market-maker-1",
      action: "BUY_YES",
      decisionType: "BUY_YES",
      probabilityEstimate: 0.65,
      edge: 0.12,
      confidence: 0.88,
      confidenceInterval: { lower: 0.6, upper: 0.7 },
      reasoning: "Inflation data came in lower than consensus expectations.",
      sources: [
        { name: "BLS CPI Report", weight: 0.7, signal: "Core CPI +0.2% MoM", url: "https://bls.gov/cpi" },
        { name: "Reuters News", weight: 0.3, signal: "Fed officials lean dovish", url: "https://reuters.com/news" },
      ],
      conditions: ["Max slippage 50bps", "Verify liquidity > 10k USDC"],
      betFraction: 0.05,
      betSizeUsdc: 2500,
    };

    const res = validateTraceContent(rawTrace);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.version).toBe(1);
    expect(res.data.agent).toBe("market-maker-1");
    expect(res.data.action).toBe("BUY_YES");
    expect(res.data.probabilityEstimate).toBe(0.65);
    expect(res.data.edge).toBe(0.12);
    expect(res.data.reasoning).toBe("Inflation data came in lower than consensus expectations.");
    expect(res.data.sources.length).toBe(2);
    expect(res.data.sources[0].url).toBe("https://bls.gov/cpi");
    expect(res.data.conditions).toEqual(["Max slippage 50bps", "Verify liquidity > 10k USDC"]);
  });

  it("sanitizes bidi overrides and dangerous URLs inside sources and reasoning", () => {
    const maliciousTrace = {
      agent: "agent\u202Einverted",
      reasoning: "Normal \u202E spoofed text \u202C",
      sources: [
        {
          name: "Safe source",
          weight: 0.5,
          signal: "signal text",
          url: "javascript:alert('pwned')",
        },
      ],
    };

    const res = validateTraceContent(maliciousTrace);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.agent).toBe("agentinverted");
    expect(res.data.reasoning).toBe("Normal  spoofed text ");
    expect(res.data.sources[0].url).toBeNull();
    expect(res.warnings.some((w) => w.includes("Unsafe or invalid URL"))).toBe(true);
  });

  it("isolates unknown and extra fields as inert rawUnknownFields", () => {
    const traceWithExtras = {
      action: "HOLD",
      reasoning: "No trade edge detected.",
      unrecognizedSecretKey: "secret_value",
      nestedObject: {
        debugInfo: "internal_payload",
      },
    };

    const res = validateTraceContent(traceWithExtras);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.rawUnknownFields.unrecognizedSecretKey).toBe("secret_value");
    expect(res.data.rawUnknownFields.nestedObject).toEqual({ debugInfo: "internal_payload" });
  });

  it("handles stringified JSON and plain text gracefully", () => {
    const stringified = JSON.stringify({ reasoning: "Pure stringified trace", edge: 0.05 });
    const res1 = validateTraceContent(stringified);
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.data.reasoning).toBe("Pure stringified trace");
      expect(res1.data.edge).toBe(0.05);
    }

    const plainText = "Arbitrary unformatted reasoning log from legacy agent.";
    const res2 = validateTraceContent(plainText);
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.data.reasoning).toBe(plainText);
      expect(res2.warnings.length).toBeGreaterThan(0);
    }
  });

  it("rejects null or empty trace content", () => {
    expect(validateTraceContent(null).ok).toBe(false);
    expect(validateTraceContent(undefined).ok).toBe(false);
  });
});
