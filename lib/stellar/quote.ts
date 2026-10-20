import type { Market } from "./generated/market-core";
import { BPS, calcBuy, MAX_SETS, MathError, priceYesBps } from "./generated/fpmm";
import type { OutcomeTag } from "./clients";
import { probabilityToBps, shareOf } from "./units";

export type ExactBuy =
  | { ok: true; collateralIn: bigint; sharesOut: bigint; overshoot: bigint; fee: bigint; net: bigint }
  | { ok: false; reason: "invalid-target" | "market-too-large" | "overflow" };

/**
 * calcBuy's output is monotone: fee and net never decrease as collateralIn
 * grows; newReserveOther grows with net, so the ceiling-rounded new bought
 * reserve cannot increase. Thus net + reserveBought - newReserveBought cannot
 * decrease.
 */
export function minCollateralForShares(
  market: Pick<Market, "reserve_yes" | "reserve_no" | "fee_bps" | "sets_minted">,
  outcome: OutcomeTag,
  targetShares: bigint,
): ExactBuy {
  if (targetShares <= 0n) return { ok: false, reason: "invalid-target" };
  if (targetShares > MAX_SETS) return { ok: false, reason: "market-too-large" };

  const [rBought, rOther] =
    outcome === "Yes" ? [market.reserve_yes, market.reserve_no] : [market.reserve_no, market.reserve_yes];
  const feeBps = BigInt(market.fee_bps);
  const headroom = MAX_SETS - market.sets_minted;
  if (rBought <= 0n || rOther <= 0n || feeBps < 0n || feeBps >= BPS || headroom <= 0n) {
    return { ok: false, reason: "market-too-large" };
  }

  const maxCollateralIn = (headroom * BPS) / (BPS - feeBps);
  if (maxCollateralIn <= 0n) return { ok: false, reason: "market-too-large" };

  const sharesAt = (amount: bigint) => {
    try {
      return calcBuy(rBought, rOther, amount, feeBps).sharesOut;
    } catch (error) {
      if (error instanceof MathError) return 0n;
      throw error;
    }
  };

  if (sharesAt(maxCollateralIn) < targetShares) return { ok: false, reason: "market-too-large" };

  let low = 0n;
  let high = maxCollateralIn;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (sharesAt(mid) >= targetShares) high = mid;
    else low = mid;
  }

  try {
    const quote = calcBuy(rBought, rOther, high, feeBps);
    if (market.sets_minted + quote.net > MAX_SETS) return { ok: false, reason: "market-too-large" };
    return {
      ok: true,
      collateralIn: high,
      sharesOut: quote.sharesOut,
      overshoot: quote.sharesOut - targetShares,
      fee: quote.fee,
      net: quote.net,
    };
  } catch (error) {
    if (error instanceof MathError) return { ok: false, reason: "overflow" };
    throw error;
  }
}

export interface CopyMarket {
  reserveYes: bigint;
  reserveNo: bigint;
  feeBps: bigint;
  setsMinted: bigint;
}

export interface CopyQuote {
  collateralIn: bigint;
  sharesOut: bigint;
  fee: bigint;
  /** What each share cost, fee included, rounded up (against the buyer). */
  avgPriceBps: bigint;
  priceBeforeBps: bigint;
  /** Marginal price of the bought side after this trade. */
  priceAfterBps: bigint;
  /** The agent's estimate for the side minus the average price paid. Zero or negative means no edge is left. */
  edgeAfterBps: bigint;
}

const sideBps = (side: OutcomeTag, yesBps: bigint) => (side === "Yes" ? yesBps : BPS - yesBps);

/**
 * Exact copy-trade quote on the current reserves, computed locally with the
 * contract's own calcBuy. `estimateYesBps` is the agent's YES probability.
 * Throws MathError when the amount can't buy any shares.
 */
