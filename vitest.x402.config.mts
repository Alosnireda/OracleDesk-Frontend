import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Offline x402 contract tests against the pinned contracts service (e2e/x402). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e/x402/**/*.e2e.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
