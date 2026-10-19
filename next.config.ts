import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The seven demo-only routes retired by issue #49. Their UI moved to
   * components/demo/ and renders only in the noindex design gallery at
   * /dev/gallery when NEXT_PUBLIC_ENABLE_DEMO_ROUTES is set; the old URLs go
   * to real destinations (see lib/demo/retired-routes.ts, which CI checks).
   */
  async redirects() {
    return [
      { source: "/wallet-demo", destination: "/portfolio/wallets", permanent: true },
      { source: "/buy-yes-demo", destination: "/markets", permanent: true },
      { source: "/buy-no-demo", destination: "/markets", permanent: true },
      { source: "/execution-terminal", destination: "/markets", permanent: true },
      { source: "/transaction-status", destination: "/tx", permanent: true },
      { source: "/transaction-success", destination: "/tx", permanent: true },
      { source: "/transaction-failed", destination: "/tx", permanent: true },
    ];
  },
};

export default nextConfig;
