import { cidDigestCheck, type CidCheck } from "./cid";
import { Sha256 } from "./sha256";

/**
 * Trace fetching and verification without any DOM or app configuration, so
 * the same code runs on the main thread, in the trace worker and in Node tests.
 * Gateways, byte caps and timeouts are passed in by the caller.
 *
 * The on-chain trace_hash is the authority. The CID check is an extra signal:
 * it says whether the gateway served the object the CID names.
 */

export type TraceCheck =
  | { status: "verified"; content: unknown; computedHash: string; gateway?: string; cidCheck?: CidCheck; attempts?: GatewayAttempt[] }
  | { status: "mismatch"; computedHash: string; cidCheck?: CidCheck; attempts?: GatewayAttempt[] }
  | { status: "unavailable"; reason: string; attempts?: GatewayAttempt[] };

export type GatewayOutcome =
  | "verified"
  | "mismatch"
  | "http-error"
  | "timeout"
  | "too-large"
  | "network"
  | "aborted"
  | "skipped";

export interface GatewayAttempt {
  gateway: string;
  outcome: GatewayOutcome;
  status?: number;
  ms: number;
  bytes?: number;
  computedHash?: string;
}

export interface RaceProgress {
  gateway: string;
  received: number;
  total: number | null;
}

export interface RaceOptions {
  cid: string;
  onChainHash: string;
  gateways: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  /** Delay before starting the next gateway while earlier ones are still running (hedging). */
  staggerMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: RaceProgress) => void;
}

/** `bytes` is only set for a verified result, so unverified content never leaves the race. */
export interface RaceResult {
  check: TraceCheck;
  bytes?: Uint8Array;
  contentKind?: "json" | "text";
}

export const DEFAULT_TRACE_TIMEOUT_MS = 8_000;
export const DEFAULT_TRACE_STAGGER_MS = 750;

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function normalizeHash(hash: string): string {
  return hash.toLowerCase().replace(/^0x/, "");
}

/** Gateway URL for a bare CID. Accepts ipfs:// URIs too. */
export function gatewayUrl(cid: string, gateway: string): string {
  const bare = cid.replace(/^ipfs:\/\//, "");
  const base = gateway.endsWith("/") ? gateway.slice(0, -1) : gateway;
  return `${base}/${encodeURIComponent(bare)}`;
}

/** Decodes verified bytes: JSON when they parse, otherwise text. Never throws. */
export function decodeContent(bytes: Uint8Array): { content: unknown; kind: "json" | "text" } {
  const text = new TextDecoder().decode(bytes);
  try {
    return { content: JSON.parse(text), kind: "json" };
  } catch {
    return { content: text, kind: "text" };
  }
}

class TraceTooLargeError extends Error {}

/**
 * Reads a response body while hashing it, and stops as soon as more than
 * maxBytes have arrived. Content-Length is checked first when present, but
 * the streaming count is the real limit.
 */
export async function readCapped(
  res: Response,
  maxBytes: number,
  onChunk?: (received: number, total: number | null) => void,
): Promise<{ bytes: Uint8Array; hex: string }> {
  const declared = Number(res.headers.get("content-length"));
  const total = Number.isSafeInteger(declared) && declared > 0 ? declared : null;
  if (total !== null && total > maxBytes) throw new TraceTooLargeError();

  const hasher = new Sha256();
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new TraceTooLargeError();
    hasher.update(bytes);
    onChunk?.(bytes.byteLength, total);
    return { bytes, hex: toHex(hasher.digest()) };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new TraceTooLargeError();
      chunks.push(value);
      hasher.update(value);
      onChunk?.(received, total);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, hex: toHex(hasher.digest()) };
}

interface AttemptResult {
  attempt: GatewayAttempt;
  bytes?: Uint8Array;
  contentKind?: "json" | "text";
}

async function fetchFromGateway(
  gateway: string,
  cid: string,
  expectedHash: string,
  opts: { fetchImpl: typeof fetch; signal: AbortSignal; maxBytes: number; onProgress?: RaceOptions["onProgress"] },
): Promise<AttemptResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const res = await opts.fetchImpl(gatewayUrl(cid, gateway), { signal: opts.signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { attempt: { gateway, outcome: "http-error", status: res.status, ms: elapsed() } };
    }
    const { bytes, hex } = await readCapped(res, opts.maxBytes, (received, total) =>
      opts.onProgress?.({ gateway, received, total }),
    );
    if (hex !== expectedHash) {
      return { attempt: { gateway, outcome: "mismatch", ms: elapsed(), bytes: bytes.byteLength, computedHash: hex } };
    }
    const decoded = decodeContent(bytes);
    return {
      attempt: { gateway, outcome: "verified", ms: elapsed(), bytes: bytes.byteLength, computedHash: hex },
      bytes,
      contentKind: decoded.kind,
    };
  } catch (error) {
    if (error instanceof TraceTooLargeError) return { attempt: { gateway, outcome: "too-large", ms: elapsed() } };
    return { attempt: { gateway, outcome: "network", ms: elapsed() } };
  }
}

