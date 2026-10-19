import type { Market } from "@/lib/api/markets";

/** Live YES probability in 0–1: the backend's current estimate, falling back
 * to the market's seeded probability while the first estimate is pending. */
export function yesProb(market: Pick<Market, "currentYesProb" | "initialYesProb">): number {
  return market.currentYesProb ?? market.initialYesProb;
}

/** The hero market: the most liquid ACTIVE market. Deterministic — same list,
 * same market — so the hero can never flap between renders. */
export function pickFeaturedMarket(markets: readonly Market[]): Market | null {
  let best: Market | null = null;
  for (const market of markets) {
    if (market.status !== "ACTIVE") continue;
    if (!best) { best = market; continue; }
    if (market.totalLiquidity > best.totalLiquidity) best = market;
    else if (market.totalLiquidity === best.totalLiquidity && market.id < best.id) best = market;
  }
  return best;
}

/** "$14.1K" for four-digit-and-up liquidity, plain dollars below that. */
export function formatLiquidity(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "—";
  return usd >= 1_000 ? `$${(usd / 1_000).toFixed(1)}K` : `$${usd.toFixed(0)}`;
}
