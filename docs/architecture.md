# Frontend architecture

## Where data comes from

The frontend has two sources that can disagree, and it says which one a value came from (the small `chain` / `backend` tags in the UI).

| Data | Source | Why |
|---|---|---|
| Prices, reserves, market status, positions, USDC balance | **Chain**, via simulated contract calls (`lib/hooks/useStellar.ts`) | The contract is the truth; the backend's copy can lag. |
| Question text, category, reasoning traces (metadata), subscriptions, platform counts | **Backend** (`lib/api/*`, `docs/api.md`) | Not stored on-chain in readable form. |
| Trace content | **IPFS**, then hash-checked against `reasoning_registry.get_trace` | Gateways are not authenticated; content is shown only if its sha256 matches the chain (`lib/stellar/trace.ts`). |
| Treasury risk caps (`max_trade`, `max_market`, `max_daily`), daily usage, available capital | **Chain**, treasury `get_config`, `daily_usage` and `available_capital` (`lib/hooks/useTreasury.ts`) | Read on `/portfolio` without auth. The reset countdown uses ledger close time. The backend's `availableCapitalRaw` is flagged when it differs from the chain for two refetches in a row. Per-market exposure and the paused flag aren't readable yet (see `docs/contract-requests.md`). |
| Per-market trade tape | **Chain** `Trade` events, extended by validated socket events | Contract-spec topic filters select one market. Backward ledger windows with forward cursor pagination find the newest rows; RPC retention limits history. Socket copies are replaced by decoded RPC copies on refetch. |
| Per-market price history | **Chain** market-core `getEvents`, decoded and bucketed client-side (`lib/stellar/price-history.ts`, `lib/charts/*`) | Event retention bounds history; the chart shows coverage and the retention reason explicitly. Decoded points cache in IndexedDB per market (32-entry in-memory fallback when storage is unavailable). |
| Wallet inbox | **IndexedDB**, populated from validated own-wallet events and the transaction tracker | Scoped by address and network passphrase. It contains no agent portfolio data. Resolution/redemption events are polled every 60 seconds while visible; current contract status catches resolutions outside retention. |

