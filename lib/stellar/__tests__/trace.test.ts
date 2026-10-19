import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchAndVerifyTrace, ipfsUrl, verifyTraceHash } from "../trace";

// Same fixtures as x402/trace-verification.test.ts in the contracts repo.
describe("verifyTraceHash", () => {
  const content = new TextEncoder().encode('{"action":"buy","confidence":0.72}');
  const hash = createHash("sha256").update(content).digest("hex");

  it("verifies the exact bytes received from IPFS", async () => {
    expect(await verifyTraceHash(content, hash)).toBe(true);
    expect(await verifyTraceHash(content, `0x${hash}`)).toBe(true);
    expect(await verifyTraceHash(content, hash.toUpperCase())).toBe(true);
    expect(await verifyTraceHash(new TextEncoder().encode("{}"), hash)).toBe(false);
    expect(await verifyTraceHash(content, "not-a-hash")).toBe(false);
  });

  it("builds an encoded IPFS gateway URL", () => {
    expect(ipfsUrl("bafy trace", "https://ipfs.example/")).toBe("https://ipfs.example/bafy%20trace");
    expect(ipfsUrl("ipfs://bafyabc", "https://ipfs.example")).toBe("https://ipfs.example/bafyabc");
  });
});

describe("fetchAndVerifyTrace", () => {
  const body = '{"reasoning":"rates hold","edge":0.12}';
  const hash = createHash("sha256").update(body).digest("hex");
  const respond = (text: string, status = 200) => (async () => new Response(text, { status })) as typeof fetch;

  it("returns content only when it matches", async () => {
    const ok = await fetchAndVerifyTrace("bafy1", hash, respond(body));
    expect(ok.status).toBe("verified");
    expect(ok.status === "verified" && ok.content).toEqual({ reasoning: "rates hold", edge: 0.12 });
  });

  it("reports tampered content as a mismatch, without the content", async () => {
    // toMatchObject, not toEqual: results also carry per-gateway attempts and the CID check.
    const tampered = await fetchAndVerifyTrace("bafy1", hash, respond(body.replace("0.12", "0.99")));
    expect(tampered).toMatchObject({ status: "mismatch", computedHash: expect.any(String) });
    expect("content" in tampered).toBe(false);
  });

  it("reports gateway failures as unavailable", async () => {
    expect((await fetchAndVerifyTrace("bafy1", hash, respond("", 504))).status).toBe("unavailable");
    const throwing = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    expect((await fetchAndVerifyTrace("bafy1", hash, throwing)).status).toBe("unavailable");
  });
});
