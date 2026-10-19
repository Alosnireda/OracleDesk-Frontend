export interface WebVitalMetric {
  id: string;
  name: "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB" | string;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  delta?: number;
  navigationType?: string;
}

export interface SanitizedVitalPayload {
  id: string;
  name: string;
  value: number;
  rating?: string;
  delta?: number;
  path: string;
  timestamp: number;
}

/**
 * Remove any query params, hashes, and addresses/tokens from path.
 * Stellar addresses (G...) and 0x hex addresses are replaced with :id.
 */
export function sanitizePath(rawUrlOrPath: string): string {
  try {
    const url = new URL(rawUrlOrPath, "https://oracledesk.io");
    const pathname = url.pathname;
    const sanitized = pathname
      .replace(/\/G[0-9A-Z]{55}/g, "/:address")
      .replace(/\/0x[0-9a-fA-F]{40,64}/g, "/:address")
      .replace(/\/[0-9a-fA-F]{64}/g, "/:hash");
    return sanitized;
  } catch {
    return "/";
  }
}

/**
 * Determine if current metric report should be sampled (default 10%).
 */
export function shouldSample(rate: number = 0.1, prng: () => number = Math.random): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return prng() < rate;
}

/**
 * Dispatch metric to telemetry endpoint via navigator.sendBeacon or fetch keepalive.
 */
export function sendVitals(
  metric: WebVitalMetric,
  opts?: {
    endpoint?: string;
    sampleRate?: number;
    pathname?: string;
    isDev?: boolean;
    prng?: () => number;
  }
): boolean {
  const isDev = opts?.isDev ?? process.env.NODE_ENV === "development";
  const endpoint = opts?.endpoint ?? process.env.NEXT_PUBLIC_VITALS_URL ?? "/api/v1/telemetry/vitals";
  const pathname = opts?.pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const sampleRate = opts?.sampleRate ?? 0.1;

  if (isDev) {
    // Log to console in development
    console.debug(`[Web-Vitals] ${metric.name}: ${Math.round(metric.value)}ms (${metric.rating ?? "unrated"})`);
    return true;
  }

  // 10% sampling in production
  if (!shouldSample(sampleRate, opts?.prng)) {
    return false;
  }

  const payload: SanitizedVitalPayload = {
    id: metric.id,
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    path: sanitizePath(pathname),
    timestamp: Date.now(),
  };

  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      return navigator.sendBeacon(endpoint, blob);
    } catch {
      // Fallback to fetch if sendBeacon throws
    }
  }

  if (typeof fetch === "function") {
    void fetch(endpoint, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {
      // Discard network errors on telemetry
    });
    return true;
  }

  return false;
}