A backend market links to the chain through `onChainMarketId` (market-core's `u64` id, a decimal string in JSON). On-chain markets the backend doesn't know are still listed on `/markets`, with on-chain data only.

## Wallet and login

`lib/stellar/WalletProvider.tsx` wraps `@creit.tech/stellar-wallets-kit` 2.5.0 (pinned: the last release built on `@stellar/stellar-sdk` 16, the same major as the contract bindings). The application and bindings share SDK 16; hardware-wallet internals can carry separate transitive versions.

- The kit is imported dynamically in an effect, because it reads `localStorage` when its module loads.
- A session the kit persisted is restored without prompting and without redirecting. Only a connect completed in the modal redirects to `/markets`.
- After connecting, the wallet signs the backend's SEP-10 style challenge transaction (`signTransaction`, which every Stellar wallet supports; `signMessage` is not universal). The backend returns a JWT. A stored session for a different address is cleared, never reused.
- `useWallet()` exposes `address`, `isWrongNetwork`, a `signer` for the binding clients, `openModal`, `ensureSession` and `disconnect`.

### Wallet context slices

The provider publishes six memoized slices instead of one context value, so a
component is only re-rendered by the part of the wallet it actually reads.
Each slice is a separate React context with a value that only changes when
its own fields change.

| Hook | Slice | Changes when |
|---|---|---|
| `useWalletAddress()` | identity | the connected account changes |
| `useWalletNetwork()` | network | the wallet reports a network, or it is the wrong one |
| `useWalletSession()` | session | the backend session is created or lost, or an error is set |
| `useWalletSigner()` | signer | the connected account changes (the signer is bound to it) |
| `useWalletActions()` | actions | never — `openModal`, `ensureSession`, `withSession` and `disconnect` keep the same identity for the life of the provider |
| `useWalletMeta()` | meta | the kit reports which wallet module is in use |

`useWallet()` is kept as a compatibility facade: it returns the same
`WalletContextValue` shape as before, composed from the slices. **It
re-renders on any wallet change**, so it should be avoided in components that
render often (the trade ticket, the wallet dropdown, the trade tape). Use the
narrow hook for the field you need.

The actions read the wallet machine's current state when they are called, not
when they were created, so a stale closure cannot sign in with a previous
account. The machine also keeps the *same state object* when an event does not
change anything (a kit event that repeats the current address and network),
so the provider does not re-render at all for kit chatter.

The quick-view modal keeps its amount input, quote and trade in
`components/market/buy-ticket.tsx`, so typing in the amount field re-renders
the ticket and nothing else in the modal. The measurements are in
`docs/perf/wallet-context.md`; `lib/dev/profiler.tsx` logs the same numbers
from the browser during development.

## Contract calls

- `lib/stellar/clients.ts` builds a generated binding `Client` per contract, optionally with the wallet as signer. The USDC Stellar Asset Contract has no Wasm and so no bindings; `token.balance` and `token.transfer` are built with `AssembledTransaction.build`.
- Read-only clients are memoised by contract, RPC URL, passphrase and timeout. Each generated constructor decodes every base64 spec entry, so the first factory call caches the parsed `Spec`; signer-bound clients are then built with the base `contract.Client` from that spec, keyed by the signer object and `publicKey` in a `WeakMap`. All clients share one `rpc.Server` per URL (`rpcServer`), so quote and simulation calls reuse one HTTP client. `__resetClientCaches()` and `__specBuildCount()` exist only for the cache tests and benchmark.
- Reads are simulations (no fee, no signature), except the batched market list described below. Write-adjacent reads deliberately stay on simulation so they cannot observe a ledger entry older than the write they are preparing.
- `npm run bench:clients` measures generated-client construction and quote building against the cached path without network calls.
- Writes (`useBuy`, `useSell`, `useRedeem`, `useUsdcTransfer`) check that a wallet is connected and on the right network, run fresh contract preflight checks, simulate, then `signAndSend`. A per-address queue serializes complete build/sign/send jobs in this tab and coordinates browser tabs with Web Locks (or a local-storage lease fallback); stale-sequence errors receive one fresh-build retry. The buy, sell, redeem, and USDC-transfer paths can decode the final simulated contract invocation and show its arguments and transaction envelope for review before the wallet prompt.
- `useBuy` quotes again immediately before building the transaction and sets `min_shares_out = minOut(quote, slippageBps)`, so slippage is enforced on-chain.

### Batched market reads

`useOnChainMarkets` and `fetchOnChainMarket` coalesce calls made in the same tick through `lib/stellar/market-batch.ts`. Each request asks `getLedgerEntries` for at most 200 market keys (spec-driven `DataKey::Market(u64)` encoding from `lib/stellar/ledger-keys.ts`), maps entries back by `LedgerKey` rather than response order, and decodes `Market` with the cached binding spec. The result carries the entry's ledger, persistent-entry TTL (`liveUntilLedgerSeq`) and read method (`ledger-entry` or `simulation`). An entry the RPC omits, or an archived one, falls back to the existing simulation read. Resolved and void markets with no reserves stay readable with `yesBps: 0` instead of failing the whole batch.

`/markets` runs one page-level heartbeat (`useMarketsHeartbeat`) rather than an interval per card. It invalidates the market list on a fixed cadence, and the batcher collapses all cards' reads into as few RPC requests as possible. The admin diagnostics sampler reuses the same reader.

## Admin diagnostics

`/admin` shows live diagnostics instead of demo data: backend and chain market counts, sampled status/probability comparisons, RPC latency, and the indexer's last ledger. The sampler reads the newest ten markets plus a rotating sample from the rest, uses the same batched ledger reader as the market list when possible, limits itself to three in-flight reads and a ten-reads-per-second token bucket, and links each mismatch to the affected market. `/admin/agents` merges registry events, `deployments.testnet.json` and `NEXT_PUBLIC_KNOWN_AGENTS`, reads live `is_registered` for each address, and offers register/unregister review with a typed confirmation. Neither page fabricates a healthy state.

### Confirmed wallet updates and reconciliation

Position and USDC balance caches hold `{ value, ledger, provisional?, awaitingRpc? }`; existing hooks select `value`, while `usePositionState` and `useUsdcBalanceState` expose the metadata. Simulations supply the read ledger. A confirmed buy/sell/redeem applies only contract-returned bigint amounts, using the confirmed transaction ledger, and immediately updates an existing cache. Cached values already read at or above that ledger are left alone. Missing caches and unknown transaction ledgers use invalidation instead.

Reads are cancelled before signing and again before the confirmed delta is applied. No delta is applied while awaiting a signature, so rejection and simulation failure leave values unchanged. Consecutive confirmations compose against the latest cache. Negative deltas that exceed cached holdings or balance trigger invalidation. No quote cache is invalidated by this flow.

Reconciliation refetches after 1, 3 and 8 seconds. Reads below the cached ledger cannot overwrite it. At or above that ledger, matching reads remove the provisional marker; different reads replace the value and log `[optimistic] mismatch`. After three lagging reads, the value remains labelled **awaiting RPC**, with its transaction link, until an authoritative read arrives. Query removal on disconnect disposes reconciliation timers. Fee previews are rebuilt with the current wallet before transaction review and signing.
## Write path and transaction lifecycle

Every state-changing write (`useBuy`, `useSell`, `useRedeem`, `useUsdcTransfer`) follows an explicit, observable lifecycle governed by `TxLifecycle` in `lib/stellar/tx-lifecycle.ts`:

1. **Fee Preview & Simulation**: Before signing, `usePrepareBuy` and `usePrepareUsdcTransfer` simulate the transaction. `lib/stellar/fees.ts` calculates `feeBreakdown` (inclusion fee, resource fee, and Soroban resource footprint) and computes `spendableXlm` from the account ledger entry following CAP-33 rules (`minBalance = (2 + numSubEntries + numSponsoring - numSponsored) * baseReserve`). If spendable XLM is below the estimated total fee, the UI disables submission with an exact deficit warning.
2. **Observable Lifecycle Phases**: `useTxRunner` drives the transaction through typed phases:
   - `building` → `simulating` → `awaiting-signature` → `submitting` (hash available) → `pending` (polling with backoff) → `confirmed` | `failed` | `expired`.
   - Expiration is determined from `latestLedgerCloseTime` reported by Stellar RPC, not the browser clock.
   - Statuses and errors (`PENDING`, `DUPLICATE`, `TRY_AGAIN_LATER`, `ERROR`, `txBadSeq`, `op_low_reserve`, etc.) are mapped cleanly to `TxDescribedError`.
3. **Session Transaction Tracker (`lib/stellar/tx-tracker.tsx`)**:
   - `TransactionTrackerProvider` mounted in `WalletProvider` captures every submitted transaction as soon as the hash is known.
   - Transactions are serialized to `sessionStorage` (`oracledesk_pending_txs`) with BigInt amounts as strings, resuming polling on page reload.
   - Polling across multiple browser tabs is coordinated with `BroadcastChannel("oracledesk-tx")` to ensure only one tab polls the RPC server.
   - Upon confirmation, `tradeInvalidationKeys` performs React Query cache invalidations across market, positions, and balance queries even if the initiating component unmounted.
   - The `<TxToastContainer />` component (`components/ui/tx-toast.tsx`) renders accessible toasts announcing state transitions and supports resuming premium daily pass activation follow-ups.

## Reading contract results

All contract results must be read through `read(tx, contract)` for simulations and `submit(tx, contract)` for transactions (`lib/stellar/typed-call.ts`).

- **Type inference**: `read` and `submit` automatically infer their return types from the binding method's return type using the `Unwrapped<TxValue<Tx>>` type utility. Contract `Result<T>` values are unwrapped to `T`, while plain return values (such as `Position` or `u64`) are passed through unchanged.
- **No manual type arguments or hand-written shapes**: Never pass explicit generic type parameters to `read` or `submit` (e.g. `read<MyType>(...)`), and never write out return interfaces by hand. An ESLint `no-restricted-syntax` rule enforces that call sites cannot pass type arguments to `read`, `submit`, or `simulated`.
- **Runtime Result detection**: Contract `Result` values are identified using SDK `instanceof Ok` and `instanceof Err` checks from `@stellar/stellar-sdk/contract`. Plain objects that happen to have an `isOk` property are never mistaken for Results.
- **Trace hash conversion**: The byte buffer (`Buffer` or `Uint8Array`) returned from `get_trace` must be converted to hex using `bytesToHex(trace.trace_hash)` rather than ad-hoc `Array.from` routines.
- **Pinning types**: Whenever the application starts using a new contract binding method, add corresponding type assertions to `lib/stellar/__tests__/typed-call.test-d.ts` (using `Value<Client, Method>` and argument parameter shapes) with `.not.toBeAny()` guards. This ensures that any upstream contract signature changes fail the test suite immediately.

## Amounts

USDC has 7 decimals. Anything that can reach a transaction is a `bigint` in base units (`lib/stellar/units.ts`). Parsing rejects floats in exponent form and more than 7 decimals. Display floats exist only at the edge of the UI.

## Market price chart

`/market` shows a real step-line YES-price chart for the market in `?onChainId=` (Suspense-wrapped `useSearchParams`). `loadPriceHistory` (`lib/stellar/price-history.ts`) pages `getEvents` newest-first (1,000 per page, 20 pages max), clamps the window to RPC retention, decodes `Trade` events into `{ price, reserves, timestamp }` points with the pinned FPMM math, and caches serialized points in IndexedDB per market. `usePriceHistory` refetches every 15 seconds while the tab is visible.

Points bucket on a worker (`lib/charts/bucket.worker.ts`) into fixed widths per period (1H→5m, 1D→30m, 1W→6h); the fallback path buckets on the main thread when workers are unavailable. The chart renders only after a mount frame so `ResponsiveContainer` always has a measured width (this is what removed the `width(-1)` warning class). Chart colors come from CSS variables (`--chart-yes`, `--chart-no`, …), never hex literals in components.

## Errors

`lib/stellar/errors.ts` turns SDK, wallet and contract failures into plain sentences. Contract errors are named from the `Error(Contract, #N)` code through each binding's `Errors` table. Wallet rejection, insufficient USDC and a missing USDC trustline are matched first, because token errors raised inside `market_core.buy` carry the token contract's own codes, which overlap with market-core's.

## Generated code

`lib/stellar/generated/` is copied from the pinned `contracts` submodule by `scripts/sync-bindings.mjs`, with a do-not-edit header and `// @ts-nocheck`. CI fails if it's stale. `CATEGORY_TAGS` in `clients.ts` has a compile-time exhaustiveness check against the binding's `Category` type, so a contract enum change breaks the build rather than the UI.

## Rendering

All routes prerender as static pages. Pages that read query parameters (`/markets/quick-view`, `/copy-trade`, `/reasoning/verify`) keep `useSearchParams` inside a `<Suspense>` boundary; without it the production build fails.

### Server and client boundaries

Pages under `app/` should default to server components. Only the smallest interactive subtree should opt into `"use client"`; static marketing copy, pricing tables, feature summaries and layout-only content stay in the server-rendered shell so they do not inflate the client bundle or hydrate unnecessarily.

- Keep page entrypoints in `app/.../page.tsx` as server components that render a lightweight client island.
- Co-locate interactive islands under `app/_components/` or `app/<route>/page-client.tsx` with a single `"use client"` directive at the top.
- Pass only serializable props across the server/client boundary (strings, numbers, arrays, plain objects, URL strings, not functions or `bigint`).
- Wallet, React Query, socket streams, framer-motion and browser-only APIs stay client-only and are never imported into server pages.
- Server pages must not import `lib/contexts/*`, `lib/hooks/*`, `WalletProvider`, or client-only config objects. They are static and should remain free of browser-only code.
- Use `export const dynamic = "error"` on server-shell routes that are meant to stay static. This fails fast if a future change accidentally makes a route dynamic.

### Realtime lists and storage bounds

`RealtimeProvider` owns one socket and one mixed-event scheduler. Valid payloads enter a 500-event bounded batch; subscribers receive at most one batch per animation frame. Hidden tabs accumulate a bounded backlog without updating realtime DOM, then receive one catch-up batch with overflow counts. Feed rings retain six home rows and eight market rows with event IDs as keys. A rolling second above ten events suppresses row animations and displays a summary; reduced motion also disables the ticker and realtime row animations.

The market tape retains at most 2,000 trades per market and 32 cached markets. A fixed eight-row viewport with overscan renders at most 24 data rows plus spacer rows. USDC, shares and fees remain bigint base units; post-trade price uses the pinned FPMM calculation. Each row links to its trader and transaction. Event retention is shown explicitly, including empty histories.

The home hero shows the most liquid ACTIVE market from the markets feed (`pickFeaturedMarket`, deterministic — same list, same market); the ticker formats the same feed through `tickerItems`. No home-page number is invented: no random probability walk, no placeholder volume, no fabricated insight quote.

`/reasoning` renders `useInfiniteTraces` pages merged by `mergeTracePages` (id-deduplicated); an IntersectionObserver sentinel loads the next page with an explicit button fallback. `listTraces` narrows response `meta` through `isPaginationMeta`, because older deployments omit pagination meta — the feed simply stops after page one there. Trace cards render only the preview sources the backend actually sent; locked traces say so instead of showing fallback synthesis or invented source-weighting numbers.

`InboxProvider` remounts for each address/network pair, closes its previous database handle, and renders nothing from the previous owner. `oracledesk-inbox` stores deterministic item IDs, read state and the last processed ledger. Duplicate deliveries preserve read state and creation time. The inbox retains 500 items, pruning oldest read items first, and displays the newest 200. Storage failures fall back to memory with a visible notice. Reading a page does not mark anything read; the user explicitly marks one item or all items. Held-market discovery uses the owner's saved fills and already-read position queries; it does not scan all ledger keys or use the treasury agent's portfolio.

## RPC endpoints

`RPC_URLS` = `NEXT_PUBLIC_STELLAR_RPC_URL` (primary) + `NEXT_PUBLIC_STELLAR_RPC_URLS`. `lib/stellar/rpc-pool.ts` verifies each endpoint with `getNetwork` (wrong passphrase → never used), probes `getLatestLedger` every 15 s while the tab is visible, and keeps the last 50 samples per endpoint (p50/p95, error rate, 429s with Retry-After back-off, ledger lag). Selection is sticky: it switches only when another endpoint scores ≥30% better on two consecutive probes, or the current one is down/degraded. Write hooks run inside `withPinnedRpc`, so quote, simulate, submit and polling use one endpoint; a failed submission is never resent elsewhere. Reads carry the ledger they were simulated at (quick-view shows "as of ledger N") and an older-ledger result never replaces newer cached data. Single-endpoint setups behave as before.

## Trace verification

The on-chain `trace_hash` decides whether content is shown. Everything else is evidence about why a check failed.

- **Gateway pool.** `NEXT_PUBLIC_IPFS_GATEWAY_URL` is a comma-separated list (at most 5 https gateways; `http://localhost` is allowed for local testing). `lib/stellar/trace-core.ts` races them: gateway *i* starts after *i* × 750 ms, or as soon as an earlier attempt fails. Each attempt has an 8 s timeout. The first attempt whose bytes match the on-chain hash wins, and the others are aborted. A mismatch doesn't end the race, because another gateway may serve the correct bytes.
- **Outcomes.** `verified` means some gateway served bytes whose sha256 equals the chain. `mismatch` means at least one gateway returned bytes and none matched; content is never returned. `unavailable` means no gateway returned usable bytes, or the user cancelled. Every result carries per-gateway `attempts` (outcome, HTTP status, time, bytes), shown on `/reasoning/verify`.
- **Size cap.** `NEXT_PUBLIC_IPFS_MAX_TRACE_BYTES` (default 1 MiB) is enforced while the body streams, so an oversized response is abandoned without being buffered.
- **CID check.** `lib/stellar/cid.ts` checks CIDv1 raw-codec sha2-256 CIDs against the bytes. It reports `match`, `mismatch`, `unsupported` (for example dag-pb, used for multi-block files) or `invalid`. The check is informational and never overrides the on-chain hash. A CID mismatch with a verified hash means the publish is inconsistent. A CID mismatch with a hash mismatch means the gateway served the wrong object.
- **Worker.** `lib/stellar/trace.worker.ts` runs the race, the incremental SHA-256 (`lib/stellar/sha256.ts`) and the JSON decode off the main thread, and posts progress. Only verified bytes are transferred back, as a transferable `ArrayBuffer`. Mismatches carry no bytes. `verifyTraceInWorker` falls back to the main thread when workers are unavailable, and does so for the rest of the session if the worker fails at runtime.
- **CSP.** The worker is a same-origin module (`new Worker(new URL("./trace.worker.ts", import.meta.url), { type: "module" })`). A strict CSP needs `worker-src 'self'` and must not allow `blob:`. Gateway subdomain redirects (for example `dweb.link`) need `connect-src` entries too.

## PWA and service worker

`public/sw.js` (hand-written) is registered as `/sw.js?v=<BUILD_ID>` in production on secure origins only; `next dev` unregisters build workers.

Cached (namespace `shell-<BUILD_ID>`): prerendered route HTML (network-first, 4 s timeout, then cached HTML, then `/offline`) and `/_next/static/**`, `/icons/**`, `/favicon.ico` (cache-first). The list comes from `/_next/static/sw/precache-<BUILD_ID>.json`, written by `scripts/build-sw-manifest.mjs` after `next build` from `.next/BUILD_ID`, `.next/prerender-manifest.json` and every file under `.next/static/` (including lazily loaded wallet-kit chunks).

Never cached or intercepted: any other origin (backend, Soroban RPC, socket.io, IPFS, x402, wallets), requests with `Authorization` or `Range`, non-GET, `/api/`, `/socket.io`.

Update rule: the worker never calls `skipWaiting()` itself. When a new one is waiting, a non-dismissable banner asks the user to reload, and `useWriteGuard` refuses to sign ("Reload to update OracleDesk before signing.") until they do.

## Ledger Heartbeat & Event-Driven Invalidation

Instead of independent intervals across components, `LedgerClock` (`lib/stellar/ledger-clock.ts`) runs a singleton heartbeat querying `getLatestLedger` roughly every 5 seconds while visible.

- **Visibility-Aware**: Polling immediately halts when the tab is hidden and resumes when visible.
- **Exponential Backoff**: Success resets the interval to 5s; RPC failures back off through 10s, 20s, up to 60s with jitter.
- **Event-Driven Invalidation**: Mounted in `WalletProvider` via `LedgerInvalidator` (`lib/stellar/ledger-invalidation.ts`). On new ledgers, `getEvents` queries `marketCore` and `usdc` to invalidate queries matching affected market IDs and user balances. Gaps > 120 ledgers perform a broad invalidation.
- **Query Cache Policies**: On-chain queries have `staleTime: Infinity` with a 5-minute fallback poll; backend queries set `refetchIntervalInBackground: false`.

