"use client";
import { Icon } from "@/components/ui/icon";

import React, { useEffect, useState } from "react";
import { WalletPanel } from "@/components/demo/wallet-panel";
import { DemoBadge } from "@/components/ui/demo-badge";

/**
 * Gallery version of the retired wallet-demo screen (issue #49). The
 * dropdown interaction is kept; the panel itself is the reusable WalletPanel
 * and every value is sample data.
 */
export function WalletDemoScreen() {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="relative min-h-[480px] rounded-lg bg-surface-container-low/40 p-6">
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="bg-primary text-on-primary px-4 py-2 rounded-lg font-label-caps text-label-caps flex items-center gap-2 shadow-sm"
        >
          <Icon name="account_balance_wallet" filled className="text-[18px]" />
          G…4f2a
        </button>
      </div>
      <div className={`flex justify-end transition-all duration-300 ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <WalletPanel
          networkLabel="Stellar Testnet"
          address="GDEM…4F2A"
          addressNote="Sample Wallet (Stellar)"
          balances={[
            { symbol: "USDC", icon: "monetization_on", amount: "12,450.00", fiat: "$12,450.00" },
            { symbol: "XLM", icon: "diamond", amount: "4,284.00", fiat: "sample" },
          ]}
          networks={[
            { label: "Testnet", icon: "hub", active: true },
            { label: "Pubnet", icon: "layers", active: false },
          ]}
          actions={[
            { label: "History", icon: "history" },
            { label: "Settings", icon: "settings" },
          ]}
          footerNote="SAMPLE DATA — LAYOUT ONLY"
          onDisconnect={() => setIsOpen(false)}
        />
      </div>
      <div className="absolute top-4 left-4">
        <DemoBadge />
      </div>
    </div>
  );
}
