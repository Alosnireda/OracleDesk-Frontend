"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AgentProfileCard } from "@/components/agent-profile-card";
import { createEmptyProfile, buildAgentProfile } from "@/lib/services/agent-profile";
import { listTraces } from "@/lib/api/traces";

export default function AgentProfilePage() {
  const params = useParams();
  const agentAddress = decodeURIComponent(params.address as string);

  const [profile, setProfile] = useState(() => createEmptyProfile(agentAddress));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAgentProfile() {
      try {
        setIsLoading(true);
        setError(null);

        const { traces } = await listTraces();

        const agentTraces = traces.filter(
          (t) => t.onChainTraceId === agentAddress || t.agentType,
        );

        if (agentTraces.length === 0) {
          setError("No traces found for this agent.");
          const emptyProfile = createEmptyProfile(agentAddress);
          setProfile(emptyProfile);
          return;
        }

        const filledProfile = buildAgentProfile(
          agentAddress,
          true,
          agentTraces,
          [],
          [],
        );

        setProfile(filledProfile);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agent profile.");
        console.error("Agent profile error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadAgentProfile();
  }, [agentAddress]);

  return (
    <main className="pt-24 pb-12 px-gutter max-w-container-max-width mx-auto">
      <div className="mb-8">
        <Link
          href="/reasoning"
          className="flex items-center gap-2 text-primary hover:underline mb-4 font-label-caps text-label-caps"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to Reasoning Feed
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-40 bg-surface-container-low animate-pulse rounded-lg border border-outline-variant"
            />
          ))}
        </div>
      ) : error && profile.traces.length === 0 ? (
        <div className="p-12 text-center bg-surface-container-low rounded-xl border border-outline-variant">
          <span className="material-symbols-outlined text-error text-4xl mb-4 block">
            info
          </span>
          <p className="text-on-surface-variant">{error}</p>
        </div>
      ) : (
        <AgentProfileCard profile={profile} />
      )}
    </main>
  );
}
