import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import {
  Address,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { startStubFacilitator, type StubFacilitator } from "./stub-facilitator";

/**
 * Runs the contracts repo's real x402 trace service (pinned submodule) on
 * loopback, wired to a stub facilitator, a fake IPFS gateway and a fake
 * Soroban RPC. Nothing leaves 127.0.0.1: a socket-level guard fails every
 * connection to another host.
 *
 * server.ts is never imported (it reads dotenv and listens), and neither is
 * registry-trace-repository.ts (it needs the bindings `file:` dependency).
 * The service's own dependencies resolve from
 * contracts/oracledesk-stellar/x402/node_modules
 * (`npm ci --ignore-scripts --prefix contracts/oracledesk-stellar/x402`).
 */

export const API_CHANGED = "contracts/x402 API changed: update e2e/x402/harness.ts and the frontend client";

/** What the service charges in this harness, and what that is in atomic USDC (7 decimals). */
export const PRICE = "0.01";
export const PRICE_ATOMIC = "100000";
/** @x402/stellar's default testnet USDC SAC: a bare price string is charged in it. */
export const FIXTURE_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const FAKE_LEDGER = 1_000_000;
/**
 * The "on-chain" hash recorded for the fixture: sha256 of
 * fixtures/traces/market-maker-trace.json, written by agents/core/trace.ts
 * buildTrace. Pinned, so editing the fixture fails the suite.
 */
export const FIXTURE_TRACE_HASH = "a3c9fc079c6c3017c2dc8f0680692c1d3b62d2316e87aab41e0ce3d7de6b1465";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/traces/${name}`, import.meta.url));
const CID_VERIFIED = "fixture-market-maker-trace";
const CID_TAMPERED = "fixture-market-maker-trace-tampered";

export const TRACE_IDS = { verified: "1", tampered: "2", gatewayDown: "3", unknown: "999" } as const;

// ─── Network guard ──────────────────────────────────────────────────────────

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export interface NetworkGuard {
  /** Hosts a connection was attempted to and refused. */
  blocked: string[];
  restore(): void;
}

/**
 * Patches net.Socket#connect, which every TCP client in Node uses (http,
 * https, tls and the undici behind global fetch), so a non-loopback
 * connection fails before DNS or connect.
 */
export function installNetworkGuard(): NetworkGuard {
  const blocked: string[] = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    // net.connect passes its normalized [options, callback] array as the first argument.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    let host: string | undefined;
    if (typeof first === "object" && first !== null) {
      const options = first as { host?: string; path?: string };
      host = options.path ? undefined : (options.host ?? "localhost");
    } else if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
      host = typeof args[1] === "string" ? args[1] : "localhost";
    }
    if (host !== undefined && !LOOPBACK.has(host)) {
      blocked.push(host);
      process.nextTick(() => this.destroy(new Error(`Network guard: refused connection to non-loopback host ${host}`)));
      return this;
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof original;
  return { blocked, restore: () => void (net.Socket.prototype.connect = original) };
}

// ─── Fake Soroban RPC ───────────────────────────────────────────────────────

/** An unsigned address auth entry for the payer of a `transfer(from, to, amount)` call. */
function unsignedTransferAuth(call: xdr.InvokeContractArgs): xdr.SorobanAuthorizationEntry {
  const from = call.args()[0];
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromScVal(from).toScAddress(),
        nonce: xdr.Int64.fromString(BigInt(`0x${randomBytes(7).toString("hex")}`).toString()),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call),
      subInvocations: [],
    }),
  });
}

/** getLatestLedger as SDK 16 parses it: it decodes headerXdr and metadataXdr, so both must be valid XDR. */
function latestLedgerResult(sequence: number) {
  const zeroHash = Buffer.alloc(32);
  const header = new xdr.LedgerHeader({
    ledgerVersion: 23,
    previousLedgerHash: zeroHash,
    scpValue: new xdr.StellarValue({
      txSetHash: zeroHash,
      closeTime: xdr.Uint64.fromString("1760000000"),
      upgrades: [],
      ext: xdr.StellarValueExt.stellarValueBasic(),
    }),
    txSetResultHash: zeroHash,
    bucketListHash: zeroHash,
    ledgerSeq: sequence,
    totalCoins: xdr.Int64.fromString("0"),
    feePool: xdr.Int64.fromString("0"),
    inflationSeq: 0,
    idPool: xdr.Uint64.fromString("0"),
    baseFee: 100,
    baseReserve: 5_000_000,
    maxTxSetSize: 100,
    skipList: [zeroHash, zeroHash, zeroHash, zeroHash],
    ext: new xdr.LedgerHeaderExt(0),
  });
  const meta = new xdr.LedgerCloseMeta(
    0,
    new xdr.LedgerCloseMetaV0({
      ledgerHeader: new xdr.LedgerHeaderHistoryEntry({ hash: zeroHash, header, ext: new xdr.LedgerHeaderHistoryEntryExt(0) }),
      txSet: new xdr.TransactionSet({ previousLedgerHash: zeroHash, txes: [] }),
      txProcessing: [],
      upgradesProcessing: [],
      scpInfo: [],
    }),
  );
  return {
    id: "fake-ledger",
    sequence,
    protocolVersion: "23",
    closeTime: "1760000000",
    headerXdr: header.toXDR("base64"),
    metadataXdr: meta.toXDR("base64"),
  };
}

/**
 * Answers the two JSON-RPC methods the Stellar exact client scheme uses while
 * building a payment: getLatestLedger, and simulateTransaction (first with no
 * auth, returning the payer's unsigned auth entry; then with the signed
 * entry, returning no further auth needed).
 */
async function fakeRpc(request: Request): Promise<Response> {
  const { id, method, params } = (await request.json()) as { id: number; method: string; params?: { transaction?: string } };
  const send = (payload: Record<string, unknown>) => Response.json({ jsonrpc: "2.0", id, ...payload });
  try {
    if (method === "getLatestLedger") return send({ result: latestLedgerResult(FAKE_LEDGER) });
    if (method === "simulateTransaction" && params?.transaction) {
      const tx = TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET);
      const op = tx.operations[0] as Operation.InvokeHostFunction;
      const alreadySigned = (op.auth ?? []).length > 0;
      return send({
        result: {
          latestLedger: FAKE_LEDGER,
          minResourceFee: "100",
          transactionData: new SorobanDataBuilder().build().toXDR("base64"),
          results: [{ auth: alreadySigned ? [] : [unsignedTransferAuth(op.func.invokeContract()).toXDR("base64")], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
          events: [],
        },
      });
    }
    return send({ error: { code: -32601, message: `fake RPC: ${method} not implemented` } });
  } catch (error) {
    return send({ error: { code: -32603, message: `fake RPC: ${error instanceof Error ? error.message : String(error)}` } });
  }
}

/**
 * The fake RPC lives at an https origin, answered in-process: @x402/stellar
 * 2.26 builds the transfer with AssembledTransaction.build without
 * `allowHttp`, so the SDK refuses any http:// RPC URL. The SDK calls the
 * global fetch per request, so routing that one origin needs no socket.
 */
export const FAKE_RPC_URL = "https://soroban-rpc.fixture.test";

function routeFakeRpc(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === FAKE_RPC_URL ? fakeRpc(request) : original(input, init);
  }) as typeof fetch;
  return () => void (globalThis.fetch = original);
}

/** Closes a server without waiting for idle keep-alive sockets. */
export function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

// ─── Service bootstrap ──────────────────────────────────────────────────────

type ServiceModule = typeof import("../../contracts/oracledesk-stellar/x402/trace-api.ts");

/** Loads the pinned service module, failing with one actionable message if its API moved. */
export async function loadTraceService(): Promise<ServiceModule> {
  let service: Partial<ServiceModule>;
  try {
    service = await import("../../contracts/oracledesk-stellar/x402/trace-api.ts");
  } catch (cause) {
    throw new Error(
      `${API_CHANGED} (could not import trace-api.ts: ${cause instanceof Error ? cause.message : String(cause)}; ` +
        "did you run npm ci --ignore-scripts --prefix contracts/oracledesk-stellar/x402?)",
    );
  }
  if (typeof service.createTraceApi !== "function" || typeof service.MapTraceRepository !== "function") throw new Error(API_CHANGED);
  return service as ServiceModule;
}

export interface Fixture {
  bytes: Uint8Array;
  text: string;
  traceHash: string;
}

export interface X402Harness {
  baseUrl: string;
  rpcUrl: string;
  payTo: string;
  facilitator: StubFacilitator;
  fixture: Fixture;
  close(): Promise<void>;
}

export async function startX402Harness(): Promise<X402Harness> {
  const { createTraceApi, MapTraceRepository } = await loadTraceService();

  const verifiedBytes = new Uint8Array(readFileSync(fixturePath("market-maker-trace.json")));
  const tamperedBytes = new Uint8Array(readFileSync(fixturePath("market-maker-trace.tampered.json")));
  const traceHash = FIXTURE_TRACE_HASH;
  const gatewayFiles = new Map([
    [CID_VERIFIED, verifiedBytes],
    [CID_TAMPERED, tamperedBytes],
  ]);

  // The service fetches `${gateway}/${cid}`; serve fixture bytes, 404 otherwise.
  const gateway = (async (input: RequestInfo | URL) => {
    const cid = decodeURIComponent(new URL(String(input)).pathname.split("/").pop() ?? "");
    const bytes = gatewayFiles.get(cid);
    return bytes ? new Response(bytes as BodyInit) : new Response("not found", { status: 404 });
  }) as typeof fetch;

  const payTo = Keypair.random().publicKey();
  const facilitator = await startStubFacilitator({ network: "stellar:testnet", asset: FIXTURE_USDC, payTo, amount: PRICE_ATOMIC }, () => FAKE_LEDGER);
  const unrouteRpc = routeFakeRpc();

  const app = createTraceApi({
    repository: new MapTraceRepository(
      new Map([
        [TRACE_IDS.verified, { traceId: TRACE_IDS.verified, ipfsCid: CID_VERIFIED, traceHash }],
        // Same on-chain hash, different bytes at the gateway.
        [TRACE_IDS.tampered, { traceId: TRACE_IDS.tampered, ipfsCid: CID_TAMPERED, traceHash }],
        [TRACE_IDS.gatewayDown, { traceId: TRACE_IDS.gatewayDown, ipfsCid: "fixture-missing", traceHash }],
      ]),
    ),
    ipfsGateway: "https://ipfs.fixture.invalid/ipfs",
    price: PRICE,
    networks: [{ network: "stellar:testnet", payTo, facilitatorUrl: facilitator.url }],
    fetchImpl: gateway,
  });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    rpcUrl: FAKE_RPC_URL,
    payTo,
    facilitator,
    fixture: { bytes: verifiedBytes, text: new TextDecoder().decode(verifiedBytes), traceHash },
    close: async () => {
      unrouteRpc();
      await Promise.all([closeServer(server), facilitator.close()]);
    },
  };
}