function describeFailure(attempt: GatewayAttempt, maxBytes: number): string {
  switch (attempt.outcome) {
    case "http-error":
      return `IPFS gateway returned HTTP ${attempt.status}`;
    case "timeout":
      return "The IPFS gateway timed out";
    case "too-large":
      return `Trace is larger than the ${maxBytes}-byte limit`;
    default:
      return "Couldn't reach the IPFS gateway";
  }
}

/**
 * Races the gateways. Gateway i starts after i × staggerMs, or as soon as an
 * earlier attempt fails. Each attempt has its own timeout. The first attempt
 * whose bytes match the on-chain hash wins, and the others are aborted. A
 * mismatch doesn't end the race, because another gateway may serve the right
 * bytes. The result is "mismatch" only when some gateway returned bytes and
 * none matched.
 */
export function raceGateways(opts: RaceOptions): Promise<RaceResult> {
  const expectedHash = normalizeHash(opts.onChainHash);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TRACE_TIMEOUT_MS;
  const staggerMs = opts.staggerMs ?? DEFAULT_TRACE_STAGGER_MS;
  const gateways = opts.gateways;

  return new Promise<RaceResult>((resolve) => {
    const attempts: GatewayAttempt[] = [];
    const inFlight = new Map<string, { controller: AbortController; timer: ReturnType<typeof setTimeout>; started: number }>();
    const mismatches: GatewayAttempt[] = [];
    let next = 0;
    let settled = false;
    let staggerTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: RaceResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(staggerTimer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
      for (const [gateway, run] of inFlight) {
        clearTimeout(run.timer);
        run.controller.abort();
        attempts.push({ gateway, outcome: "aborted", ms: Math.round(performance.now() - run.started) });
      }
      inFlight.clear();
      for (const gateway of gateways.slice(next)) attempts.push({ gateway, outcome: "skipped", ms: 0 });
      resolve({ ...result, check: { ...result.check, attempts } });
    };

    const onCallerAbort = () => finish({ check: { status: "unavailable", reason: "Cancelled" } });

    const finalizeFailure = () => {
      const first = mismatches[0];
      if (first) {
        finish({
          check: { status: "mismatch", computedHash: first.computedHash ?? "", cidCheck: cidDigestCheck(opts.cid, first.computedHash ?? "") },
        });
        return;
      }
      const reason =
        attempts.length === 1
          ? describeFailure(attempts[0], opts.maxBytes)
          : `No IPFS gateway returned the trace (${attempts.length} tried)`;
      finish({ check: { status: "unavailable", reason } });
    };

    const onAttemptDone = (gateway: string, result: AttemptResult) => {
      if (settled) return;
      const run = inFlight.get(gateway);
      if (run) clearTimeout(run.timer);
      inFlight.delete(gateway);
      attempts.push(result.attempt);

      if (result.attempt.outcome === "verified" && result.bytes && result.attempt.computedHash) {
        const computedHash = result.attempt.computedHash;
        const decoded = decodeContent(result.bytes);
        finish({
          check: {
            status: "verified",
            content: decoded.content,
            computedHash,
            gateway,
            cidCheck: cidDigestCheck(opts.cid, computedHash),
          },
          bytes: result.bytes,
          contentKind: decoded.kind,
        });
        return;
      }
      if (result.attempt.outcome === "mismatch") mismatches.push(result.attempt);

      launchNext();
      if (inFlight.size === 0 && next >= gateways.length) finalizeFailure();
    };

    const start = (gateway: string) => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      inFlight.set(gateway, { controller, timer, started: performance.now() });
      void fetchFromGateway(gateway, opts.cid, expectedHash, {
        fetchImpl,
        signal: controller.signal,
        maxBytes: opts.maxBytes,
        onProgress: opts.onProgress,
      }).then((result) => {
        // The timeout or a caller cancel can make a read fail with a generic network error; name the real cause.
        if (result.attempt.outcome === "network" && controller.signal.aborted) {
          result.attempt.outcome = timedOut ? "timeout" : "aborted";
        }
        onAttemptDone(gateway, result);
      });
    };

    function launchNext(): void {
      if (settled || next >= gateways.length) return;
      const gateway = gateways[next++];
      start(gateway);
      clearTimeout(staggerTimer);
      if (next < gateways.length) staggerTimer = setTimeout(launchNext, staggerMs);
    }

    if (gateways.length === 0) {
      finish({ check: { status: "unavailable", reason: "No IPFS gateway is configured" } });
      return;
    }
    if (opts.signal?.aborted) {
      onCallerAbort();
      return;
    }
    opts.signal?.addEventListener("abort", onCallerAbort, { once: true });
    launchNext();
  });
}
