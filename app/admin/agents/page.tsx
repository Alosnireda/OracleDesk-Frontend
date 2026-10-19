"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Address, StrKey } from "@stellar/stellar-sdk";
import { RequireWallet } from "@/components/require-wallet";
import { useWallet } from "@/lib/contexts/WalletContext";
import { useAgents, useRegisterAgent, useRegistryAdmin, useUnregisterAgent, simulateAgentAction, type AgentAction, type AgentRow, type AgentSource } from "@/lib/hooks/useAgents";
import { CONTRACTS, explorerAccount, explorerTx, isAdminAddress } from "@/lib/stellar/config";
import { describeError } from "@/lib/stellar/errors";

const SOURCE_LABELS: Record<AgentSource, string> = {
  "event:registered": "AgentRegistered event",
  "event:published": "TracePublished event",
  deployments: "deployments.testnet.json",
  env: "NEXT_PUBLIC_KNOWN_AGENTS",
};

const SourceBadge = ({ source }: { source: AgentSource }) => (
  <span className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant text-[10px] font-label-caps uppercase tracking-wide">
    {SOURCE_LABELS[source]}
  </span>
);

function statusLabel(row: AgentRow): { text: string; tone: string } {
  if (row.registered === true) return { text: "Registered", tone: "text-secondary" };
  if (row.registered === false) {
    return {
      text: row.sources.includes("event:registered")
        ? "Unregistered (no event; inferred from live state)"
        : "Unregistered",
      tone: "text-on-surface-variant",
    };
  }
  return { text: "Status unknown (entry archived or RPC error)", tone: "text-tertiary" };
}

function windowsDays(window: { oldestLedger: number; latestLedger: number } | undefined): number | null {
  if (!window) return null;
  return Math.max(0, Math.round((window.latestLedger - window.oldestLedger) / 17_280));
}

export default function AdminAgentsPage() {
  return (
    <RequireWallet
      title="Restricted Access"
      description="The agent registry requires a secure wallet connection for institutional authentication."
    >
      <AdminAgentsContent />
    </RequireWallet>
  );
}

