import type { Market } from "@/lib/api/markets";
import { yesProb } from "./featured";

/** One ticker line per market: "QUESTION HEADLINE…: 64%". */
export function tickerItem(market: Market): string {
  const prob = Math.round(yesProb(market) * 100);
  return `${market.question.substring(0, 30).toUpperCase()}: ${prob}%`;
}

/** Ticker contents; an honest empty state instead of invented items. */
export function tickerItems(markets: readonly Market[]): string[] {
  return markets.length ? markets.map(tickerItem) : ["NO LIVE MARKETS YET"];
}
