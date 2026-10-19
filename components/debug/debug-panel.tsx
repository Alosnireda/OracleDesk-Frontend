"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { useWallet } from "@/lib/contexts/WalletContext";
import { getStoredToken } from "@/lib/api/client";
import { CONFIG_SOURCES, CONTRACTS, EXPLORER_URL, IPFS_GATEWAY, NETWORK_PASSPHRASE, PAYMENTS_RECIPIENT, RPC_URLS, X402_URL } from "@/lib/stellar/config";
import provenance from "@/lib/stellar/generated/provenance.json";
import { snapshot, subscribeSimulations } from "@/lib/diagnostics/events";
import { bigintReplacer, buildDiagnostics, serializeDiagnostics } from "@/lib/diagnostics/bundle";
import { redact } from "@/lib/diagnostics/redact";
import { rpcPool } from "@/lib/stellar/clients";
import { RpcPanel } from "./RpcPanel";
import type { DebugTab } from "./debug-mount";

const TABS: DebugTab[] = ["config", "wallet", "cache", "simulations", "rpc", "errors"];

function preview(v: unknown, max = 160): string {
  try {
    const s = JSON.stringify(redact(v), bigintReplacer);
    return s && s.length > max ? `${s.slice(0, max)}…` : (s ?? "");
  } catch {
    return "[unserializable]";
  }
}

