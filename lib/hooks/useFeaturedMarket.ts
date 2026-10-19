"use client";

import { useMarkets } from "./useMarkets";
import { pickFeaturedMarket } from "@/lib/markets/featured";

/** The market the home-page hero highlights: the most liquid ACTIVE market
 * from the markets feed. */
export function useFeaturedMarket() {
  const query = useMarkets({ limit: 12 });
  const markets = query.data?.markets ?? [];
  return {
    market: pickFeaturedMarket(markets),
    isLoading: query.isLoading,
  };
}
