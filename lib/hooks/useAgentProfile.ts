import { useState, useEffect } from "react";
import { listTraces } from "@/lib/api/traces";
import { AgentProfile, createEmptyProfile, buildAgentProfile } from "@/lib/services/agent-profile";

export function useAgentProfile(agentAddress: string) {
  const [profile, setProfile] = useState<AgentProfile>(() => createEmptyProfile(agentAddress));
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

        const filledProfile = buildAgentProfile(agentAddress, true, agentTraces, [], []);
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

  return { profile, isLoading, error };
}