function useStellarQueries(): Query[] {
  const cache = useQueryClient().getQueryCache();
  const [version, setVersion] = useState(0);
  useEffect(() => cache.subscribe(() => setVersion((v) => v + 1)), [cache]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces a re-read on cache events
  return useMemo(() => cache.findAll({ queryKey: ["stellar"] }), [cache, version]);
}

export default function DebugPanel({ initialTab, onClose }: { initialTab: DebugTab; onClose: () => void }) {
  const [tab, setTab] = useState<DebugTab>(initialTab);
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const queries = useStellarQueries();
  const sims = useSyncExternalStore(subscribeSimulations, snapshot, snapshot);
  const [copyText, setCopyText] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);

  const walletInfo = {
    isConnected: wallet.isConnected,
    address: wallet.address,
    walletNetworkPassphrase: wallet.walletNetworkPassphrase,
    isWrongNetwork: wallet.isWrongNetwork,
    isAuthenticated: wallet.isAuthenticated,
    hasStoredToken: Boolean(getStoredToken()),
    selectedWalletId: wallet.selectedWalletId ?? null,
  };

  const prepareCopy = () => {
    const bundle = buildDiagnostics({
      wallet: walletInfo,
      queries,
      simulations: sims,
      rpc: rpcPool()?.stats() ?? null,
      userAgent: navigator.userAgent,
    });
    setCopied(null);
    setCopyText(serializeDiagnostics(bundle));
  };

  const doCopy = async () => {
    if (!copyText) return;
    try {
      if (!window.isSecureContext || !navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(copyText);
      setCopied("ok");
    } catch {
      setCopied("manual"); // fall back to the selectable textarea below
    }
  };

  const errors = [
    ...(wallet.error ? [{ source: "wallet", message: wallet.error }] : []),
    ...queries.filter((q) => q.state.error).map((q) => ({ source: JSON.stringify(q.queryKey, bigintReplacer), message: String((q.state.error as Error)?.message ?? q.state.error) })),
    ...sims.filter((s) => s.error).map((s) => ({ source: `${s.contract}.${s.method}`, message: s.error as string })),
  ];

  return (
    <aside className="fixed bottom-4 right-4 z-[200] w-[min(640px,calc(100vw-2rem))] max-h-[70vh] flex flex-col bg-surface-container-lowest text-on-surface border border-outline-variant rounded-lg shadow-xl text-xs" aria-label="Debug panel">
      <header className="flex items-center gap-1 border-b border-outline-variant p-2 flex-wrap">
        <strong className="mr-2">Debug</strong>
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-2 py-0.5 rounded ${tab === t ? "bg-primary text-white" : "hover:bg-surface-container"}`}>
            {t}
          </button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto px-2" aria-label="Close debug panel">✕</button>
      </header>

      <div className="overflow-auto p-2 flex-1 font-data-mono">
        {tab === "config" && (
          <dl className="grid grid-cols-[max-content_1fr_max-content] gap-x-3 gap-y-1">
            {Object.entries({ NETWORK_PASSPHRASE, RPC_URLS: RPC_URLS.join(", "), EXPLORER_URL, ...Object.fromEntries(Object.entries(CONTRACTS).map(([k, v]) => [`CONTRACTS.${k}`, v])), PAYMENTS_RECIPIENT, IPFS_GATEWAY, X402_URL }).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-outline">{k}</dt>
                <dd className="break-all">{String(v) || "–"}</dd>
                <dd className="text-outline">{CONFIG_SOURCES[k] ?? ""}</dd>
              </div>
            ))}
            <dt className="text-outline">bindings</dt>
            <dd className="break-all">OracleDesk-SmartContract@{provenance.contractsCommit.slice(0, 12)}</dd>
            <dd />
            <dt className="text-outline">build</dt>
            <dd>{process.env.NEXT_PUBLIC_BUILD_SHA || process.env.NEXT_PUBLIC_BUILD_ID || "dev"}</dd>
            <dd />
          </dl>
        )}

        {tab === "wallet" && <pre className="whitespace-pre-wrap">{JSON.stringify(redact(walletInfo), null, 2)}</pre>}

        {tab === "cache" && (
          <>
            <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["stellar"] })} className="mb-2 px-2 py-1 border rounded">
              Invalidate stellar queries
            </button>
            <ul className="space-y-1">
              {queries.map((q) => (
                <li key={q.queryHash} className="border-b border-outline-variant/40 pb-1">
                  <div>{JSON.stringify(q.queryKey, bigintReplacer)} · {q.state.status} · {q.state.dataUpdatedAt ? new Date(q.state.dataUpdatedAt).toLocaleTimeString() : "–"}</div>
                  {q.state.error ? <div className="text-error">{String((q.state.error as Error).message ?? q.state.error)}</div> : null}
                  <div className="text-outline break-all">{preview(q.state.data)}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "simulations" && (
          <ul className="space-y-1">
            {[...sims].reverse().map((s, i) => (
              <li key={`${s.at}-${i}`} className="border-b border-outline-variant/40 pb-1">
                {new Date(s.at).toLocaleTimeString()} {s.contract}.{s.method} · ledger {s.latestLedger ?? "–"} · r/w {s.readEntries ?? "–"}/{s.writeEntries ?? "–"} · fee {s.minResourceFee ?? "–"}
                {s.txHash ? ` · tx ${s.txHash}` : ""}
                {s.error && <div className="text-error">{String(redact(s.error))}</div>}
              </li>
            ))}
            {sims.length === 0 && <li className="text-outline">No simulations recorded yet.</li>}
          </ul>
        )}

        {tab === "rpc" && <RpcPanel />}

        {tab === "errors" && (
          <ul className="space-y-1">
            {errors.map((e, i) => (
              <li key={i}><span className="text-outline">{e.source}</span> {String(redact(e.message))}</li>
            ))}
            {errors.length === 0 && <li className="text-outline">No errors.</li>}
          </ul>
        )}
      </div>

      <footer className="border-t border-outline-variant p-2 space-y-2">
        {!copyText ? (
          <button type="button" onClick={prepareCopy} className="px-2 py-1 bg-primary text-white rounded">Copy diagnostics…</button>
        ) : (
          <>
            <p>Preview (redacted). Review it before pasting into a public issue.</p>
            <textarea readOnly value={copyText} className="w-full h-32 font-data-mono text-[10px] border rounded p-1" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2 items-center">
              <button type="button" onClick={() => void doCopy()} className="px-2 py-1 bg-primary text-white rounded">Copy</button>
              <button type="button" onClick={() => setCopyText(null)} className="px-2 py-1 border rounded">Cancel</button>
              {copied === "ok" && <span>Copied.</span>}
              {copied === "manual" && <span>Clipboard unavailable: select the text above and copy it.</span>}
            </div>
          </>
        )}
      </footer>
    </aside>
  );
}
