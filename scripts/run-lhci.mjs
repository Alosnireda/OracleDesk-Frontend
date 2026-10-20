#!/usr/bin/env node

/**
 * Runner script that orchestrates mock backend, production next server,
 * and Lighthouse CI evaluation.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        })
        .on("error", retry);
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
      } else {
        setTimeout(check, 400);
      }
    };

    check();
  });
}

async function main() {
  console.log("🚀 Starting Lighthouse CI orchestrator...");

  // 1. Start mock server on 8787
  console.log("📦 Launching perf mock server on port 8787...");
  const mockServer = spawn("node", ["e2e/perf/mock-server.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PORT: "8787" },
  });

  // 2. Start Next.js production server on 3000
  console.log("⚡ Launching Next.js server on port 3000...");
  const nextServer = spawn("npx", ["next", "start", "-p", "3000"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "3000",
      NEXT_PUBLIC_API_URL: "http://localhost:8787",
      NEXT_PUBLIC_STELLAR_RPC_URL: "http://localhost:8787/rpc",
    },
  });

  const cleanup = () => {
    console.log("🧹 Stopping child servers...");
    mockServer.kill("SIGTERM");
    nextServer.kill("SIGTERM");
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    await waitForUrl("http://localhost:8787/health", 15000);
    console.log("✅ Mock server is ready.");

    await waitForUrl("http://localhost:3000/", 30000);
    console.log("✅ Next.js production server is ready.");

    console.log("🔍 Executing Lighthouse CI autorun...");
    const lhci = spawn("npx", ["lhci", "autorun"], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });

    const exitCode = await new Promise((resolve) => {
      lhci.on("close", resolve);
    });

    cleanup();

    if (exitCode !== 0) {
      console.error(`❌ Lighthouse CI failed with exit code ${exitCode}`);
      process.exit(exitCode || 1);
    } else {
      console.log("🎉 Lighthouse CI assertions passed successfully!");
      process.exit(0);
    }
  } catch (err) {
    cleanup();
    console.error("❌ Orchestration error:", err);
    process.exit(1);
  }
}

main();
