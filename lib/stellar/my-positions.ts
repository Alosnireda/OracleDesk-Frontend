import { rpc } from "@stellar/stellar-sdk";
import { rpcServer } from "./clients";
import { priceYesBps, settleValue, type Settlement } from "./generated/fpmm";
import type { Market, Position } from "./generated/market-core";
import {
  chunks,
  isMarket,
  isPosition,
  marketLedgerKey,
  positionLedgerKey,
  readUdt,
  settlementOf,
  LEDGER_ENTRY_CHUNK_SIZE,
} from "./ledger-entries";

/**
 * The connected user's own positions, read straight from market-core ledger
 * entries (issue #50). Unlike the backend's /portfolio tables — which report
 * the agent's book — this scans Position UDTs owned by the wallet address and
 * values them with the market's own FPMM reserves, so /portfolio can show the
 * user what they personally hold on-chain.
 */

/** Same bound as redeem-all's scan: the newest market IDs are checked first. */
export const MAX_POSITION_SCAN_MARKETS = 20_000n;

export interface HolderPosition {
  marketId: bigint;
  yes: bigint;
  no: bigint;
  /** null when the market's ledger entry wasn't readable (archived/missing). */
  market: Market | null;
  /** null while the market is still open; settlement kind once final. */
  settlement: Settlement | null;
  /**
   * Value of the position in raw USDC (7 decimals, see lib/stellar/units.ts):
   * the settlement payout once the market is final, otherwise shares marked at
   * the live FPMM price. null when the market entry is unavailable, because
   * then there is no honest number to show.
   */
  valueRaw: bigint | null;
  /** Live YES price in bps; null when the market entry is unavailable. */
  yesBps: number | null;
  archived: boolean;
}

export interface PositionScan {
  positions: HolderPosition[];
  scannedMarkets: bigint;
  totalMarkets: bigint;
  scanLimited: boolean;
}

/**
 * FPMM spot price of YES in bps, clamped to [0, 10000]. The raw formula can
 * exceed 10_000 only through malformed reserves; a throwaway value there would
 * corrupt the whole portfolio view, so we clamp instead.
 */
export function yesPriceBps(market: Pick<Market, "reserve_yes" | "reserve_no">): bigint | null {
  const total = market.reserve_yes + market.reserve_no;
  if (total <= 0n) return null;
  const bps = priceYesBps(market.reserve_yes, market.reserve_no);
  if (bps < 0n) return 0n;
  if (bps > 10_000n) return 10_000n;
  return bps;
}

/**
 * Value one position: settled markets pay their settlement value
 * (losing side 0, void refunds half the pair), open markets are marked at the
 * live YES price. Returns null when the market entry is missing.
 */
export function positionValue(
  position: Pick<Position, "yes" | "no">,
  market: Market,
): { valueRaw: bigint; yesBps: number | null } | null {
  const settlement = settlementOf(market.status);
  if (settlement) return { valueRaw: settleValue(settlement, position.yes, position.no), yesBps: null };
  const bps = yesPriceBps(market);
  if (bps === null) return null;
  const valueRaw = (position.yes * bps + position.no * (10_000n - bps)) / 10_000n;
  return { valueRaw, yesBps: Number(bps) };
}

/**
 * Scans Position entries for `holder` across the newest `totalMarkets` market
 * IDs (chunked getLedgerEntries, same shape as redeem-all's discovery), then
 * reads each holding market's entry for pricing and settlement.
 */
export async function scanHolderPositions(
  holder: string,
  totalMarkets: bigint,
  server: rpc.Server = rpcServer(),
): Promise<PositionScan> {
  const scannedMarkets = totalMarkets > MAX_POSITION_SCAN_MARKETS ? MAX_POSITION_SCAN_MARKETS : totalMarkets;
  const startId = totalMarkets - scannedMarkets;
  const ids = Array.from({ length: Number(scannedMarkets) }, (_, index) => startId + BigInt(index));

  const found = new Map<bigint, Position>();
  for (const keyChunk of chunks(ids, LEDGER_ENTRY_CHUNK_SIZE)) {
    const keys = keyChunk.map((id) => ({ id, key: positionLedgerKey(id, holder) }));
    const response = await server.getLedgerEntries(...keys.map(({ key }) => key));
    const idByKey = new Map(keys.map(({ id, key }) => [key.toXDR("base64"), id]));
    for (const entry of response.entries) {
      const id = idByKey.get(entry.key.toXDR("base64"));
      if (id === undefined) continue;
      const position = readUdt<unknown>("Position", entry.val.contractData().val());
      if (!isPosition(position) || (position.yes === 0n && position.no === 0n)) continue;
      found.set(id, position);
    }
  }

  const markets = new Map<bigint, Market>();
  const archivedIds = new Map<bigint, boolean>();
  let latestLedger = 0;
  const holdingIds = [...found.keys()];
  for (const keyChunk of chunks(holdingIds, LEDGER_ENTRY_CHUNK_SIZE)) {
    const keys = keyChunk.map((id) => ({ id, key: marketLedgerKey(id) }));
    const response = await server.getLedgerEntries(...keys.map(({ key }) => key));
    latestLedger = Math.max(latestLedger, response.latestLedger);
    const idByKey = new Map(keys.map(({ id, key }) => [key.toXDR("base64"), id]));
    for (const entry of response.entries) {
      const id = idByKey.get(entry.key.toXDR("base64"));
      if (id === undefined) continue;
      const market = readUdt<unknown>("Market", entry.val.contractData().val());
      if (!isMarket(market)) continue;
      markets.set(id, market);
      archivedIds.set(id, entry.liveUntilLedgerSeq !== undefined && entry.liveUntilLedgerSeq < latestLedger);
    }
  }

  const positions: HolderPosition[] = [...found.entries()]
    .map(([marketId, position]) => {
      const market = markets.get(marketId) ?? null;
      const settlement = market ? settlementOf(market.status) : null;
      const valuation = market ? positionValue(position, market) : null;
      return {
        marketId,
        yes: position.yes,
        no: position.no,
        market,
        settlement,
        valueRaw: valuation?.valueRaw ?? null,
        yesBps: valuation?.yesBps ?? null,
        archived: archivedIds.get(marketId) ?? false,
      };
    })
    .sort((a, b) => (a.marketId < b.marketId ? 1 : a.marketId > b.marketId ? -1 : 0));

  return {
    positions,
    scannedMarkets,
    totalMarkets,
    scanLimited: totalMarkets > scannedMarkets,
  };
}

/**
 * The backend only knows about markets it created, keyed by their decimal
 * on-chain ID (lib/api/markets.ts). Join question text where it exists; ledger
 * rows stay useful without it (the UI falls back to "Market #<id>").
 */
export function withBackendQuestions(
  positions: readonly { marketId: bigint; question?: string | null }[],
  backend: readonly { onChainMarketId: string | null; question: string }[],
): { marketId: bigint; question: string | null }[] {
  const questions = new Map(backend.map((market) => [market.onChainMarketId, market.question]));
  return positions.map((position) => ({
    marketId: position.marketId,
    question: questions.get(position.marketId.toString()) ?? position.question ?? null,
  }));
}
