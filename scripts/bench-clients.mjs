#!/usr/bin/env node
/**
 * Measures the client-construction and quote-building cost before/after the
 * shared client cache.
 *
 * "Before" mirrors the old call-site pattern: every operation constructed a
 * generated Client, which re-decodes every base64 spec entry. "After" uses the
 * memoised factory (and the base-client path used for signer-bound clients),
 * where the spec is parsed once.
 *
 * Run with `npm run bench:clients` (add `-- --n 200` for more samples).
 * No network calls: the shared RPC server's simulation is stubbed.
 */
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
import { Client as BaseContractClient } from "@stellar/stellar-sdk/contract";
import { nativeToScVal, SorobanDataBuilder } from "@stellar/stellar-sdk";

const args = process.argv.slice(2);
const nIndex = args.indexOf("--n");
const ITERATIONS = Math.max(5, Number(nIndex >= 0 ? args[nIndex + 1] : process.env.BENCH_N ?? 100));

const app = await createServer({
  appType: "custom",
  logLevel: "error",
  resolve: { alias: { "@": process.cwd() } },
  server: { middlewareMode: true },
});

const format = (ms) => `${ms.toFixed(2)} ms`;
const per = (ms, count) => `${((ms / count) * 1000).toFixed(1)} µs/op`;
const speedup = (before, after) => (after === 0 ? "n/a" : `${(before / after).toFixed(1)}×`);

function parsedSimulation(value) {
  return {
    _parsed: true,
    id: "bench",
    latestLedger: 1,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "0",
    result: { auth: [], retval: nativeToScVal(value, { type: "i128" }) },
    events: [],
  };
}

function stubServer(server) {
  if (!server) throw new Error("client did not receive the shared rpc.Server");
  server.getAccount = async () => {
    throw new Error("benchmark quote should not fetch an account for a read-only client");
  };
  server.simulateTransaction = async () => parsedSimulation(5_000_000n);
}

async function timeAsync(fn, iterations) {
  // Warm up JIT and any lazy module loading.
  await fn();
  await fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  return performance.now() - start;
}

try {
  const { __resetClientCaches, marketCore, options } = await app.ssrLoadModule("/lib/stellar/clients.ts");
  const { CONTRACTS } = await app.ssrLoadModule("/lib/stellar/config.ts");
  const { Client: GeneratedMarketClient } = await app.ssrLoadModule("/lib/stellar/generated/market-core.ts");

  __resetClientCaches();

  const coldStart = performance.now();
  const spec = marketCore().spec;
  const coldMs = performance.now() - coldStart;

  const opts = options(CONTRACTS.marketCore);
  stubServer(opts.server);
  const args = { market_id: 1n, outcome: { tag: "Yes", values: undefined }, collateral_in: 1_000_000n };

  // Construction throughput: each generated constructor decodes the whole spec.
  const beforeStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) new GeneratedMarketClient(options(CONTRACTS.marketCore));
  const beforeCtor = performance.now() - beforeStart;

  const afterStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) marketCore();
  const afterCtor = performance.now() - afterStart;

  const boundStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) new BaseContractClient(spec, options(CONTRACTS.marketCore));
  const boundCtor = performance.now() - boundStart;

  // Quote building: before includes a fresh spec decode on every quote.
  const quoteBefore = await timeAsync(async () => {
    const client = new GeneratedMarketClient(options(CONTRACTS.marketCore));
    stubServer(client.options.server);
    await client.quote_buy(args);
  }, ITERATIONS);
  const quoteAfter = await timeAsync(async () => {
    await marketCore().quote_buy(args);
  }, ITERATIONS);

  console.log(`OracleDesk client benchmark (${ITERATIONS} iterations, Node ${process.version})`);
  console.log("");
  console.log("Cold start");
  console.log(`  first marketCore() (spec parse + client)   ${format(coldMs)}`);
  console.log("");
  console.log("Client construction");
  console.log(`  before  new GeneratedClient() each call    ${format(beforeCtor)}  ${per(beforeCtor, ITERATIONS)}`);
  console.log(`  after   marketCore() warm cache            ${format(afterCtor)}  ${per(afterCtor, ITERATIONS)}  ${speedup(beforeCtor, afterCtor)} faster`);
  console.log(`  after   base Client from cached spec       ${format(boundCtor)}  ${per(boundCtor, ITERATIONS)}  ${speedup(beforeCtor, boundCtor)} faster`);
  console.log("");
  console.log("Quote build + simulated read");
  console.log(`  before  construct + quote_buy              ${format(quoteBefore)}  ${per(quoteBefore, ITERATIONS)}`);
  console.log(`  after   cached client + quote_buy          ${format(quoteAfter)}  ${per(quoteAfter, ITERATIONS)}  ${speedup(quoteBefore, quoteAfter)} faster`);
} finally {
  await app.close();
}
