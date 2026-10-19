import { StrKey } from "@stellar/stellar-sdk";
import deployments from "./generated/deployments.testnet.json";

/**
 * Network and contract configuration. Contract ids default to the synced
 * deployments file (lib/stellar/generated/, see scripts/sync-bindings.mjs);
 * each can be overridden with a NEXT_PUBLIC_* variable.
 *
 * Next.js only inlines NEXT_PUBLIC_* values referenced literally, so each one
 * is spelled out below.
 */

export type ConfigSource = "env" | "fallback";

/** Where each config value came from, for the debug panel. Read-only outside this module. */
const sources: Record<string, ConfigSource> = {};
export const CONFIG_SOURCES: Readonly<Record<string, ConfigSource>> = sources;

const env = (value: string | undefined, fallback: string, name?: string) => {
  const used = Boolean(value && value.trim());
  if (name) sources[name] = used ? "env" : "fallback";
  return used ? (value as string).trim() : fallback;
};

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export const NETWORK_PASSPHRASE = env(process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE, TESTNET_PASSPHRASE, "NETWORK_PASSPHRASE");
export const NETWORK_LABEL = NETWORK_PASSPHRASE === TESTNET_PASSPHRASE ? "Stellar Testnet" : "Stellar";
const dedupe = (urls: string[]) => [...new Set(urls)];

/**
 * Soroban RPC endpoints. NEXT_PUBLIC_STELLAR_RPC_URL stays the first/primary
 * entry; NEXT_PUBLIC_STELLAR_RPC_URLS (comma-separated) adds failover
 * endpoints. See lib/stellar/rpc-pool.ts for selection and pinning.
 */
export const RPC_URLS: readonly string[] = dedupe([
  env(process.env.NEXT_PUBLIC_STELLAR_RPC_URL, "https://soroban-testnet.stellar.org", "RPC_URL"),
  ...(process.env.NEXT_PUBLIC_STELLAR_RPC_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);
sources.RPC_URLS = process.env.NEXT_PUBLIC_STELLAR_RPC_URLS?.trim() ? "env" : "fallback";
export const RPC_URL = RPC_URLS[0]; // unchanged export for existing callers
export const EXPLORER_URL = env(process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL, "https://stellar.expert/explorer/testnet", "EXPLORER_URL");

export const CONTRACTS = {
  marketCore: env(process.env.NEXT_PUBLIC_MARKET_CORE_CONTRACT_ID, deployments.contracts.market_core, "CONTRACTS.marketCore"),
  treasury: env(process.env.NEXT_PUBLIC_TREASURY_CONTRACT_ID, deployments.contracts.treasury, "CONTRACTS.treasury"),
  resolver: env(process.env.NEXT_PUBLIC_RESOLVER_CONTRACT_ID, deployments.contracts.resolver, "CONTRACTS.resolver"),
  reasoningRegistry: env(process.env.NEXT_PUBLIC_REASONING_REGISTRY_CONTRACT_ID, deployments.contracts.reasoning_registry, "CONTRACTS.reasoningRegistry"),
  usdc: env(process.env.NEXT_PUBLIC_USDC_CONTRACT_ID, deployments.contracts.usdc, "CONTRACTS.usdc"),
} as const;

/**
 * Recipient of premium payments. Must match the backend's PAYMENTS_RECIPIENT
 * or the backend will reject the payment. Defaults to the treasury, like the
 * backend (see docs/api.md for why that is a product decision).
 */
export const PAYMENTS_RECIPIENT = env(process.env.NEXT_PUBLIC_PAYMENTS_RECIPIENT, CONTRACTS.treasury, "PAYMENTS_RECIPIENT");

/**
 * Admin G-addresses. This is a UI gate only: the backend enforces admin
 * rights itself (ADMIN_ADDRESSES). Matched exactly, because Stellar
 * addresses are uppercase and case-sensitive.
 */
export const ADMIN_ADDRESSES: readonly string[] = (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);
sources.ADMIN_ADDRESSES = ADMIN_ADDRESSES.length ? "env" : "fallback";

export const isAdminAddress = (address: string | null | undefined) =>
  Boolean(address) && ADMIN_ADDRESSES.includes(address as string);

export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs";
export const MAX_IPFS_GATEWAYS = 5;
export const DEFAULT_IPFS_MAX_TRACE_BYTES = 1024 * 1024;

/**
 * Parses a comma-separated gateway pool. Only https URLs are kept (plain http
 * only for localhost, for local testing). Entries are de-duplicated, trailing
 * slashes removed, and the pool is capped at MAX_IPFS_GATEWAYS. Returns an
 * empty list when nothing valid is left, so the caller can fall back.
 */
export function parseGateways(raw: string | undefined): string[] {
  const gateways: string[] = [];
  for (const entry of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      continue;
    }
    const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) continue;
    const normalized = url.toString().replace(/\/+$/, "");
    if (!gateways.includes(normalized)) gateways.push(normalized);
    if (gateways.length === MAX_IPFS_GATEWAYS) break;
  }
  return gateways;
}

const ipfsGatewayEnv = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
sources.IPFS_GATEWAY = ipfsGatewayEnv?.trim() ? "env" : "fallback";
const parsedGateways = parseGateways(ipfsGatewayEnv);
if (ipfsGatewayEnv?.trim() && parsedGateways.length === 0) {
  console.warn(`NEXT_PUBLIC_IPFS_GATEWAY_URL has no usable https gateway; using ${DEFAULT_IPFS_GATEWAY}.`);
}
/** Gateways tried for trace content, in priority order. Use https (or http://localhost). */
export const IPFS_GATEWAYS: readonly string[] = parsedGateways.length ? parsedGateways : [DEFAULT_IPFS_GATEWAY];
export const IPFS_GATEWAY = IPFS_GATEWAYS[0]; // unchanged export for existing callers

const ipfsMaxBytesEnv = Number(process.env.NEXT_PUBLIC_IPFS_MAX_TRACE_BYTES);
/** Largest trace body read from a gateway. Larger responses are abandoned while streaming. */
export const IPFS_MAX_TRACE_BYTES =
  Number.isSafeInteger(ipfsMaxBytesEnv) && ipfsMaxBytesEnv > 0 ? ipfsMaxBytesEnv : DEFAULT_IPFS_MAX_TRACE_BYTES;
sources.IPFS_MAX_TRACE_BYTES = process.env.NEXT_PUBLIC_IPFS_MAX_TRACE_BYTES?.trim() ? "env" : "fallback";

/** The contracts repo's x402 trace service (per-trace unlocks). Empty if not deployed. */
export const X402_URL = env(process.env.NEXT_PUBLIC_X402_URL, "", "X402_URL");

/**
 * WalletConnect (mobile wallets such as LOBSTR and Freighter Mobile). Off
 * unless a WalletConnect Cloud project id is set. The project's allowed-origin
 * list is what protects it, not the id itself.
 */
export const WALLETCONNECT_PROJECT_ID = env(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, "");
/** Public URL of this app, shown to the wallet while it pairs. */
export const APP_URL = env(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000");
export const WALLETCONNECT_CHAIN = NETWORK_PASSPHRASE === TESTNET_PASSPHRASE ? "stellar:testnet" : "stellar:pubnet";

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAccount = (address: string) =>
  `${EXPLORER_URL}/${address.startsWith("C") ? "contract" : "account"}/${address}`;
