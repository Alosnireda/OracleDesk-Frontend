import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    // The offline x402 contract suite has its own config (vitest.x402.config.mts).
    exclude: [...configDefaults.exclude, "e2e/x402/**"],
    testTimeout: 60_000,
  },
});
