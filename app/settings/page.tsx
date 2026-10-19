"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/contexts/WalletContext";
import { usePaymentEvents, useSetSpendingAllowance, useSpendingAllowance } from "@/lib/hooks/useTraces";
import { apiNumberToRaw, computeTodayUsage, rawToApiNumber, validateAllowance } from "@/lib/format/allowance";
import { formatUsdc, tryParseUsdc } from "@/lib/stellar/units";
import { UsdcInput } from "@/components/ui/usdc-input";
import { NETWORK_LABEL } from "@/lib/stellar/config";
import { shortAddress } from "@/lib/stellar/units";

function SettingsSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-6"><h2 className="mb-6 flex items-center gap-2 font-headline-sm text-headline-sm"><span className="material-symbols-outlined text-primary">{icon}</span>{title}</h2>{children}</section>;
}

export default function SettingsPage() {
  const wallet = useWallet();
  const allowance = useSpendingAllowance();
  const payments = usePaymentEvents();
  const save = useSetSpendingAllowance();
  const [daily, setDaily] = useState("");
  const [perTrace, setPerTrace] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (allowance.data) { setDaily(formatUsdc(apiNumberToRaw(allowance.data.dailyLimit).raw)); setPerTrace(formatUsdc(apiNumberToRaw(allowance.data.perTraceLimit).raw)); } }, [allowance.data]);
  const dailyRaw = tryParseUsdc(daily);
  const perTraceRaw = tryParseUsdc(perTrace);
  const errors = useMemo(() => validateAllowance(dailyRaw, perTraceRaw), [dailyRaw, perTraceRaw]);
  const usage = computeTodayUsage(payments.data ?? []);
  const usageLimit = dailyRaw ?? 0n;
  const usagePercent = usageLimit > 0n ? Math.min(100, Number((usage * 100n) / usageLimit)) : 0;
  async function submit() {
    if (Object.keys(errors).length || dailyRaw === null || perTraceRaw === null) return;
    const dailyApi = rawToApiNumber(dailyRaw); const perTraceApi = rawToApiNumber(perTraceRaw);
    if (!dailyApi.ok || !perTraceApi.ok) return;
    try { await save.mutateAsync({ dailyLimit: dailyApi.value, perTraceLimit: perTraceApi.value, currency: "USDC" }); setMessage("Your trace spending limits were saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save your limits."); }
  }
  return <main className="mx-auto w-full max-w-container-max-width flex-grow px-gutter pb-20 pt-8"><header className="mb-10"><h1 className="mb-2 font-headline-md text-headline-md text-on-surface">Settings</h1><p className="text-body-md text-on-surface-variant">Control wallet-scoped preferences and trace spending limits.</p></header><div className="grid grid-cols-1 gap-8 md:grid-cols-12"><div className="space-y-8 md:col-span-7"><SettingsSection title="Wallet" icon="account_balance_wallet">{wallet.isConnected && wallet.address ? <div className="flex items-center justify-between rounded border border-outline-variant bg-surface-container-low p-4"><div><p className="text-xs text-on-surface-variant">Connected wallet</p><p className="font-data-mono">{shortAddress(wallet.address, 6, 6)} <span className="ml-2 text-xs text-secondary">{NETWORK_LABEL}</span></p></div><Link href="/portfolio/wallets" className="text-primary hover:underline">Manage</Link></div> : <button onClick={() => void wallet.openModal()} className="rounded bg-primary px-4 py-2 text-white">Connect wallet</button>}</SettingsSection><SettingsSection title="Trace spending limits" icon="payments">{!wallet.isConnected ? <p className="text-sm text-on-surface-variant">Connect your wallet to manage spending limits.</p> : !wallet.isAuthenticated ? <div><p className="mb-3 text-sm text-on-surface-variant">Sign in to view and change your limits.</p><button onClick={() => void wallet.ensureSession()} className="rounded bg-primary px-4 py-2 text-white">Sign in</button></div> : <div className="space-y-5"><p className="text-sm text-on-surface-variant">Payments are blocked until you set a positive daily and per-trace limit.</p><div className="grid gap-4 sm:grid-cols-2"><UsdcInput label="Daily limit (USDC)" value={daily} onValueChange={(_, text) => setDaily(text)} error={errors.daily} /><UsdcInput label="Per-trace limit (USDC)" value={perTrace} onValueChange={(_, text) => setPerTrace(text)} error={errors.perTrace} /></div><div><div className="mb-1 flex justify-between text-xs text-on-surface-variant"><span>Used today</span><span>{formatUsdc(usage)}{usageLimit ? ` of ${formatUsdc(usageLimit)} USDC` : " USDC"}</span></div><div className="h-2 overflow-hidden rounded bg-surface-container"><div className="h-full bg-primary" style={{ width: `${usagePercent}%` }} /></div></div><button disabled={save.isPending || Boolean(Object.keys(errors).length)} onClick={() => void submit()} className="rounded bg-primary px-5 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">{save.isPending ? "Saving…" : "Save limits"}</button>{message && <p aria-live="polite" className="text-sm text-on-surface-variant">{message}</p>}</div>}</SettingsSection></div><div className="space-y-8 md:col-span-5"><SettingsSection title="Trading defaults" icon="settings_input_component"><p className="text-sm text-on-surface-variant">Trading preference controls are coming soon.</p></SettingsSection></div></div></main>;
}
