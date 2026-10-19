import { Address, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";
import { AssembledTransaction, Client as ContractClient, Spec } from "@stellar/stellar-sdk/contract";
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
    // One Server (one HTTP client, one connection pool) for every client and
    // every AssembledTransaction. ClientOptions.server is part of SDK 16.
    server: rpcServer(rpcUrl),
    ...(signer ? { publicKey: signer.publicKey, signTransaction: signer.signTransaction } : {}),
    ...(extra?.timeoutInSeconds !== undefined ? { timeoutInSeconds: extra.timeoutInSeconds } : {}),
  };
}

type ClientName = "marketCore" | "treasury" | "resolver" | "reasoningRegistry";
type ClientOptionsFor = ClientOptions & { timeoutInSeconds?: number };

const CLIENT_CTORS = {
  marketCore: MarketCoreClient,
  treasury: TreasuryClient,
  resolver: ResolverClient,
  reasoningRegistry: ReasoningRegistryClient,
} as const;

type ClientFor<K extends ClientName> = InstanceType<(typeof CLIENT_CTORS)[K]>;
type GeneratedClient = ClientFor<ClientName>;

/**
 * Parsed specs per contract. Generated constructors decode every base64 spec
 * entry in `new ContractSpec([...])`; doing that once per contract is enough,
 * and signer-bound clients then share the exact same parsed spec.
 */
const specs = new Map<ClientName, Spec>();
const readOnlyClients = new Map<string, GeneratedClient>();
let signerClients = new WeakMap<Signer, Map<string, GeneratedClient>>();
let specBuilds = 0;

const contractIdFor = (name: ClientName) => CONTRACTS[name];

function buildGeneratedClient<K extends ClientName>(name: K, opts: ClientOptionsFor): ClientFor<K> {
  const Ctor = CLIENT_CTORS[name] as unknown as new (options: ClientOptions) => ClientFor<K>;
  return new Ctor(opts);
}

function specFor(name: ClientName): Spec {
  const cached = specs.get(name);
  if (cached) return cached;
  // The generated module owns the pinned spec entries; constructing one
  // client is the public way to obtain them. Its server is the shared one.
  specBuilds += 1;
  const spec = buildGeneratedClient(name, options(contractIdFor(name))).spec;
  specs.set(name, spec);
  return spec;
}

/** A Client built from an already-parsed spec. The generated methods are
 * installed by the base class from the spec at runtime, so the shape matches
 * the generated Client exactly (see clients-cache.test-d.ts). */
function clientFromSpec<K extends ClientName>(name: K, opts: ClientOptionsFor): ClientFor<K> {
  return new ContractClient(specFor(name), opts) as unknown as ClientFor<K>;
}

const cacheKey = (name: ClientName, contractId: string, rpcUrl: string, opts?: { timeoutInSeconds?: number }) =>
  `${name}|${contractId}|${rpcUrl}|${NETWORK_PASSPHRASE}|${opts?.timeoutInSeconds ?? ""}`;

function shared<K extends ClientName>(name: K, opts?: { timeoutInSeconds?: number }, rpcUrl?: string): ClientFor<K> {
  const contractId = contractIdFor(name);
  const url = rpcUrl ?? currentRpcUrl();
  const key = cacheKey(name, contractId, url, opts);
  const cached = readOnlyClients.get(key);
  if (cached) return cached as ClientFor<K>;

  const client = clientFromSpec(name, options(contractId, undefined, opts, url));
  // A read-only client must never be reused for a write. `options` without a
  // signer cannot set publicKey, but keep the invariant explicit.
  if (client.options.publicKey) throw new Error("Refusing to cache a signer-bound client as read-only");
  readOnlyClients.set(key, client);
  return client;
}

function bound<K extends ClientName>(name: K, signer: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string): ClientFor<K> {
  const contractId = contractIdFor(name);
  const url = rpcUrl ?? currentRpcUrl();
  // The signer object is the identity boundary: WalletProvider creates a new
  // one when the address changes, so account A's client can never be returned
  // for account B. publicKey is also part of the key as defence in depth.
  const key = `${cacheKey(name, contractId, url, opts)}|${signer.publicKey}`;
  let byKey = signerClients.get(signer);
  if (!byKey) {
    byKey = new Map();
    signerClients.set(signer, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached as ClientFor<K>;

  const client = clientFromSpec(name, options(contractId, signer, opts, url));
  byKey.set(key, client);
  return client;
}

export function marketCore(signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) {
  return signer ? bound("marketCore", signer, opts, rpcUrl) : shared("marketCore", opts, rpcUrl);
}
export function treasury(signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) {
  return signer ? bound("treasury", signer, opts, rpcUrl) : shared("treasury", opts, rpcUrl);
}
export function resolver(signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) {
  return signer ? bound("resolver", signer, opts, rpcUrl) : shared("resolver", opts, rpcUrl);
}
export function reasoningRegistry(signer?: Signer, opts?: { timeoutInSeconds?: number }, rpcUrl?: string) {
  return signer
    ? bound("reasoningRegistry", signer, opts, rpcUrl)
    : shared("reasoningRegistry", opts, rpcUrl);
}

/** Test-only: clears memoised specs/clients so a test can observe a cold start. */
export function __resetClientCaches(): void {
  specs.clear();
  readOnlyClients.clear();
  signerClients = new WeakMap();
  specBuilds = 0;
}

/** Test-only: number of generated-client constructions whose only purpose was
 * parsing a contract spec. It must not grow when a signer-bound client is built. */
export function __specBuildCount(): number {
  return specBuilds;
}

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
