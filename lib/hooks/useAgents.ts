"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scValToNative } from "@stellar/stellar-sdk";
import deployments from "@/lib/stellar/generated/deployments.testnet.json";
import { eventWindow, fetchContractEvents, type EventWindow } from "@/lib/stellar/events";
import { reasoningRegistry } from "@/lib/stellar/clients";
import { CONTRACTS, KNOWN_AGENTS } from "@/lib/stellar/config";
import { UserFacingError } from "@/lib/stellar/errors";
import { read, submit } from "@/lib/stellar/typed-call";
import { readRegistryAdmin } from "@/lib/stellar/registry-admin";
import { useWallet } from "@/lib/contexts/WalletContext";

export type AgentSource = "event:registered" | "event:published" | "deployments" | "env";

export interface AgentRow {
  address: string;
  sources: AgentSource[];
  registered: boolean | null;
  tracesInWindow: number;
  lastPublishedAt: number | null;
  lastTraceId: string | null;
}

export interface AgentObservation {
  address: string;
  source: AgentSource;
  trace?: { id: string; publishedAt: number };
}

export interface AgentsView {
  rows: AgentRow[];
  window: EventWindow;
  /** The event read hit maxPages before reaching the RPC's oldest ledger. */
  partial: boolean;
}

export const agentKeys = {
  all: ["stellar", "agents"] as const,
  admin: ["stellar", "registryAdmin"] as const,
};

/** Pure merge of every source of agent knowledge. Dedupes addresses, unions
 * sources, keeps the newest trace per agent, and leaves registration status for
 * the live `is_registered` read (null means not read yet). */
export function mergeAgentSources(
  observations: readonly AgentObservation[],
  statuses: ReadonlyMap<string, boolean | null> = new Map(),
): AgentRow[] {
  const rows = new Map<string, AgentRow>();
  for (const observation of observations) {
    const address = observation.address.trim();
    if (!address) continue;
    let row = rows.get(address);
    if (!row) {
      row = {
        address,
        sources: [],
        registered: statuses.get(address) ?? null,
        tracesInWindow: 0,
        lastPublishedAt: null,
        lastTraceId: null,
      };
      rows.set(address, row);
    }
    if (!row.sources.includes(observation.source)) row.sources.push(observation.source);
    if (observation.trace) {
      row.tracesInWindow += 1;
      if (row.lastPublishedAt === null || observation.trace.publishedAt >= row.lastPublishedAt) {
        row.lastPublishedAt = observation.trace.publishedAt;
        row.lastTraceId = observation.trace.id;
      }
    }
  }
  for (const [address, registered] of statuses) {
    const row = rows.get(address);
    if (row) row.registered = registered;
  }
  return [...rows.values()];
}

export function sortAgentRows(rows: readonly AgentRow[]): AgentRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.registered === true) - Number(a.registered === true) ||
      (b.lastPublishedAt ?? 0) - (a.lastPublishedAt ?? 0) ||
      a.address.localeCompare(b.address),
  );
}

/** Runs async work with at most `limit` jobs in flight. Order is preserved. */
export async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const width = Math.max(1, Math.floor(limit));
  const output = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await fn(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, values.length) }, () => worker()));
  return output;
}

function decodeAddress(value: unknown): string | null {
  return typeof value === "string" && (value.startsWith("G") || value.startsWith("C")) ? value : null;
}

function decodePublishedAt(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

async function readAgents(): Promise<AgentsView> {
  const window = await eventWindow();
  const common = {
    contractId: CONTRACTS.reasoningRegistry,
    startLedger: window.oldestLedger,
    endLedger: window.latestLedger + 1,
    pageLimit: 200,
    maxPages: 10,
  } as const;
  const spec = reasoningRegistry().spec;

  const [registered, published] = await Promise.all([
    fetchContractEvents({
      ...common,
      topics: spec.eventTopicFilter("AgentRegistered"),
    }),
    fetchContractEvents({
      ...common,
      topics: spec.eventTopicFilter("TracePublished"),
    }),
  ]);

  const observations: AgentObservation[] = [];

  for (const event of registered.events) {
    const address = decodeAddress(scValToNative(event.topics[1]));
    if (address) observations.push({ address, source: "event:registered" });
  }

  for (const event of published.events) {
    const address = decodeAddress(scValToNative(event.topics[3]));
    const traceId = scValToNative(event.topics[1]);
    if (!address || (typeof traceId !== "bigint" && typeof traceId !== "number")) continue;
    const data = scValToNative(event.value) as Record<string, unknown> | null;
    const publishedAt = decodePublishedAt(data?.published_at);
    if (publishedAt === null) continue;
    observations.push({
      address,
      source: "event:published",
      trace: { id: String(traceId), publishedAt },
    });
  }

  if (typeof deployments.agent === "string" && deployments.agent) {
    observations.push({ address: deployments.agent, source: "deployments" });
  }
  for (const address of KNOWN_AGENTS) {
    observations.push({ address, source: "env" });
  }

  const merged = mergeAgentSources(observations);
  const client = reasoningRegistry();
  const statuses = await mapLimit(merged, 4, async (row) => {
    try {
      const registered = read(await client.is_registered({ agent: row.address }), "reasoningRegistry");
      return [row.address, Boolean(registered)] as const;
    } catch (error) {
      // An archived Agent entry, a stale RPC or a network error must not turn
      // into "unregistered": the registry is the authority and we do not know.
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[agents] is_registered(${row.address}) failed`, error);
      }
      return [row.address, null] as const;
    }
  });

  return {
    rows: sortAgentRows(mergeAgentSources(observations, new Map(statuses))),
    window,
    partial: registered.partial || published.partial,
  };
}

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: readAgents,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useRegistryAdmin() {
  return useQuery({
    queryKey: agentKeys.admin,
    queryFn: () => readRegistryAdmin(),
    staleTime: 60_000,
    retry: false,
  });
}

export type AgentAction = "register" | "unregister";

/** Simulates the write without touching the wallet. Throws the contract's
 * friendly error (AgentAlreadyRegistered, AgentNotRegistered, Unauthorized, …). */
export async function simulateAgentAction(action: AgentAction, agent: string, publicKey: string): Promise<void> {
  const signer = {
    publicKey,
    signTransaction: async () => {
      throw new Error("Simulation only; this signer never signs.");
    },
  };
  const client = reasoningRegistry(signer);
  const tx = action === "register"
    ? await client.register_agent({ agent })
    : await client.unregister_agent({ agent });
  read(tx, "reasoningRegistry");
}

function useAgentMutation(action: AgentAction) {
  const queryClient = useQueryClient();
  const { signer, isWrongNetwork } = useWallet();

  return useMutation({
    mutationFn: async ({ agent }: { agent: string }): Promise<{ txHash: string | null }> => {
      if (!signer) throw new UserFacingError({ kind: "disconnected", message: "Connect your wallet first." });
      if (isWrongNetwork) {
        throw new UserFacingError({ kind: "wrong-network", message: "Switch your wallet to Stellar Testnet and try again." });
      }
      const client = reasoningRegistry(signer);
      const tx = action === "register"
        ? await client.register_agent({ agent })
        : await client.unregister_agent({ agent });
      const { txHash } = await submit(tx, "reasoningRegistry");
      return { txHash };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["stellar", "traceCount"] });
    },
  });
}

export function useRegisterAgent() {
  return useAgentMutation("register");
}

export function useUnregisterAgent() {
  return useAgentMutation("unregister");
}
