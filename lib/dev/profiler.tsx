"use client";

import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";

/**
 * The Profiler is a development-only tool. In production it is a no-op, so it
 * costs nothing in the shipped bundle.
 */
const enabled = process.env.NODE_ENV !== "production";

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  if (!enabled) return;
  // eslint-disable-next-line no-console
  console.info(
    `[wallet-profile] ${id} ${phase} actual=${actualDuration.toFixed(2)}ms base=${baseDuration.toFixed(2)}ms`,
  );
};

/**
 * Wraps a subtree in React's Profiler and logs every commit.
 *
 * Used to measure the wallet-context and buy-ticket renders; see
 * `docs/perf/wallet-context.md` for the procedure and the numbers.
 */
export function DevProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
