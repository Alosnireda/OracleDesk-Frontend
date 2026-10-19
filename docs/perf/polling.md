# Polling & Invalidation Architecture

## Overview
OracleDesk replaces independent polling timers with a single shared ledger heartbeat and event-driven invalidation model powered by Soroban `getEvents`.

Prior to this architecture, individual components polled independently:
- `/markets/quick-view` polled `useOnChainMarket` (10s) and `useUsdcBalance` (15s).
- `/markets` polled `useMarkets` (60s).
- `/portfolio` polled `usePortfolio` (15s).
- `/reasoning` polled `useTraces` (30s).

Multiple open tabs compounded RPC rate-limits and kept client CPUs awake even when ledgers had not changed.

---

## 1. Shared Ledger Clock (`lib/stellar/ledger-clock.ts`)
- **Singleton Heartbeat**: Instead of N intervals, a single `LedgerClock` instance polls `rpc.getLatestLedger()` roughly every 5 seconds.
- **Visibility-Aware Polling**:
  - Immediately pauses when `document.visibilityState === 'hidden'`.
  - Resumes and polls immediately when tab becomes visible again.
- **Exponential Backoff with Jitter**:
  - Starts at 5s.
  - On consecutive RPC failures, backs off through 10s, 20s, up to a maximum cap of 60s with 0–1s randomized jitter.
  - Immediately resets to 5s upon a successful sample.
- **Monotonicity**:
  - Ledger sequence and close time samples never regress, even when an RPC node replica is slightly delayed.
- **Time Estimation**:
  - `estimateNow()` returns `{ ledger: number; time: number }` using elapsed monotonic time (`performance.now()`) and average close interval (5.5s), capped to 2x average close time to prevent drift.
- **React Hook**:
  - `useLedgerClock()` exposes `LedgerInfo | null` subscribed via `useSyncExternalStore`.

---

## 2. Event-Driven Invalidation (`lib/stellar/ledger-invalidation.ts`)
- **Lifecycle**: Mounted in `WalletProvider.tsx` across the entire application.
- **Ledger Invalidation Loop**:
  - When the ledger sequence advances (`lastSeen < current`):
    - **Normal Range (`0 < current - lastSeen <= 120`)**:
      - Queries `rpc.getEvents({ startLedger: lastSeen + 1, endLedger: current + 1, filters })` for `CONTRACTS.marketCore` and `CONTRACTS.usdc`.
      - **Trade Events**: Invalidates `['onChainMarket', marketId]`, `['stellar', 'market', marketId]`, `['market', marketId]`, and `['markets']`.
      - **MarketCreated Events**: Invalidates `['markets']`, `['stellar', 'markets']`, `['stellar', 'marketCount']`.
      - **MarketResolved Events**: Invalidates the market, `['positions']`, `['portfolio']`, and `['stellar', 'myPositions']`.
      - **Redeemed Events**: Invalidates positions, portfolio, and the redeemer's `['stellar', 'usdcBalance', holder]`.
      - **USDC Token Events**: Matches connected `userAddress` across transfer/mint/burn events to invalidate `['stellar', 'usdcBalance', userAddress]`.
    - **Gap Handling (`current - lastSeen > 120`)**:
      - Occurs if a user closes laptop or suspends tab for minutes/hours.
      - Skips event querying to avoid RPC pagination limits.
      - Executes `broadInvalidate()` across active queries: `stellar`, `markets`, `positions`, `portfolio`, `traces`.

---

## 3. Query Cache Configuration
- **On-chain Queries** (`useOnChainMarket`, `useUsdcBalance`, `usePosition`):
  - Set to `staleTime: Infinity` because updates are guaranteed via event-driven invalidation.
  - Fallback slow poll: `refetchInterval: 300_000` (5 minutes) as safeguard against network drops.
  - `refetchIntervalInBackground: false`.
- **Backend Queries** (`useMarkets`, `usePortfolio`, `useTraces`):
  - `refetchIntervalInBackground: false` to halt queries when tab is unfocused.
