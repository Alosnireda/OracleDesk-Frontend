import { raceGateways, type RaceResult, type TraceCheck } from "./trace-core";

/**
 * Runs the gateway race, the streaming hash and the JSON decode off the main
 * thread. Bytes are posted back only after the hash matches, and as a
 * transferable buffer, so unverified content never reaches the page.
 *
 * Never import config.ts here: the worker gets gateways and limits in each
 * request, so it doesn't need process.env.
 */

export type TraceWorkerRequest =
  | {
      type: "verify";
      id: string;
      cid: string;
      expectedHash: string;
      gateways: string[];
      maxBytes: number;
      timeoutMs?: number;
      staggerMs?: number;
    }
  | { type: "cancel"; id: string };

type VerifiedWithoutContent = Omit<Extract<TraceCheck, { status: "verified" }>, "content">;
export type WorkerCheck = VerifiedWithoutContent | Exclude<TraceCheck, { status: "verified" }>;

export type TraceWorkerResponse =
  | { type: "progress"; id: string; received: number; total: number | null }
  | {
      type: "result";
      id: string;
      check: WorkerCheck;
      /** Only for verified results: the exact bytes, transferred rather than copied. */
      bytes?: ArrayBuffer;
      contentKind?: "json" | "text";
      /** The parsed content when it's JSON; text is decoded from `bytes` on the main thread. */
      json?: unknown;
    };

export interface WorkerDeps {
  fetch: typeof fetch;
  post: (message: TraceWorkerResponse, transfer?: Transferable[]) => void;
  /** Running jobs by id, so a cancel only affects its own job. */
  jobs: Map<string, AbortController>;
}

const PROGRESS_INTERVAL_MS = 100;

export function handleMessage(message: TraceWorkerRequest, deps: WorkerDeps): void {
  if (message.type === "cancel") {
    deps.jobs.get(message.id)?.abort();
    return;
  }

  const { id } = message;
  const controller = new AbortController();
  deps.jobs.set(id, controller);
  let lastProgressAt = 0;

  const finish = (result: RaceResult) => {
    deps.jobs.delete(id);
    const { check, bytes, contentKind } = result;
    if (check.status === "verified" && bytes) {
      const { content, ...rest } = check;
      const buffer = bytes.buffer as ArrayBuffer;
      deps.post(
        { type: "result", id, check: rest, bytes: buffer, contentKind, json: contentKind === "json" ? content : undefined },
        [buffer],
      );
      return;
    }
    deps.post({ type: "result", id, check: check as WorkerCheck });
  };

  raceGateways({
    cid: message.cid,
    onChainHash: message.expectedHash,
    gateways: message.gateways,
    maxBytes: message.maxBytes,
    timeoutMs: message.timeoutMs,
    staggerMs: message.staggerMs,
    signal: controller.signal,
    fetchImpl: deps.fetch,
    onProgress: ({ received, total }) => {
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS && received !== total) return;
      lastProgressAt = now;
      deps.post({ type: "progress", id, received, total });
    },
  }).then(finish, () => finish({ check: { status: "unavailable", reason: "Trace verification failed" } }));
}

// Only register the message handler inside a real worker, never in Node tests or on the main thread.
if (typeof window === "undefined" && typeof self !== "undefined" && typeof self.postMessage === "function") {
  const scope = self as unknown as {
    postMessage: (message: TraceWorkerResponse, transfer: Transferable[]) => void;
    onmessage: ((event: MessageEvent<TraceWorkerRequest>) => void) | null;
  };
  const jobs = new Map<string, AbortController>();
  scope.onmessage = (event) =>
    handleMessage(event.data, {
      fetch: (input, init) => fetch(input, init),
      post: (message, transfer = []) => scope.postMessage(message, transfer),
      jobs,
    });
}
