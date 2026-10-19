"use client";

import React, { useState } from "react";
import Image from "next/image";
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
  const [slippage, setSlippage] = useState("0.5%");
  const [autoApprove, setAutoApprove] = useState(false);

  return (
    <main className="flex-grow pt-8 pb-20 px-gutter max-w-container-max-width mx-auto w-full">
      <header className="mb-10">
        <h1 className="font-headline-md text-headline-md text-on-surface mb-2">User Settings</h1>
        <p className="text-body-md text-on-surface-variant">Manage your institutional profile, trading logic, and security preferences.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Column: Profile & Security */}
        <div className="md:col-span-7 space-y-8">
          {/* Profile Section */}
          <SettingsSection title="Profile Details" icon="account_circle">
            <div className="flex items-center gap-6 mb-8">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-2 border-surface-container-high overflow-hidden relative bg-surface-container">
                  <img
                    alt="Alexander Sterling"
                    className="w-full h-full object-cover"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuCGWqFtKhDsbOybVPby4djFKeIipFfrrNReDwn9As0eMt_2-RKqMVPlLjCXzDO3H6phqsmKsaM8QYi82di3Kia1P76rZtY2Bl55_8bjXQsloMoK4cDAHIqBvLY085CKtsvBROUf36NmVUzYcD2fwGwPdSpllaw6OtlYEygqPrwRqNQoZiPV1i6776eiZqRcBAjA9HawkbylkNOVwwh4_wcQisTfOmPkSyVsYPYRvV94JSssSLrGQ6M8khwDlhf9Fut2BqGfHAuDkA"
                  />
                </div>
                <button className="absolute bottom-0 right-0 bg-primary text-on-primary p-1 rounded-full border-2 border-surface hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-[16px]">edit</span>
                </button>
              </div>
              <div>
                <p className="font-headline-sm text-headline-sm text-on-surface">Alexander Sterling</p>
                <p className="text-body-md text-on-surface-variant">Principal Analyst • Institutional Tier</p>
              </div>
              <button className="ml-auto text-primary font-label-caps text-label-caps border border-primary px-3 py-1 rounded hover:bg-primary hover:text-on-primary transition-all self-start md:self-center">
                Edit
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Email Address</label>
                <p className="font-body-md text-body-md text-on-surface">a.sterling@oracledesk.com</p>
              </div>
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Affiliation</label>
                <p className="font-body-md text-body-md text-on-surface">Aegis Capital Partners</p>
              </div>
            </div>
          </SettingsSection>

          {/* Wallet & Security Section */}
          <SettingsSection title="Wallet & Security" icon="security">
            <div className="space-y-6">
              <div className="p-4 bg-surface-container-low border border-outline-variant rounded flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
                  <div>
                    <p className="font-label-caps text-label-caps text-on-surface-variant">Connected Wallet</p>
                    <p className="font-data-mono text-data-mono text-on-surface">
                      0x71C...4f92 <span className="ml-2 text-secondary text-[10px] bg-secondary-container px-2 py-0.5 rounded-full">ACTIVE</span>
                    </p>
                  </div>
                </div>
                <button className="text-error font-label-caps text-label-caps hover:underline active:opacity-70 transition-opacity">Disconnect</button>
              </div>
              <div>
                <div className="flex justify-between items-center mb-3">
                  <p className="font-label-caps text-label-caps text-on-surface-variant">API Access Keys</p>
                  <button className="text-primary font-label-caps text-label-caps text-[11px] flex items-center gap-1 hover:brightness-90 transition-all">
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    Generate New
                  </button>
                </div>
                <div className="space-y-2">
                  {["Trading_Bot_v1", "Analytics_Engine_Production"].map((key) => (
                    <div key={key} className="flex justify-between items-center p-3 border border-outline-variant rounded text-on-surface hover:bg-surface transition-colors">
                      <span className="font-data-mono text-data-mono">{key}</span>
                      <button className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:text-error transition-colors">delete</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SettingsSection>
        </div>

        {/* Right Column: Trading Logic & Preferences */}
        <div className="md:col-span-5 space-y-8">
          {/* Trading Logic Section */}
          <section className="bg-primary-container text-white p-6 rounded-lg shadow-lg hover:shadow-xl transition-all">
            <h2 className="font-headline-sm text-headline-sm flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined">settings_input_component</span>
              Trading Logic
            </h2>
            <div className="space-y-6">
              <div>
                <label className="font-label-caps text-label-caps text-on-primary-container block mb-2">Default Slippage Tolerance</label>
                <div className="grid grid-cols-4 gap-2">
                  {["0.1%", "0.5%", "1.0%"].map((val) => (
                    <button
                      key={val}
                      onClick={() => setSlippage(val)}
                      className={`py-2 rounded font-data-mono text-data-mono transition-colors ${
                        slippage === val ? "bg-on-primary-container text-primary-container font-bold" : "bg-primary border border-on-primary-container hover:bg-on-primary-container/20"
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                  <input
                    className="bg-transparent border border-on-primary-container rounded py-2 px-2 text-center text-data-mono placeholder:text-on-primary-container/50 focus:ring-1 focus:ring-white focus:outline-none"
                    placeholder="Custom"
                    type="text"
                  />
                </div>
              </div>
              <div>
                <label className="font-label-caps text-label-caps text-on-primary-container block mb-2">Fee Priority Level</label>
                <div className="relative">
                  <select className="w-full bg-primary border border-on-primary-container rounded py-3 px-4 text-body-md focus:ring-1 focus:ring-white focus:outline-none appearance-none cursor-pointer">
                    <option>Normal (Optimized Cost)</option>
                    <option selected>High (Fast Execution)</option>
                    <option>Frontrun (Immediate Settlement)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">expand_more</span>
                </div>
              </div>
              <div className="pt-4 border-t border-on-primary-container/30">
                <ToggleSwitch
                  label="Auto-Approve Transactions"
                  sublabel="Only for known market smart contracts."
                  checked={autoApprove}
                  onChange={() => setAutoApprove(!autoApprove)}
                />
              </div>
            </div>
          </section>

          {/* Notifications Section */}
          <SettingsSection title="Notifications" icon="notifications_active">
            <PushSettings />
          </SettingsSection>

          {/* AI Insights Prompt */}
          <div className="bg-[#f0f9fa] p-4 rounded border border-primary/20 flex gap-4 items-start shadow-sm">
            <span className="material-symbols-outlined text-primary mt-1">psychology</span>
            <p className="text-body-md italic text-on-primary-container">
              &quot;OracleDesk AI suggests your slippage is 0.2% higher than similar institutional profiles. Adjusting to 0.3% could lower your trading costs.&quot;
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
