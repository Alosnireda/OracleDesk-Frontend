import type { Market, MarketCategory } from "@/lib/api/markets";

const CATEGORIES: MarketCategory[] = [
  "CRYPTO",
  "FED",
  "ECB",
  "MACRO",
  "ELECTION",
  "POLITICS",
  "GEOPOLITICAL",
  "SPORTS",
  "ENTERTAINMENT",
];

/**
 * Deterministic PRNG for reproducible test fixtures
 */
function sfc32(a: number, b: number, c: number, d: number) {
  return function () {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function generateSyntheticMarkets(count = 2000): Market[] {
  const prng = sfc32(1337, 42, 888, 9999);
  const markets: Market[] = [];

  for (let i = 0; i < count; i++) {
    const catIndex = Math.floor(prng() * CATEGORIES.length);
    const category = CATEGORIES[catIndex];
    const yesProb = Math.round((0.1 + prng() * 0.8) * 100) / 100;
    const edge = Math.round((prng() * 0.2 - 0.1) * 100) / 100;

    markets.push({
      id: `synthetic-${i + 1}`,
      question: `Will synthetic event #${i + 1} resolve positively before end of quarter?`,
      category,
      contractCategory: "Crypto",
      status: "ACTIVE",
      settlementCurrency: "USDC",
      initialYesProb: yesProb,
      currentYesProb: yesProb,
      confidenceInterval: { lower: Math.max(0, yesProb - 0.05), upper: Math.min(1, yesProb + 0.05) },
      totalLiquidity: Math.round(5000 + prng() * 500000),
      expiryTimestamp: new Date(Date.now() + 86400000 * (10 + (i % 60))).toISOString(),
      onChainMarketId: null, // Critical: no RPC calls generated
      creationTxHash: null,
      seedAmountRaw: "100000000",
      questionHash: null,
      metaUri: null,
      resolutionHash: null,
      resolutionSpec: null,
      createdAt: new Date(Date.now() - 86400000 * (i % 30)).toISOString(),
      reasoningTraces: [
        {
          id: `trace-synth-${i + 1}`,
          agentType: "MARKET_MAKER",
          edge,
          probabilityEstimate: yesProb,
          verified: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }

  return markets;
}
