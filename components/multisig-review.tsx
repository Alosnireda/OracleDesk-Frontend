"use client";
import { Icon } from "@/components/ui/icon";

import { useEffect, useMemo, useState } from "react";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { CONTRACTS, NETWORK_PASSPHRASE } from "@/lib/stellar/config";
import { authExpirationLedger, signatureWeight, type MultisigSession } from "@/lib/stellar/multisig";
import { useImportMultisig, useSubmitMultisig } from "@/lib/hooks/useStellar";
import { useWallet } from "@/lib/contexts/WalletContext";
import { formatUsdc, formatXlm } from "@/lib/stellar/units";

function contractName(contractId: string): string {
  if (contractId === CONTRACTS.marketCore) return "Market core";
  if (contractId === CONTRACTS.usdc) return "USDC token (Stellar Asset Contract)";
  return "Contract";
}

function formatArg(key: string, raw: string): string {
  if (key === "collateral_in" || key === "collateral_out" || key === "min_shares_out" || key === "max_shares_in" || key === "amount") {
    try {
      return `${formatUsdc(BigInt(raw), { minDecimals: 7, maxDecimals: 7 })} USDC`;
    } catch {
      return raw;
    }
  }
  if (key === "market_id") return `#${raw}`;
  return raw;
}

function useNowMs(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

export function MultisigReview({
  session,
  onClose,
  onUpdated,
}: {
  session: MultisigSession;
  onClose?: () => void;
  onUpdated?: (next: MultisigSession) => void;
}) {
  const { signer, address } = useWallet();
  const importMut = useImportMultisig();
  const submitMut = useSubmitMultisig();
  const [importText, setImportText] = useState("");
  const [copyState, setCopyState] = useState<string | null>(null);
  const [signState, setSignState] = useState<string | null>(null);
  const nowMs = useNowMs();
  const localXdr = session.xdr;

  const parsed = useMemo(() => {
    try {
      return TransactionBuilder.fromXDR(localXdr, NETWORK_PASSPHRASE) as import("@stellar/stellar-sdk").Transaction;
    } catch {
      return null;
    }
  }, [localXdr]);

  const weightInfo = useMemo(() => {
    if (!parsed) return { weight: 0, signedBy: [] as string[], unknown: 0 };
    try {
      return signatureWeight(parsed, session.auth, NETWORK_PASSPHRASE);
    } catch {
      return { weight: 0, signedBy: [] as string[], unknown: 0 };
    }
  }, [parsed, session.auth]);

  const thresholdMet = weightInfo.weight >= session.requiredThreshold;
  const secsLeft = session.maxTime - Math.floor(nowMs / 1000);
  const expired = secsLeft <= 0;
  const coordinatorWarn = address ? !session.auth.signers.some((s) => s.type === "ed25519" && s.key === address) : false;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localXdr);
      setCopyState("Copied. Share it with co-signers out of band.");
    } catch {
      setCopyState("Copy failed. Select the XDR manually.");
    }
  };

  const handleImport = async () => {
    setCopyState(null);
    if (!importText.trim()) return;
    try {
      const res = await importMut.mutateAsync({ session, importedXdr: importText.trim() });
      onUpdated?.(res.session);
      setImportText("");
      setCopyState(
        res.unknown > 0
          ? `Imported. Weight ${res.weight}/${session.requiredThreshold}. ${res.unknown} unknown signature(s) — they cause tx_bad_auth_extra if left in.`
          : `Imported. Weight ${res.weight}/${session.requiredThreshold}.`,
      );
    } catch (err) {
      setCopyState(err instanceof Error ? err.message : "Import failed.");
    }
  };

  const handleSignWithWallet = async () => {
    setSignState(null);
    if (!signer) {
      setSignState("Connect your wallet first.");
      return;
    }
    if (!parsed) {
      setSignState("Could not parse the current XDR.");
      return;
    }
    try {
      setSignState("Waiting for your wallet… (signature only, no submit)");
      const { signedTxXdr } = await signer.signTransaction(localXdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: signer.publicKey,
      });
      const res = await importMut.mutateAsync({ session: { ...session, xdr: localXdr }, importedXdr: signedTxXdr });
      onUpdated?.(res.session);
      setSignState(`Signed. Weight ${res.weight}/${session.requiredThreshold}.`);
    } catch (err) {
      setSignState(err instanceof Error ? err.message : "Signing failed.");
    }
  };

  const handleSubmit = async () => {
    try {
      await submitMut.mutateAsync({ session: { ...session, xdr: localXdr } });
      onClose?.();
    } catch {
      // Error surfaces via submitMut.error.
    }
  };

  const submitError = submitMut.error instanceof Error ? submitMut.error.message : null;
  const expiryLabel =
    secsLeft <= 0 ? "Expired" : secsLeft < 3600 ? `Expires in ${Math.floor(secsLeft / 60)}m ${secsLeft % 60}s` : `Expires in ${Math.floor(secsLeft / 3600)}h ${Math.floor((secsLeft % 3600) / 60)}m`;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-on-background/60 p-4" data-testid="multisig-review">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
          <div>
            <p className="font-label-caps text-[10px] uppercase tracking-wider text-primary">Multisig review</p>
            <h2 className="font-headline-md text-headline-md">Check before collecting signatures</h2>
          </div>
          <button type="button" aria-label="Close multisig review" onClick={onClose} className="p-2 text-outline hover:text-error">
            <Icon name="close" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <h3 className="mb-3 font-label-caps text-label-caps text-on-surface">What you&apos;re doing</h3>
            <dl className="space-y-2">
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Operation</dt>
                <dd className="text-sm font-medium">{session.kind}</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Contract</dt>
                <dd className="break-all text-sm">{contractName(session.contractId)} <span className="font-data-mono text-xs text-on-surface-variant">{session.contractId}</span></dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Function</dt>
                <dd className="font-data-mono text-sm">{session.fn}</dd>
              </div>
              {Object.entries(session.args ?? {}).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_1fr] gap-3">
                  <dt className="text-sm text-on-surface-variant">{k}</dt>
                  <dd className="break-all text-sm font-medium">{formatArg(k, v)} <span className="ml-2 font-data-mono text-xs text-on-surface-variant">{v}</span></dd>
                </div>
              ))}
            </dl>
            {(session.kind === "buy" || session.kind === "sell") && (
              <p className="mt-2 text-xs text-amber-800">
                Quote is from ledger {session.quoteLedger ?? "N"} with {((session.args && "min_shares_out" in session.args) || session.kind === "buy") ? "3% slippage" : "3% slippage"}. The trade fails with SlippageExceeded (error 12) if the price moves further. The footprint/resource fee is from the build-time simulation; rebuild if submission fails with a resource or archived-entry error.
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-3 font-label-caps text-label-caps text-on-surface">Network details</h3>
            <dl className="space-y-2">
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Source account</dt>
                <dd className="break-all font-data-mono text-sm">{session.sourceAccount}</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Sequence</dt>
                <dd className="font-data-mono text-sm">{session.sequence} (account seq {session.auth.sequence.toString()}; any other transaction bumps it and invalidates this one)</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Fee</dt>
                <dd className="font-data-mono text-sm">{formatXlm(BigInt(session.fee))} XLM ({session.fee} stroops)</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Expiry</dt>
                <dd className="font-data-mono text-sm">{expiryLabel} (maxTime {session.maxTime}; checked against ledger close time, not your browser clock)</dd>
              </div>
              {session.closeTime !== undefined && (
                <div className="grid grid-cols-[9rem_1fr] gap-3">
                  <dt className="text-sm text-on-surface-variant">Market close</dt>
                  <dd className="font-data-mono text-sm">{new Date(session.closeTime * 1000).toLocaleString()} (trade fails with MarketClosed/error 9 after this)</dd>
                </div>
              )}
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-sm text-on-surface-variant">Hash</dt>
                <dd className="break-all font-data-mono text-xs">{session.hash}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="mb-3 font-label-caps text-label-caps text-on-surface">Signatures ({weightInfo.weight}/{session.requiredThreshold})</h3>
            <div className="mb-2 h-2 w-full overflow-hidden rounded bg-surface-container">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (weightInfo.weight / Math.max(1, session.requiredThreshold)) * 100)}%` }}
              />
            </div>
            <ul className="space-y-1">
              {session.auth.signers.map((s) => (
                <li key={s.key} className="flex items-center justify-between font-data-mono text-xs">
                  <span className={weightInfo.signedBy.includes(s.key) ? "text-primary font-bold" : "text-on-surface-variant"}>
                    {s.key.slice(0, 6)}…{s.key.slice(-4)} ({s.type}, w{s.weight}) {weightInfo.signedBy.includes(s.key) ? "✓" : ""}
                  </span>
                  <span>weight {s.weight}</span>
                </li>
              ))}
            </ul>
            {session.auth.signers.some((s) => s.type !== "ed25519") && (
              <p className="mt-1 text-xs text-on-surface-variant">preAuthTx / hashX / signedPayload signers are listed but don&apos;t count toward UI weight.</p>
            )}
            {weightInfo.unknown > 0 && (
              <p className="mt-1 text-xs text-error">Warning: {weightInfo.unknown} unknown/invalid signature(s). They cause tx_bad_auth_extra — strip them before submitting.</p>
            )}
            {coordinatorWarn && (
              <p className="mt-1 text-xs text-amber-800">The connected wallet ({address?.slice(0, 6)}…) is not one of this account&apos;s signers. You can still coordinate, but &quot;Sign with connected wallet&quot; will add an unknown signature.</p>
            )}
            {session.nonInvoker.length > 0 ? (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                <p className="font-bold">Non-source authorization required:</p>
                {session.nonInvoker.map((a) => (
                  <p key={a} className="font-data-mono">{a} — export an auth entry via signAuthEntries({"{"}address, expiration{"}"}) with expiration ledger {authExpirationLedger(0, 3600)} (current ledger + window/5s).</p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-on-surface-variant">Non-source auth entries: none (expected — trader/holder/from is the source account).</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-label-caps text-label-caps text-on-surface">Export / import XDR</h3>
            <textarea
              readOnly
              value={localXdr}
              rows={3}
              className="w-full break-all rounded border border-outline-variant bg-surface-container-lowest p-2 font-data-mono text-[10px]"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleCopy} className="rounded border border-outline-variant px-3 py-1.5 text-xs font-bold">Copy XDR</button>
              <button type="button" onClick={handleSignWithWallet} className="rounded border border-outline-variant px-3 py-1.5 text-xs font-bold">Sign with connected wallet (no submit)</button>
            </div>
            {copyState && <p className="text-xs text-on-surface-variant">{copyState}</p>}
            {signState && <p className="text-xs text-on-surface-variant">{signState}</p>}
            <label className="block text-xs font-bold" htmlFor="multisig-import">Import signed XDR</label>
            <textarea
              id="multisig-import"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste signed XDR from a co-signer…"
              rows={3}
              className="w-full rounded border border-outline-variant p-2 font-data-mono text-[10px]"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importMut.isPending || !importText.trim()}
              className="rounded bg-surface-container px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            >
              {importMut.isPending ? "Importing…" : "Import signed XDR"}
            </button>
            {expired && <p className="text-xs text-error">This transaction expired before it was submitted. Prepare it again with a fresh quote.</p>}
          </section>
        </div>

        <footer className="flex justify-end gap-3 border-t border-outline-variant px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-4 py-2 text-sm">Close</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!thresholdMet || expired || submitMut.isPending}
            title={!thresholdMet ? `Need ${session.requiredThreshold - weightInfo.weight} more weight` : expired ? "Expired — prepare again" : "Submit to the network"}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-on-primary disabled:opacity-50"
          >
            {submitMut.isPending ? "Submitting…" : thresholdMet ? "Submit" : `Submit (${weightInfo.weight}/${session.requiredThreshold})`}
          </button>
        </footer>
        {submitError && <p className="border-t border-outline-variant bg-red-50 px-6 py-2 text-xs text-error">{submitError}</p>}
      </div>
    </div>
  );
}