function AdminAgentsContent() {
  const { address } = useWallet();
  const agents = useAgents();
  const registryAdmin = useRegistryAdmin();
  const register = useRegisterAgent();
  const unregister = useUnregisterAgent();

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ action: AgentAction; agent: string } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [typed, setTyped] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);

  const authorized = isAdminAddress(address);
  const rows = useMemo(() => agents.data?.rows ?? [], [agents.data?.rows]);
  const reviewRow = useMemo(() => rows.find((row) => row.address === review?.agent), [rows, review?.agent]);
  const adminHint = registryAdmin.data;
  const notAdmin = Boolean(adminHint && address && adminHint !== address);
  const busy = register.isPending || unregister.isPending;
  const days = windowsDays(agents.data?.window);

  if (!authorized) {
    return (
      <main className="flex-grow flex items-center justify-center p-gutter">
        <div className="max-w-md w-full text-center space-y-4 bg-white p-10 rounded-xl border border-outline-variant shadow-sm">
          <h2 className="font-headline-md text-headline-md">Access Denied</h2>
          <p className="text-on-surface-variant">Only OracleDesk admins can manage registry agents.</p>
          <p className="text-on-surface-variant text-sm font-data-mono break-all">{address}</p>
        </div>
      </main>
    );
  }

  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    if (!StrKey.isValidEd25519PublicKey(trimmed) && !StrKey.isValidContract(trimmed)) return null;
    try {
      return Address.fromString(trimmed).toString();
    } catch {
      return null;
    }
  };

  const startReview = async (action: AgentAction, candidate: string) => {
    setError(null);
    setTxHash(null);
    setTyped("");
    const agent = normalize(candidate);
    if (!agent) {
      setError("Enter a valid Stellar account (G…) or contract (C…) address.");
      return;
    }
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }
    if (notAdmin) {
      setError(`This wallet is not the registry admin (${adminHint}). Only the admin can register or unregister agents.`);
      return;
    }
    setReviewing(true);
    try {
      await simulateAgentAction(action, agent, address);
      setReview({ action, agent });
    } catch (err) {
      setError(describeError(err, "reasoningRegistry").message);
      setReview(null);
    } finally {
      setReviewing(false);
    }
  };

  const confirm = async () => {
    if (!review) return;
    setError(null);
    try {
      const result = review.action === "register"
        ? await register.mutateAsync({ agent: review.agent })
        : await unregister.mutateAsync({ agent: review.agent });
      setTxHash(result.txHash);
      setReview(null);
      setInput("");
      setTyped("");
    } catch (err) {
      setError(describeError(err, "reasoningRegistry").message);
    }
  };

  const confirmationSuffix = review?.agent.slice(-6) ?? "";
  const canConfirm = review && (review.action === "register" || typed === confirmationSuffix) && !busy;

  return (
    <main className="flex-grow max-w-container-max-width mx-auto px-gutter py-12 w-full space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Link href="/admin" className="hover:text-primary">Admin</Link>
            <span className="material-symbols-outlined text-sm">chevron_right</span>
            <span>Agents</span>
          </div>
          <h1 className="font-display-lg text-display-lg text-primary text-4xl">Reasoning agents</h1>
          <p className="text-on-surface-variant font-body-lg text-body-lg max-w-3xl">
            Who can publish traces right now. Status is read live from <code className="font-data-mono">{CONTRACTS.reasoningRegistry.slice(0, 8)}…</code>;
            event sources only tell us which addresses to look at.
          </p>
        </div>
      </div>

      <section className="bg-surface-container-low border border-outline-variant rounded-xl p-5 space-y-2">
        <p className="text-sm text-on-surface-variant">
          {agents.data
            ? <>Events cover ledgers <strong>{agents.data.window.oldestLedger}</strong>–<strong>{agents.data.window.latestLedger}</strong>{days !== null ? ` (about ${days} days)` : ""}. Agents registered earlier and never published in this window appear only if configured.</>
            : agents.isLoading ? "Reading registry events…" : "Couldn't read registry events."}
        </p>
        {agents.data?.partial && (
          <p className="text-sm text-tertiary">
            Partial window: the event read stopped at its page cap, so some registrations or traces may be missing.
          </p>
        )}
        {registryAdmin.isError && (
          <p className="text-sm text-on-surface-variant">
            Couldn&apos;t read the registry admin. The contract still decides who may register or unregister.
          </p>
        )}
        {notAdmin && (
          <p className="text-sm text-tertiary">
            Connected wallet <span className="font-data-mono">{address}</span> is not the registry admin
            {" "}(<span className="font-data-mono">{adminHint}</span>). Actions are disabled; the contract would reject them.
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 bg-white border border-outline-variant rounded-xl p-6 space-y-4 h-fit">
          <h2 className="font-headline-sm text-headline-sm">Register or unregister</h2>
          <p className="text-sm text-on-surface-variant">
            The contract simulates first. Nothing is signed until you review the result.
          </p>
          <label className="block font-label-caps text-label-caps text-on-surface-variant" htmlFor="agent-address">
            AGENT ADDRESS
          </label>
          <input
            id="agent-address"
            value={input}
            onChange={(event) => { setInput(event.target.value); setReview(null); setError(null); }}
            placeholder="G… or C…"
            className="w-full bg-surface border border-outline-variant rounded p-3 font-data-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {input && (
            <p className="text-xs text-on-surface-variant break-all">
              {normalize(input) ? <>Normalized: <span className="font-data-mono">{normalize(input)}</span></> : "Not a valid G… or C… address."}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={reviewing || notAdmin || busy}
              onClick={() => void startReview("register", input)}
              className="bg-primary text-primary-foreground px-4 py-3 rounded-lg font-label-caps text-label-caps disabled:opacity-50"
            >
              {reviewing ? "SIMULATING…" : "REVIEW REGISTER"}
            </button>
            <button
              type="button"
              disabled={reviewing || notAdmin || busy}
              onClick={() => void startReview("unregister", input)}
              className="border border-outline text-on-surface px-4 py-3 rounded-lg font-label-caps text-label-caps disabled:opacity-50"
            >
              REVIEW UNREGISTER
            </button>
          </div>

          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          {txHash && (
            <p className="text-sm text-secondary">
              Submitted. <a className="underline font-data-mono" href={explorerTx(txHash)} target="_blank" rel="noreferrer">View transaction</a>
            </p>
          )}

          {review && (
            <div className="border border-primary/30 bg-primary-container/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-headline-sm text-headline-sm">Review</h3>
                <button type="button" onClick={() => setReview(null)} className="text-xs text-on-surface-variant underline">Cancel</button>
              </div>
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div><dt className="text-on-surface-variant text-xs uppercase">Function</dt><dd className="font-data-mono">{review.action === "register" ? "register_agent" : "unregister_agent"}</dd></div>
                <div><dt className="text-on-surface-variant text-xs uppercase">Contract</dt><dd className="font-data-mono break-all">{CONTRACTS.reasoningRegistry}</dd></div>
                <div><dt className="text-on-surface-variant text-xs uppercase">Agent</dt><dd className="font-data-mono break-all">{review.agent}</dd></div>
                <div><dt className="text-on-surface-variant text-xs uppercase">Current status</dt><dd>{reviewRow ? statusLabel(reviewRow).text : "Not in the list yet"}</dd></div>
                <div><dt className="text-on-surface-variant text-xs uppercase">Traces in window</dt><dd>{reviewRow?.tracesInWindow ?? 0}</dd></div>
              </dl>
              <p className="text-xs text-on-surface-variant">
                <a className="underline" href={explorerAccount(review.agent)} target="_blank" rel="noreferrer">Open in Stellar Expert</a>
              </p>
              {review.action === "unregister" && (
                <div className="space-y-2 border-t border-outline-variant pt-3">
                  <p className="text-sm text-tertiary">
                    Unregistering stops future publishes immediately. It does not invalidate traces already on-chain.
                  </p>
                  <label className="block text-xs font-label-caps text-on-surface-variant" htmlFor="agent-confirm">
                    TYPE THE LAST 6 CHARACTERS ({confirmationSuffix})
                  </label>
                  <input
                    id="agent-confirm"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    className="w-full bg-surface border border-outline-variant rounded p-2 font-data-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
              <button
                type="button"
                disabled={!canConfirm}
                onClick={() => void confirm()}
                className="w-full bg-primary text-primary-foreground px-4 py-3 rounded-lg font-label-caps text-label-caps disabled:opacity-50"
              >
                {busy ? "WAITING FOR WALLET…" : review.action === "register" ? "REGISTER AGENT" : "UNREGISTER AGENT"}
              </button>
            </div>
          )}
        </div>

        <div className="xl:col-span-3 bg-white border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-5 border-b border-outline-variant flex items-center justify-between gap-3">
            <h2 className="font-headline-sm text-headline-sm">Known agents</h2>
            <span className="text-xs text-on-surface-variant">{rows.length} address{rows.length === 1 ? "" : "es"}</span>
          </div>
          {agents.isLoading ? (
            <p className="p-8 text-center text-on-surface-variant animate-pulse">Reading events and live status…</p>
          ) : agents.isError ? (
            <div className="p-8 text-center text-error">
              <p>Couldn&apos;t load agents.</p>
              <button type="button" className="mt-3 underline text-sm" onClick={() => void agents.refetch()}>Retry</button>
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-on-surface-variant">No agents found in this window and no configured addresses.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Sources</th>
                    <th className="px-4 py-3">Live status</th>
                    <th className="px-4 py-3">Traces</th>
                    <th className="px-4 py-3">Last publish</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {rows.map((row) => {
                    const status = statusLabel(row);
                    return (
                      <tr key={row.address} className="align-top">
                        <td className="px-4 py-4">
                          <a href={explorerAccount(row.address)} target="_blank" rel="noreferrer" className="font-data-mono text-xs break-all text-primary hover:underline">
                            {row.address}
                          </a>
                          {row.lastTraceId && (
                            <p className="mt-1 text-xs">
                              <Link href={`/reasoning/verify?onChainTraceId=${row.lastTraceId}`} className="underline text-on-surface-variant">
                                Verify newest trace #{row.lastTraceId}
                              </Link>
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-4 max-w-[190px]">
                          {row.sources.map((source) => <SourceBadge key={source} source={source} />)}
                        </td>
                        <td className={`px-4 py-4 ${status.tone}`}>{status.text}</td>
                        <td className="px-4 py-4 font-data-mono">{row.tracesInWindow}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-on-surface-variant">
                          {row.lastPublishedAt ? new Date(row.lastPublishedAt * 1000).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            disabled={notAdmin || reviewing || busy}
                            onClick={() => void startReview(row.registered === true ? "unregister" : "register", row.address)}
                            className="text-xs underline text-primary disabled:opacity-40 disabled:no-underline"
                          >
                            {row.registered === true ? "Unregister" : "Register"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
