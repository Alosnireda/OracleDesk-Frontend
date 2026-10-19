import type { Query } from "@tanstack/react-query";
import { CONFIG_SOURCES, CONTRACTS, EXPLORER_URL, IPFS_GATEWAY, NETWORK_PASSPHRASE, PAYMENTS_RECIPIENT, RPC_URLS, X402_URL } from "@/lib/stellar/config";
import provenance from "@/lib/stellar/generated/provenance.json";
import type { SimRecord } from "./events";
import { redact } from "./redact";

export interface DiagnosticsInput {
  wallet: {
    isConnected: boolean;
    address: string | null;
    walletNetworkPassphrase: string | null;
    isWrongNetwork: boolean;
    isAuthenticated: boolean;
    hasStoredToken: boolean;
    selectedWalletId?: string | null;
  };
  queries: readonly Pick<Query, "queryKey" | "state">[];
  simulations: readonly SimRecord[];
  rpc?: unknown;
  userAgent?: string;
  nextVersion?: string;
}

export interface DiagnosticsBundle {
  app: { buildSha: string | null; buildId: string | null; nextVersion: string | null };
  config: { values: Record<string, unknown>; sources: Record<string, string> };
  bindings: typeof provenance;
  wallet: DiagnosticsInput["wallet"];
  queries: { key: unknown; status: string; dataUpdatedAt: number; error: string | null }[];
  simulations: readonly SimRecord[];
  rpc: unknown;
  userAgent: string | null;
}

export const bigintReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Fixed key order so two bundles from the same state are byte-identical. Redaction runs last. */
export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsBundle {
  const bundle: DiagnosticsBundle = {
    app: {
      buildSha: process.env.NEXT_PUBLIC_BUILD_SHA || null,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || null,
      nextVersion: input.nextVersion ?? null,
    },
    config: {
      values: { NETWORK_PASSPHRASE, RPC_URLS, EXPLORER_URL, CONTRACTS, PAYMENTS_RECIPIENT, IPFS_GATEWAY, X402_URL },
      sources: { ...CONFIG_SOURCES },
    },
    bindings: provenance,
    wallet: input.wallet,
    queries: input.queries.map((q) => ({
      key: q.queryKey,
      status: q.state.status,
      dataUpdatedAt: q.state.dataUpdatedAt,
      error: q.state.error instanceof Error ? q.state.error.message : q.state.error ? String(q.state.error) : null,
    })),
    simulations: input.simulations,
    rpc: input.rpc ?? null,
    userAgent: input.userAgent ?? null,
  };
  return redact(JSON.parse(JSON.stringify(bundle, bigintReplacer))) as DiagnosticsBundle;
}

export function serializeDiagnostics(bundle: DiagnosticsBundle): string {
  return JSON.stringify(bundle, bigintReplacer, 2);
}
