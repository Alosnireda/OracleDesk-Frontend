import type { ReasoningTrace } from "@/lib/api/traces";

/** Flatten infinite-query pages into one feed, dropping duplicate ids (a live
 * feed re-serving the head of page 1 across refreshes). */
export function mergeTracePages(pages: readonly (readonly ReasoningTrace[])[]): ReasoningTrace[] {
  const seen = new Set<string>();
  const merged: ReasoningTrace[] = [];
  for (const page of pages) {
    for (const trace of page) {
      if (seen.has(trace.id)) continue;
      seen.add(trace.id);
      merged.push(trace);
    }
  }
  return merged;
}

/** Ids that fell off the newest-first head between refetches — the traces a
 * user was just looking at that are now gone. */
export function diffHead(previous: readonly ReasoningTrace[], current: readonly ReasoningTrace[]): string[] {
  const currentIds = new Set(current.map((trace) => trace.id));
  return previous.filter((trace) => !currentIds.has(trace.id)).map((trace) => trace.id);
}
