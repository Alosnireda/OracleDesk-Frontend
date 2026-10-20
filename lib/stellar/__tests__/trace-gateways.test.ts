import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { raceGateways, readCapped } from "../trace-core";
import { fetchAndVerifyTraceWith } from "../trace";

const GW1 = "https://gw1.test/ipfs";
const GW2 = "https://gw2.test/ipfs";
const CID = "bafy-not-a-real-cid";

const body = '{"reasoning":"rates hold","edge":0.12}';
const bytes = new TextEncoder().encode(body);
const hash = createHash("sha256").update(bytes).digest("hex");

const abortError = () => new DOMException("aborted", "AbortError");

/** Routes a request by gateway prefix. Each route gets the attempt's signal. */
function gateways(routes: Record<string, (signal: AbortSignal) => Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const prefix = Object.keys(routes).find((p) => url.startsWith(p));
    if (!prefix) throw new TypeError(`no route for ${url}`);
    return routes[prefix](init?.signal ?? new AbortController().signal);
  }) as typeof fetch;
}

const serve = (text: string) => async () => new Response(text, { status: 200 });
const neverRespond = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(abortError()), { once: true }));

describe("raceGateways", () => {
  it("returns the first gateway that verifies and aborts a slow loser", async () => {
    let slowAborted = false;
    const fetchImpl = gateways({
      [GW1]: (signal) => neverRespond(signal).catch((e) => { slowAborted = true; throw e; }),
      [GW2]: serve(body),
    });
    const { check, bytes: verified } = await raceGateways({
      cid: CID,
      onChainHash: hash,
      gateways: [GW1, GW2],
      maxBytes: 4096,
      staggerMs: 5,
      timeoutMs: 5_000,
      fetchImpl,
    });
    expect(check.status).toBe("verified");
    expect(check.status === "verified" && check.gateway).toBe(GW2);
    expect(check.status === "verified" && check.content).toEqual({ reasoning: "rates hold", edge: 0.12 });
    expect(verified?.byteLength).toBe(bytes.byteLength);
    expect(slowAborted).toBe(true);
    expect(check.attempts?.map((a) => a.outcome)).toEqual(expect.arrayContaining(["verified", "aborted"]));
  });

  it("keeps racing past a gateway that serves tampered bytes", async () => {
    const fetchImpl = gateways({ [GW1]: serve(body.replace("0.12", "0.99")), [GW2]: serve(body) });
    const { check } = await raceGateways({ cid: CID, onChainHash: hash, gateways: [GW1, GW2], maxBytes: 4096, staggerMs: 0, fetchImpl });
    expect(check.status).toBe("verified");
    expect(check.attempts?.some((a) => a.outcome === "mismatch" && a.gateway === GW1)).toBe(true);
  });

  it("reports a mismatch with every distinct computed hash when no gateway matches", async () => {
    const fetchImpl = gateways({ [GW1]: serve("{}"), [GW2]: serve('{"x":1}') });
    const { check } = await raceGateways({ cid: CID, onChainHash: hash, gateways: [GW1, GW2], maxBytes: 4096, staggerMs: 0, fetchImpl });
    expect(check.status).toBe("mismatch");
    const hashes = new Set(check.attempts?.map((a) => a.computedHash));
    expect(hashes.size).toBe(2);
    expect(check.status === "mismatch" && "content" in check).toBe(false);
  });

  it("cuts an endless stream off at maxBytes instead of buffering it", async () => {
    let pulls = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(65_536));
          },
        }),
        { status: 200 },
      );
    const { check } = await raceGateways({
      cid: CID,
      onChainHash: hash,
      gateways: [GW1],
      maxBytes: 131_072,
      fetchImpl: gateways({ [GW1]: async () => endless() }),
    });
    expect(check.status).toBe("unavailable");
    expect(check.status === "unavailable" && check.reason).toMatch(/larger than/);
    // Three 64 KiB chunks cross the 128 KiB cap; the stream's read-ahead may pull one more.
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("times out a silent gateway and reports the attempt as timed out", async () => {
    const { check } = await raceGateways({
      cid: CID,
      onChainHash: hash,
      gateways: [GW1],
      maxBytes: 4096,
      timeoutMs: 20,
      fetchImpl: gateways({ [GW1]: neverRespond }),
    });
    expect(check.status).toBe("unavailable");
    expect(check.attempts?.[0].outcome).toBe("timeout");
  });

  it("stops every attempt when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = raceGateways({
      cid: CID,
      onChainHash: hash,
      gateways: [GW1, GW2],
      maxBytes: 4096,
      staggerMs: 0,
      signal: controller.signal,
      fetchImpl: gateways({ [GW1]: neverRespond, [GW2]: neverRespond }),
    });
    controller.abort();
    const { check } = await pending;
    expect(check).toEqual({ status: "unavailable", reason: "Cancelled", attempts: expect.any(Array) });
  });

  it("fails over immediately when the first gateway returns an HTTP error", async () => {
    const fetchImpl = gateways({
      [GW1]: async () => new Response("", { status: 504 }),
      [GW2]: serve(body),
    });
    const started = Date.now();
    const { check } = await raceGateways({ cid: CID, onChainHash: hash, gateways: [GW1, GW2], maxBytes: 4096, staggerMs: 60_000, fetchImpl });
    expect(check.status).toBe("verified");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reports a single failing gateway with its specific reason", async () => {
    const check = await fetchAndVerifyTraceWith(CID, hash, {
      gateways: [GW1],
      fetchImpl: gateways({ [GW1]: async () => new Response("", { status: 504 }) }),
    });
    expect(check).toMatchObject({ status: "unavailable", reason: "IPFS gateway returned HTTP 504" });
  });
});

describe("readCapped", () => {
  it("returns the exact bytes and their sha256 for a streamed body", async () => {
    const chunks = [bytes.subarray(0, 7), bytes.subarray(7)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const result = await readCapped(new Response(stream), 4096);
    expect(result.hex).toBe(hash);
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
  });
});
