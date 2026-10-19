"use client";
import { Icon, type IconName } from "@/components/ui/icon";

import React from "react";

/**
 * Data-agnostic connected-wallet panel, extracted from the retired
 * wallet-demo page (issue #49). The address, network label, balances and
 * actions all come from props — nothing here is chain-specific. Rendered by
 * the design gallery under /dev/gallery; not wired into any production flow.
 */

export interface WalletBalance {
  symbol: string;
  icon: IconName;
  amount: string;
  fiat?: string;
}

export interface WalletPanelProps {
  networkLabel: string;
  address: string;
  addressNote?: string;
  balances: WalletBalance[];
  networks?: { label: string; icon: IconName; active: boolean }[];
  actions?: { label: string; icon: IconName; onAction?: () => void }[];
  footerNote?: string;
  onDisconnect?: () => void;
}

export function WalletPanel({
  networkLabel,
  address,
  addressNote,
  balances,
  networks,
  actions,
  footerNote,
  onDisconnect,
}: WalletPanelProps) {
  return (
    <div className="w-full max-w-[320px] bg-white border border-outline-variant rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">
      {/* Account */}
      <div className="p-4 border-b border-outline-variant bg-surface-container-low/30">
        <div className="flex items-center justify-between mb-3">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Connected Wallet</span>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary-container/20 text-on-secondary-container font-label-caps text-[10px] uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
            {networkLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white shadow-inner flex-shrink-0">
            <Icon name="account_balance_wallet" />
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="font-data-mono text-data-mono text-on-surface truncate" title={address}>
              {address}
            </span>
            {addressNote && <span className="text-on-surface-variant text-[11px] font-medium truncate">{addressNote}</span>}
          </div>
        </div>
      </div>

      {/* Balances */}
      {balances.length > 0 && (
        <div className="p-4 space-y-3 max-h-[40vh] overflow-y-auto">
          {balances.map((balance) => (
            <div key={balance.symbol} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-surface-container flex items-center justify-center flex-shrink-0">
                  <Icon name={balance.icon} className="text-primary text-[16px]" />
                </div>
                <span className="font-medium text-on-surface">{balance.symbol}</span>
              </div>
              <div className="text-right">
                <div className="font-data-mono text-on-surface text-sm sm:text-base">{balance.amount}</div>
                {balance.fiat && <div className="text-[10px] text-on-surface-variant font-label-caps">{balance.fiat}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Networks */}
      {networks && networks.length > 0 && (
        <div className="px-4 pb-4">
          <span className="font-label-caps text-label-caps text-on-surface-variant block mb-2">Network</span>
          <div className="grid grid-cols-2 gap-2">
            {networks.map((network) => (
              <button
                key={network.label}
                type="button"
                disabled={network.active}
                className={`flex items-center gap-2 p-2 rounded border transition-all ${
                  network.active
                    ? "border-primary bg-primary-container/10 text-primary"
                    : "border-outline-variant hover:border-primary text-on-surface-variant"
                }`}
              >
                <Icon name={network.icon} className="text-[16px]" />
                <span className={`text-[11px] ${network.active ? "font-bold" : "font-medium"}`}>{network.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {(actions?.length || onDisconnect) && (
        <div className="p-4 bg-surface-container-lowest border-t border-outline-variant mt-auto">
          {actions && actions.length > 0 && (
            <div className="flex flex-col gap-1">
              {actions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onAction}
                  className="flex items-center justify-between p-2 rounded hover:bg-surface-container transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name={item.icon} className="text-on-surface-variant group-hover:text-primary transition-colors" />
                    <span className="text-body-md font-medium">{item.label}</span>
                  </div>
                  <Icon name="chevron_right" className="text-[16px] text-outline" />
                </button>
              ))}
            </div>
          )}
          {onDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              className="mt-4 w-full bg-surface border border-outline-variant hover:bg-error-container/10 hover:border-error hover:text-error transition-all py-2 rounded font-label-caps text-label-caps flex items-center justify-center gap-2"
            >
              <Icon name="logout" className="text-[18px]" />
              Disconnect
            </button>
          )}
        </div>
      )}

      {footerNote && (
        <div className="px-4 py-2 bg-primary-container text-on-primary-container flex items-center justify-center gap-2 text-[10px] font-medium tracking-wide">
          <Icon name="auto_awesome" className="text-[14px]" />
          {footerNote}
        </div>
      )}
    </div>
  );
}
