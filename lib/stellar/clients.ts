import { Address, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import type { ClientOptions, SignTransaction } from "@stellar/stellar-sdk/contract";
import { Client as MarketCoreClient, type Category, type Outcome } from "./generated/market-core";
import { Client as TreasuryClient } from "./generated/treasury";
import { Client as ResolverClient } from "./generated/resolver";
import { Client as ReasoningRegistryClient } from "./generated/reasoning-registry";
import { CONTRACTS, NETWORK_PASSPHRASE, RPC_URL, RPC_URLS } from "./config";
import { getRpcPool, type RpcPool } from "./rpc-pool";

/** What a wallet provides to sign. Omit it for read-only simulation. */
export interface Signer {
  publicKey: string;
  signTransaction: SignTransaction;
}

/** The endpoint pool in the browser; null on the server (prerender, node tests), which uses RPC_URL. */
export function rpcPool(): RpcPool | null {
  return getRpcPool(RPC_URLS, NETWORK_PASSPHRASE);
}

/** The RPC URL reads should use right now (the pinned one while a write flow holds a lease). */
export function currentRpcUrl(): string {
  return rpcPool()?.current() ?? RPC_URL;
}

const servers = new Map<string, rpc.Server>();
/** Memoised Stellar RPC server for `url` (defaults to the pool's current endpoint). */
export function rpcServer(url: string = currentRpcUrl()): rpc.Server {
  let server = servers.get(url);
  if (!server) {
    server = new rpc.Server(url, { allowHttp: url.startsWith("http://") });
    servers.set(url, server);
  }
  return server;
}

/**
 * Runs a write flow on one endpoint. While the lease is held the pool's
 * current() returns the pinned URL, so every factory, simulation, submit and
 * status poll inside `fn` goes to the same RPC (no txBadSeq or "not found"
 * from a node that hasn't ingested the tx yet). Never resubmits elsewhere.
 */
export async function withPinnedRpc<T>(fn: (rpcUrl: string) => Promise<T>): Promise<T> {
  const pool = rpcPool();
  if (!pool) return fn(RPC_URL);
  const lease = pool.pin();
  try {
    return await fn(lease.url);
  } finally {
    lease.release();
  }
}

export function options(
  contractId: string,
  signer?: Signer,
  extra?: { timeoutInSeconds?: number },
  rpcUrl: string = currentRpcUrl(),
): ClientOptions & { timeoutInSeconds?: number } {
  return {
    contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl,
    allowHttp: rpcUrl.startsWith("http://"),
    ...(signer ? { publicKey: signer.publicKey, signTransaction: signer.signTransaction } : {}),
    ...(extra?.timeoutInSeconds !== undefined ? { timeoutInSeconds: extra.timeoutInSeconds } : {}),
  };
}

export const marketCore = (signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) =>
  new MarketCoreClient(options(CONTRACTS.marketCore, signer, opts, rpcUrl));
export const treasury = (signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) =>
  new TreasuryClient(options(CONTRACTS.treasury, signer, opts, rpcUrl));
export const resolver = (signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) =>
  new ResolverClient(options(CONTRACTS.resolver, signer, opts, rpcUrl));
export const reasoningRegistry = (signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) =>
  new ReasoningRegistryClient(options(CONTRACTS.reasoningRegistry, signer, opts, rpcUrl));

/**
 * The USDC Stellar Asset Contract. A SAC has no Wasm and so no generated
 * bindings; calls are built directly with AssembledTransaction.
 */
export const token = {
  name(contractId: string = CONTRACTS.usdc): Promise<AssembledTransaction<string>> {
    return AssembledTransaction.build<string>({
      ...options(contractId),
      method: "name",
      args: [],
      parseResultXdr: (v) => String(scValToNative(v)),
    });
  },
  balance(owner: string, contractId: string = CONTRACTS.usdc, rpcUrl?: string): Promise<AssembledTransaction<bigint>> {
    return AssembledTransaction.build<bigint>({
      ...options(contractId, undefined, undefined, rpcUrl),
      method: "balance",
      args: [new Address(owner).toScVal()],
      parseResultXdr: (v) => BigInt(scValToNative(v)),
    });
  },
  transfer(
    params: { from: string; to: string; amount: bigint },
    signer: Signer,
    contractId: string = CONTRACTS.usdc,
    txOptions: { timeoutInSeconds?: number } = {},
    rpcUrl?: string,
  ): Promise<AssembledTransaction<null>> {
    return AssembledTransaction.build<null>({
      ...options(contractId, signer, undefined, rpcUrl),
      ...txOptions,
      method: "transfer",
      args: [
        new Address(params.from).toScVal(),
        new Address(params.to).toScVal(),
        nativeToScVal(params.amount, { type: "i128" }),
      ],
      parseResultXdr: () => null,
    });
  },
};

export const Outcomes = {
  Yes: { tag: "Yes", values: undefined } as Outcome,
  No: { tag: "No", values: undefined } as Outcome,
} as const;

export type OutcomeTag = Outcome["tag"];
export type CategoryTag = Category["tag"];

/** Every contract Category, for pickers. */
export const CATEGORY_TAGS = ["Crypto", "Macro", "Geopolitics", "Sports", "Culture", "Other"] as const satisfies readonly CategoryTag[];

// Compile-time exhaustiveness: the build fails if the contract's Category
// enum gains a member that CATEGORY_TAGS doesn't list.
type MissingCategory = Exclude<CategoryTag, (typeof CATEGORY_TAGS)[number]>;
export const CATEGORY_TAGS_ARE_EXHAUSTIVE: [MissingCategory] extends [never] ? true : MissingCategory = true;

export const categoryValue = (tag: CategoryTag): Category => ({ tag, values: undefined }) as Category;
