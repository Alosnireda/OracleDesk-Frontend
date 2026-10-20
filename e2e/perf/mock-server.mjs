#!/usr/bin/env node

/**
 * Lightweight mock server providing backend APIs and Soroban JSON-RPC
 * for local and CI Lighthouse runs without live external network dependencies.
 */

import http from "node:http";

const PORT = parseInt(process.env.PORT || "8787", 10);

const MOCK_MARKETS = [
  {
    id: "mkt-1",
    question: "Will the Federal Reserve cut interest rates in Q3 2026?",
    category: "FED",
    contractCategory: "Macro",
    status: "ACTIVE",
    settlementCurrency: "USDC",
    initialYesProb: 0.65,
    currentYesProb: 0.68,
    confidenceInterval: { lower: 0.62, upper: 0.74 },
    totalLiquidity: 154200,
    expiryTimestamp: new Date(Date.now() + 86400000 * 30).toISOString(),
    onChainMarketId: "1",
    creationTxHash: "tx-mock-create-1",
    seedAmountRaw: "100000000",
    questionHash: null,
    metaUri: "ipfs://bafybeimockmarket1",
    resolutionHash: null,
    resolutionSpec: null,
    createdAt: new Date().toISOString(),
    reasoningTraces: [
      {
        id: "tr-1",
        agentType: "MARKET_MAKER",
        edge: 0.08,
        probabilityEstimate: 0.68,
        verified: true,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: "mkt-2",
    question: "Will Bitcoin exceed $120,000 before the end of 2026?",
    category: "CRYPTO",
    contractCategory: "Crypto",
    status: "ACTIVE",
    settlementCurrency: "USDC",
    initialYesProb: 0.42,
    currentYesProb: 0.45,
    confidenceInterval: { lower: 0.38, upper: 0.52 },
    totalLiquidity: 420000,
    expiryTimestamp: new Date(Date.now() + 86400000 * 60).toISOString(),
    onChainMarketId: "2",
    creationTxHash: "tx-mock-create-2",
    seedAmountRaw: "200000000",
    questionHash: null,
    metaUri: "ipfs://bafybeimockmarket2",
    resolutionHash: null,
    resolutionSpec: null,
    createdAt: new Date().toISOString(),
    reasoningTraces: [
      {
        id: "tr-2",
        agentType: "TRADER",
        edge: 0.12,
        probabilityEstimate: 0.45,
        verified: true,
        createdAt: new Date().toISOString(),
      },
    ],
  },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health
  if (url.pathname === "/health" || url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", timestamp: Date.now() }));
    return;
  }

  // Telemetry endpoint
  if (url.pathname === "/api/v1/telemetry/vitals") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "recorded" }));
    return;
  }

  // Markets list
  if (url.pathname === "/api/v1/markets" || url.pathname === "/markets") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        markets: MOCK_MARKETS,
        meta: {
          page: 1,
          limit: 24,
          total: MOCK_MARKETS.length,
          totalPages: 1,
        },
      })
    );
    return;
  }

  // Market detail by on-chain id
  if (url.pathname.startsWith("/api/v1/markets/on-chain/")) {
    const onChainId = url.pathname.split("/").pop();
    const market = MOCK_MARKETS.find((m) => m.onChainMarketId === onChainId) || MOCK_MARKETS[0];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(market));
    return;
  }

  // Market detail by id
  if (url.pathname.startsWith("/api/v1/markets/")) {
    const id = url.pathname.split("/").pop();
    const market = MOCK_MARKETS.find((m) => m.id === id) || MOCK_MARKETS[0];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(market));
    return;
  }

  // JSON-RPC for Soroban RPC
  if (url.pathname === "/rpc" || url.pathname === "/soroban/rpc") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const parsed = JSON.parse(body || "{}");
      const id = parsed.id || 1;
      const method = parsed.method;

      let result = {};

      if (method === "getNetwork") {
        result = {
          passphrase: "Test SDF Network ; September 2015",
          protocolVersion: 21,
        };
      } else if (method === "getLatestLedger") {
        result = {
          sequence: 1250000,
          id: "68379204782947192837",
          closeTime: Math.floor(Date.now() / 1000),
        };
      } else if (method === "getHealth") {
        result = {
          status: "healthy",
          latestLedger: 1250000,
          oldestLedger: 1200000,
          ledgerRetentionWindow: 50000,
        };
      } else if (method === "getEvents") {
        result = {
          events: [],
          latestLedger: 1250000,
        };
      } else if (method === "getLedgerEntries") {
        result = {
          entries: [],
          latestLedger: 1250000,
        };
      } else if (method === "simulateTransaction") {
        result = {
          minResourceFee: "100",
          latestLedger: 1250000,
          result: { retval: "AAAAAA==" },
        };
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      return;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON-RPC request" }));
      return;
    }
  }

  // Fallback 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
});

server.listen(PORT, () => {
  console.log(`[MockServer] Perf mock server running at http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
