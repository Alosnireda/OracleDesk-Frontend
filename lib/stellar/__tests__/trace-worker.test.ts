import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleMessage, type TraceWorkerResponse, type WorkerDeps } from "../trace.worker";

const GATEWAY = "https://gw.test/ipfs";
const body = '{"action":"buy","confidence":0.72}';
const bytes = new TextEncoder().encode(body);
const hash = createHash("sha256").update(bytes).digest("hex");

function harness(fetchImpl: typeof fetch) {
  const posted: { message: TraceWorkerResponse; transfer: Transferable[] }[] = [];
  const jobs = new Map<string, AbortController>();
  const deps: WorkerDeps = {
    fetch: fetchImpl,
    post: (message, transfer = []) => posted.push({ message, transfer }),
    jobs,
  };
  return { deps, posted, jobs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("trace worker", () => {
  it("posts a verified result with the bytes transferred and the content decoded", async () => {
    const { deps, posted } = harness((async () => new Response(body, { status: 200 })) as typeof fetch);
    handleMessage({ type: "verify", id: "1", cid: "bafy-x", expectedHash: hash, gateways: [GATEWAY], maxBytes: 4096 }, deps);
    await settle();

    const result = posted.find((p) => p.message.type === "result");
    expect(result).toBeDefined();
    const message = result!.message as Extract<TraceWorkerResponse, { type: "result" }>;
    expect(message.check.status).toBe("verified");
    expect(message.contentKind).toBe("json");
    expect(message.json).toEqual({ action: "buy", confidence: 0.72 });
    expect(result!.transfer).toHaveLength(1);
    expect(result!.transfer[0]).toBe(message.bytes);
    expect(new Uint8Array(message.bytes!)).toEqual(bytes);
    expect(deps.jobs.size).toBe(0);
  });

  it("never posts bytes for a mismatch", async () => {
    const { deps, posted } = harness((async () => new Response("{}", { status: 200 })) as typeof fetch);
    handleMessage({ type: "verify", id: "2", cid: "bafy-x", expectedHash: hash, gateways: [GATEWAY], maxBytes: 4096 }, deps);
    await settle();

    const message = posted.find((p) => p.message.type === "result")!.message as Extract<TraceWorkerResponse, { type: "result" }>;
    expect(message.check.status).toBe("mismatch");
    expect(message.bytes).toBeUndefined();
    expect(posted.find((p) => p.message.type === "result")!.transfer).toHaveLength(0);
  });

  it("cancel aborts only the matching job and reports it as cancelled", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }),
      )) as typeof fetch;
    const { deps, posted } = harness(fetchImpl);
    handleMessage({ type: "verify", id: "a", cid: "bafy-x", expectedHash: hash, gateways: [GATEWAY], maxBytes: 4096 }, deps);
    handleMessage({ type: "verify", id: "b", cid: "bafy-x", expectedHash: hash, gateways: [GATEWAY], maxBytes: 4096 }, deps);
    handleMessage({ type: "cancel", id: "a" }, deps);
    await settle();

    const results = posted.filter((p) => p.message.type === "result").map((p) => p.message as Extract<TraceWorkerResponse, { type: "result" }>);
    expect(results.map((r) => r.id)).toEqual(["a"]);
    expect(results[0].check).toMatchObject({ status: "unavailable", reason: "Cancelled" });
    expect(deps.jobs.has("b")).toBe(true);
    deps.jobs.get("b")?.abort();
  });

  it("stops streaming once maxBytes is exceeded", async () => {
    let pulls = 0;
    const endless = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(1024));
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    const { deps, posted } = harness(endless);
    handleMessage({ type: "verify", id: "c", cid: "bafy-x", expectedHash: hash, gateways: [GATEWAY], maxBytes: 4096 }, deps);
    await settle();

    const message = posted.find((p) => p.message.type === "result")!.message as Extract<TraceWorkerResponse, { type: "result" }>;
    expect(message.check).toMatchObject({ status: "unavailable" });
    expect(pulls).toBeLessThanOrEqual(5);
  });
});