export function quoteCopy(market: CopyMarket, side: OutcomeTag, collateralIn: bigint, estimateYesBps: bigint): CopyQuote {
  const [rBought, rOther] = side === "Yes" ? [market.reserveYes, market.reserveNo] : [market.reserveNo, market.reserveYes];
  const quote = calcBuy(rBought, rOther, collateralIn, market.feeBps);
  if (market.setsMinted + quote.net > MAX_SETS) throw new MathError("market too large");

  const newYes = side === "Yes" ? quote.newReserveBought : quote.newReserveOther;
  const newNo = side === "Yes" ? quote.newReserveOther : quote.newReserveBought;
  const avgPriceBps = (collateralIn * BPS + quote.sharesOut - 1n) / quote.sharesOut;
  return {
    collateralIn,
    sharesOut: quote.sharesOut,
    fee: quote.fee,
    avgPriceBps,
    priceBeforeBps: sideBps(side, priceYesBps(market.reserveYes, market.reserveNo)),
    priceAfterBps: sideBps(side, priceYesBps(newYes, newNo)),
    edgeAfterBps: sideBps(side, estimateYesBps) - avgPriceBps,
  };
}

/**
 * The largest collateral in [0, upper] whose remaining edge is still at least
 * `minEdgeBps`. Average price rises with size, so the edge falls and a binary
 * search finds the boundary. Returns 0 when even one base unit fails.
 */
export function maxCollateralForEdge(
  market: CopyMarket,
  side: OutcomeTag,
  estimateYesBps: bigint,
  minEdgeBps: bigint,
  upper: bigint,
): bigint {
  const passes = (amount: bigint): boolean => {
    try {
      return quoteCopy(market, side, amount, estimateYesBps).edgeAfterBps >= minEdgeBps;
    } catch (error) {
      if (error instanceof MathError) return false;
      throw error;
    }
  };
  if (upper <= 0n) return 0n;
  if (passes(upper)) return upper;

  // Near dust, integer rounding in calcBuy dominates, so the edge isn't
  // monotone there. Step down a log grid from the top to the first amount that
  // passes, then bisect up to its failing neighbour, where the edge is monotone.
  let failing = upper;
  for (let amount = upper / 2n; amount > 0n; amount /= 2n) {
    if (!passes(amount)) {
      failing = amount;
      continue;
    }
    let low = amount;
    let high = failing;
    while (high - low > 1n) {
      const mid = (low + high) / 2n;
      if (passes(mid)) low = mid;
      else high = mid;
    }
    return low;
  }
  return 0n;
}

/** How the copy amount is chosen. Mirror uses the agent's own bet fraction from the trace. */
export type SizingMode =
  | { kind: "fixed"; amount: bigint }
  | { kind: "percent"; bps: number | bigint }
  | { kind: "mirror"; betFraction: number | null | undefined };

export interface SizingChoice {
  amount: bigint;
  /** What bounded the amount: the wallet balance, the user's cap, or nothing. */
  limitedBy: "balance" | "cap" | "none";
  /** Why the mode can't be used right now (for example a locked trace). */
  unavailable?: string;
}

/**
 * The one place a copy amount is bounded. The result is never above the
 * wallet balance or the user's cap, and is never negative.
 */
export function chooseCollateral(mode: SizingMode, input: { balance: bigint; userCap: bigint | null }): SizingChoice {
  const balance = input.balance > 0n ? input.balance : 0n;
  const cap = input.userCap !== null && input.userCap >= 0n ? input.userCap : null;

  let wanted: bigint;
  switch (mode.kind) {
    case "fixed":
      wanted = mode.amount;
      break;
    case "percent": {
      const bps = BigInt(mode.bps);
      wanted = shareOf(balance, bps < 0n ? 0n : bps > BPS ? BPS : bps);
      break;
    }
    case "mirror": {
      const fraction = mode.betFraction;
      if (fraction === null || fraction === undefined || !(fraction > 0 && fraction <= 1)) {
        return { amount: 0n, limitedBy: "none", unavailable: "Unlock the trace to mirror the agent's size." };
      }
      wanted = shareOf(balance, probabilityToBps(fraction));
      break;
    }
  }

  if (wanted <= 0n) return { amount: 0n, limitedBy: "none" };
  let amount = wanted;
  let limitedBy: SizingChoice["limitedBy"] = "none";
  if (amount > balance) {
    amount = balance;
    limitedBy = "balance";
  }
  if (cap !== null && amount > cap) {
    amount = cap;
    limitedBy = "cap";
  }
  return { amount, limitedBy };
}
