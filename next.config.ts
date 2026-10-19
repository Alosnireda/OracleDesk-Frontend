import type { NextConfig } from "next";

/**
 * One id per build: used as Next's BUILD_ID, the service worker cache
 * namespace (/sw.js?v=…) and the precache file name. CI can pin it with
 * BUILD_ID (e.g. the commit sha); otherwise a timestamp keeps builds distinct.
 */
const buildId = (process.env.BUILD_ID || process.env.NEXT_PUBLIC_BUILD_SHA || `b${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_-]/g, "");

const nextConfig: NextConfig = {
  generateBuildId: async () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async headers() {
    return [
      {
        // The worker must always be revalidated so updates are noticed.
        // If a CSP is introduced, it must include `worker-src 'self'`.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
