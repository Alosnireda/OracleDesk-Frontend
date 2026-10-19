"use client";

import React from "react";
import Link from "next/link";
import { AgentProfile } from "@/lib/services/agent-profile";

interface AgentProfileCardProps {
  profile: AgentProfile;
}

export function AgentProfileCard({ profile }: AgentProfileCardProps) {
  const metricsData = [
    {
      label: "Total Traces",
      value: profile.metrics.totalTraces,
      icon: "analytics",
    },
    {
      label: "Markets Created",
      value: profile.metrics.totalMarketsCreated,
      icon: "store",
    },
    {
      label: "Total Trades",
      value: profile.metrics.totalTrades,
      icon: "trending_up",
    },
    {
      label: "Win Rate",
      value: profile.metrics.winRate ? `${(profile.metrics.winRate * 100).toFixed(1)}%` : "N/A",
      icon: "check_circle",
    },
    {
      label: "Avg Confidence",
      value: `${(profile.metrics.averageConfidence * 100).toFixed(1)}%`,
      icon: "verified",
    },
    {
      label: "Avg Edge",
      value: `${(profile.metrics.averageEdge * 100).toFixed(2)}%`,
      icon: "trending_up",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 border border-outline-variant rounded-lg bg-surface-container-low">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-headline-md text-headline-md text-on-surface mb-1">Agent Profile</h1>
            <p className="font-data-mono text-on-surface-variant text-sm break-all">
              {profile.agentAddress}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={`px-3 py-1 rounded font-label-caps text-label-caps text-xs ${
                profile.registered
                  ? "bg-secondary/20 text-secondary"
                  : "bg-on-surface-variant/20 text-on-surface-variant"
              }`}
            >
              {profile.registered ? "✓ Registered" : "Unregistered"}
            </span>
            <span className="text-on-surface-variant text-xs">
              Last active: {profile.metrics.lastActivityAt
                ? new Date(profile.metrics.lastActivityAt).toLocaleDateString()
                : "N/A"}
            </span>
          </div>
        </div>

        <div className="p-3 bg-surface rounded border border-outline-variant/50 text-on-surface-variant text-xs">
          <p className="flex items-start gap-2">
            <span className="material-symbols-outlined text-sm mt-0.5">info</span>
            <span>{profile.eventWindowSize.note}</span>
          </p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metricsData.map((metric, idx) => (
          <div key={idx} className="p-4 border border-outline-variant rounded-lg bg-surface-container-low">
            <div className="flex items-center justify-between mb-3">
              <span className="font-label-caps text-label-caps text-on-surface-variant text-xs">
                {metric.label}
              </span>
              <span className="material-symbols-outlined text-on-surface-variant text-lg">
                {metric.icon}
              </span>
            </div>
            <div className="font-headline-sm text-headline-sm text-on-surface">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      {/* Capital Deployed */}
      <div className="p-6 border border-outline-variant rounded-lg bg-surface-container-low">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined">account_balance</span>
          Capital Deployed
        </h3>
        <div className="font-display-sm text-display-sm text-primary">
          {profile.metrics.totalCapitalDeployed.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          <span className="text-on-surface-variant text-sm ml-2">USDC</span>
        </div>
      </div>

      {/* Recent Activity */}
      {profile.traces.length > 0 && (
        <div className="p-6 border border-outline-variant rounded-lg bg-surface-container-low">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined">history</span>
              Recent Reasoning Traces
            </span>
            <Link
              href={`/agent/${encodeURIComponent(profile.agentAddress)}/traces`}
              className="text-primary text-xs hover:underline"
            >
              View All
            </Link>
          </h3>

          <div className="space-y-3">
            {profile.traces.slice(0, 5).map((trace) => (
              <div key={trace.id} className="p-3 bg-surface rounded flex items-start justify-between gap-3">
                <div>
                  <p className="font-label-caps text-label-caps text-on-surface text-sm mb-1">
                    {trace.market?.question || "Market Analysis"}
                  </p>
                  <p className="text-on-surface-variant text-xs font-data-mono">
                    {new Date(trace.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-data-mono text-on-surface text-sm font-bold">
                    {(trace.probabilityEstimate * 100).toFixed(1)}%
                  </div>
                  <span
                    className={`text-xs font-label-caps ${
                      trace.verified ? "text-secondary" : "text-on-surface-variant"
                    }`}
                  >
                    {trace.verified ? "Verified" : "Unverified"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
