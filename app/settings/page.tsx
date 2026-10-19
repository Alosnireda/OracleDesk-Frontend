"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/contexts/WalletContext";
import { NETWORK_LABEL } from "@/lib/stellar/config";
import { shortAddress } from "@/lib/stellar/units";
import {
  MAX_SLIPPAGE_BPS,
  SLIPPAGE_PRESET_BPS,
  parseSlippagePercent,
  type NotificationSettings,
} from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/useSettings";
import { PushSettings } from "@/components/settings/push-settings";

const SettingsSection = ({ title, icon, children, className = "" }: { title: string; icon: string; children: React.ReactNode; className?: string }) => (
  <section className={`bg-surface-container-lowest border border-outline-variant p-6 rounded-lg transition-all hover:shadow-sm ${className}`}>
    <div className="flex justify-between items-center mb-6">
      <h2 className="font-headline-sm text-headline-sm flex items-center gap-2">
        <span className="material-symbols-outlined text-primary">{icon}</span>
        {title}
      </h2>
    </div>
    {children}
  </section>
);

const ToggleSwitch = ({ checked, onChange, label, sublabel }: { checked: boolean; onChange: () => void; label: string; sublabel?: string }) => (
  <div className="flex items-center justify-between py-2">
    <div>
      <p className="text-body-md font-bold text-on-surface">{label}</p>
      {sublabel && <p className="text-[11px] text-on-surface-variant">{sublabel}</p>}
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={onChange} />
      <div className="w-11 h-6 bg-outline-variant rounded-full peer peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
    </label>
  </div>
);

export default function SettingsPage() {
  const wallet = useWallet();
  const { settings, setSlippageBps, setNotifications } = useSettings(wallet.address);
  const [customInput, setCustomInput] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const applyCustomSlippage = (value: string) => {
    setCustomInput(value);
    if (!value.trim()) {
      setCustomError(null);
      return;
    }
    const bps = parseSlippagePercent(value);
    if (bps === null) {
      setCustomError(
        `Enter a percentage between 0% and ${(MAX_SLIPPAGE_BPS / 100).toFixed(0)}% with at most two decimal places.`,
      );
      return;
    }
    setCustomError(null);
    setSlippageBps(bps);
  };

  const notificationRows: { key: keyof NotificationSettings; label: string; sublabel: string }[] = [
    { key: "execution", label: "Execution Alerts", sublabel: "Confirmations and failures of trades you submit." },
    { key: "news", label: "Market News Insights", sublabel: "New reasoning traces and market updates." },
    { key: "shifts", label: "Probability Shifts (>5%)", sublabel: "When a market's probability moves more than five points." },
  ];

  return (
    <main className="flex-grow pt-8 pb-20 px-gutter max-w-container-max-width mx-auto w-full">
      <header className="mb-10">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-2">Settings</h1>
        <p className="text-body-md text-on-surface-variant">
          Trading defaults are stored in this browser, per wallet, and used by the quick-view and copy-trade flows.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Column: Wallet */}
        <div className="md:col-span-7 space-y-8">
          {/* Wallet Section */}
          <SettingsSection title="Wallet" icon="account_balance_wallet">
            {wallet.isConnected && wallet.address ? (
              <div className="p-4 bg-surface-container-low border border-outline-variant rounded flex justify-between items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
                  <div className="min-w-0">
                    <p className="font-label-caps text-label-caps text-on-surface-variant">Connected Wallet</p>
                    <p className="font-data-mono text-data-mono text-on-surface truncate" title={wallet.address}>
                      {shortAddress(wallet.address, 6, 6)}{" "}
                      <span className="ml-2 text-secondary text-[10px] bg-secondary-container px-2 py-0.5 rounded-full">
                        {NETWORK_LABEL.toUpperCase()}
                      </span>
                    </p>
                  </div>
                </div>
                <Link
                  href="/portfolio/wallets"
                  className="text-primary font-label-caps text-label-caps hover:underline active:opacity-70 transition-opacity shrink-0"
                >
                  Manage
                </Link>
              </div>
            ) : (
              <div className="p-4 bg-surface-container-low border border-outline-variant rounded">
                <p className="font-body-md text-body-md text-on-surface">
                  No wallet connected. Settings below are saved for this browser only; connect a wallet to store them
                  for that address.
                </p>
              </div>
            )}
            <p className="mt-4 text-[11px] text-on-surface-variant">
              Every transaction is signed inside your wallet&apos;s own prompt. OracleDesk cannot and does not sign
              on your behalf, so there is no auto-approve option.
            </p>
          </SettingsSection>
        </div>

        {/* Right Column: Trading Preferences */}
        <div className="md:col-span-5 space-y-8">
          {/* Slippage Section */}
          <section className="bg-primary-container text-white p-6 rounded-lg shadow-lg hover:shadow-xl transition-all">
            <h2 className="font-headline-sm text-headline-sm flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined">settings_input_component</span>
              Trading Defaults
            </h2>
            <div className="space-y-6">
              <div>
                <label className="font-label-caps text-label-caps text-on-primary-container block mb-2">
                  Default Slippage Tolerance
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {SLIPPAGE_PRESET_BPS.map((bps) => (
                    <button
                      key={bps}
                      onClick={() => setSlippageBps(bps)}
                      className={`py-2 rounded font-data-mono text-data-mono transition-colors ${
                        settings.slippageBps === bps
                          ? "bg-on-primary-container text-primary-container font-bold"
                          : "bg-primary border border-on-primary-container hover:bg-on-primary-container/20"
                      }`}
                    >
                      {bps / 100}%
                    </button>
                  ))}
                  <input
                    className="bg-transparent border border-on-primary-container rounded py-2 px-2 text-center text-data-mono placeholder:text-on-primary-container/50 focus:ring-1 focus:ring-white focus:outline-none"
                    placeholder="Custom"
                    type="text"
                    inputMode="decimal"
                    aria-label="Custom slippage percentage"
                    aria-invalid={customError !== null}
                    value={customInput}
                    onChange={(e) => applyCustomSlippage(e.target.value)}
                  />
                </div>
                {customError && (
                  <p className="mt-2 text-[11px] text-error font-medium" role="alert">
                    {customError}
                  </p>
                )}
                <p className="mt-3 text-[11px] text-on-primary-container/90">
                  Trades revert instead of filling below this tolerance. Stored as {settings.slippageBps} basis points
                  (maximum {MAX_SLIPPAGE_BPS / 100}%).
                </p>
              </div>
            </div>
          </section>

          {/* Notifications Section */}
          <SettingsSection title="Notifications" icon="notifications_active">
            <div className="space-y-4">
              {notificationRows.map((row) => (
                <ToggleSwitch
                  key={row.key}
                  label={row.label}
                  sublabel={row.sublabel}
                  checked={settings.notifications[row.key]}
                  onChange={() =>
                    setNotifications({ ...settings.notifications, [row.key]: !settings.notifications[row.key] })
                  }
                />
              ))}
            </div>
          </SettingsSection>

          {/* Push Notifications (device-level, per wallet) */}
          <SettingsSection title="Push Notifications" icon="notifications">
            <PushSettings />
          </SettingsSection>
        </div>
      </div>
    </main>
  );
}
