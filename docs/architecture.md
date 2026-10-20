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

### Market generation jobs

`/admin/create` starts one market-maker run with `POST /markets/generate` and an `Idempotency-Key` per click (the backend requires one; a retried request can't start a second paid run). It sends `{}`: the agent picks the question, category and close time itself. Started job ids are stored per admin address and network in `localStorage` (`oracledesk_admin_jobs:<network>:<address>`, newest first, at most 50; `lib/admin/job-store.ts`) and shared across components and tabs through `useSyncExternalStore` and the `storage` event, so each tab polls each job with one query. `useMarketGenerationStatus` polls `GET /markets/generation-status/:jobId` every 5 s, 15 s once the server's `elapsedMs` passes two minutes, and stops on `COMPLETED`, `FAILED`, `UNKNOWN` (the backend restarted; only its start log survived) or `404 JOB_NOT_FOUND` (pruned an hour after finishing), which maps to `NOT_FOUND`. Auth errors are not retried; polling pauses with "Sign in again to keep tracking". Elapsed time is the server's `elapsedMs` plus only the local time since that answer. The job feed is derived from these states (`lib/admin/job-events.ts`); a `COMPLETED` job with `onChainMarketId: null` is explained as dry-run or failed on-chain creation. "Open market" links to `/markets/quick-view?marketId=…`, never `marketUrl`, which is an API path. The "runs in the last hour" count covers this browser only; the backend's limit is 5 per hour per IP, and a 429 shows its `Retry-After`.

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

## x402 per-trace unlocks

`lib/x402/client.ts` talks to the contracts repo's trace service (`GET {NEXT_PUBLIC_X402_URL}/traces/:onChainTraceId`) with the same `@x402/*` release the service pins (2.26.0, exact; `npm run check:x402`). Protocol v2 over HTTP: the 402 carries `PAYMENT-REQUIRED` (base64 JSON `PaymentRequired`), the paid retry sends `PAYMENT-SIGNATURE` (base64 JSON `PaymentPayload`), and a settled 200 carries `PAYMENT-RESPONSE` (base64 JSON `SettleResponse`). The Stellar `exact` payment is a Soroban authorization entry for one SEP-41 `transfer(payer, payTo, amount)`, signed by the wallet with `signAuthEntry` (SEP-43); the facilitator builds, sponsors and submits the transaction. Every request sends `Accept: application/json`, because the middleware answers browsers that accept `text/html` with an HTML paywall.

Facts of the pinned client worth knowing:

- The wallet must support Soroban auth-entry signing (Freighter does). The adapter exposes the kit's `signAuthEntry`; signing refuses with a plain message when the wallet can't.
- A bare price (the service's `TRACE_PRICE_USDC`, "0.01") is charged in `@x402/stellar`'s default asset: Circle's testnet USDC SAC `CBIELTK6…DAMA`, not the app's self-issued USDC. Amounts are always read from the 402.
- Building the payment simulates the transfer on the app's Soroban RPC; the scheme passes no `allowHttp`, so that RPC must be https. It also asks Horizon (testnet: `horizon-testnet.stellar.org`) for recent ledger times and falls back to 5 s per ledger. The signature expires at `latest ledger + ceil(maxTimeoutSeconds / ledger seconds)`; `maxTimeoutSeconds` defaults to 300.

### Payment journal and recovery (`lib/x402/recovery.ts`)

Every signed payment is written to IndexedDB (`oracledesk-x402`, store `payments`, indexed by `[wallet, network, onChainTraceId]`) with `durability: "strict"`, and the write must commit before the paid request is sent. If IndexedDB is unavailable, the app refuses to sign. `unlockTrace` checks the journal first:

- an entry in `signed`, `sent` or `failed-retryable` is **redelivered with the same header**, never re-signed, until its expiration ledger (compared with RPC `getLatestLedger`, not the clock);
- network errors and 5xx keep the header and retry after 1 s, 3 s and 10 s;
- a 402 to a paid request, or an entry past its expiration ledger, triggers a settlement check before anything else happens. Settled payments become `settled-undelivered` and are never paid again; the user gets "Retry delivery" and "Copy payment evidence". Unsettled ones only become `expired`, and safe to pay again, once the expiration ledger has passed;
- a 200 whose `traceHash` differs from reasoning-registry's is a delivery failure (`settled-undelivered`, `hash-mismatch`). Otherwise the entry becomes `delivered`, and content is shown only after the IPFS bytes verify against the on-chain hash (`fetchVerifiedTrace`).

The settlement check reads SEP-41 `transfer` events from the wallet to `payTo` on the requirement's asset, in the ledgers where the signature was valid. An event of the right amount counts only if its transaction carries this payment's auth entry (same payer and nonce), so same-priced payments in one batch are never confused. If events are missing for the window (RPC retention), the result is `unknown` and the payment stays retryable. Tabs coordinate through a Web Lock per wallet, network and trace, and a `BroadcastChannel("oracledesk-x402")` that refreshes other tabs' views. The payment header is a bearer credential until it settles or expires. It is never logged, never put into error text, and never part of the support evidence.

**What the pinned `@x402/express` 2.26 does** (read from its source and pinned by `e2e/x402`):

- (a) *Same header replayed after settlement*: there is no delivery cache. Every paid request is verified with the facilitator again, and an auth entry whose nonce was consumed fails verification, so the replay gets a 402, not content. It can't be charged twice either. A settled-but-undelivered payment can't be redelivered against this service (contract request 7).
- (b) *Handler error after payment*: the Stellar `exact` scheme's default flow is `authorization`, which runs verify before the handler and settle after it, and only when the handler answered below 400. The handler's output is buffered meanwhile. A 502 (gateway down, tampered bytes) or 404 (unknown trace) cancels the payment and nothing is settled, so the same header can be resent until it expires. The middleware also prices the route before the handler looks the trace up, so an unknown id still answers 402 first.
- (c) *Client disconnect mid-response*: settlement runs after the handler regardless of the client. A disconnect after `/settle` leaves the payment settled and the response lost; the journal recovers this as `settled-undelivered` through the settlement check.

### Unlock cart (`lib/x402/cart.ts`)

`/reasoning` can collect locked traces (deduplicated by on-chain id; traces not on-chain are rejected). Each is quoted from its live 402, three at a time. The backend's `unlockPriceRaw` is only a hint and is never shown as the charged amount. Checkout pays one item at a time through `unlockTrace`, so each payment has its journal entry and its own wallet prompt. Before every signature the item's 402 is read again:

- a different `payTo`, asset or network is refused;
- a higher price pauses the run until the user accepts it for this item, accepts it for all remaining items, or skips;
- a lower price proceeds, and the receipt records both amounts.

The spending policy runs after that. Without one, a conservative fallback keeps each payment within the run's confirmed total plus any increases the user accepted. A policy denial of `over-daily` or `over-per-trace` skips the rest of the run. Cancelling, or a wallet change, stops before the next item. The receipt (downloadable JSON, bigint amounts as strings) lists each item's status, quoted and paid amounts, settlement hash and verification result, and flags payments that went through without a verified unlock. When the total reaches the daily-pass price, the drawer recommends `/premium`. Everything x402 is hidden when `NEXT_PUBLIC_X402_URL` is empty.

## PWA and service worker

`public/sw.js` (hand-written) is registered as `/sw.js?v=<BUILD_ID>` in production on secure origins only; `next dev` unregisters build workers.

Cached (namespace `shell-<BUILD_ID>`): prerendered route HTML (network-first, 4 s timeout, then cached HTML, then `/offline`) and `/_next/static/**`, `/icons/**`, `/favicon.ico` (cache-first). The list comes from `/_next/static/sw/precache-<BUILD_ID>.json`, written by `scripts/build-sw-manifest.mjs` after `next build` from `.next/BUILD_ID`, `.next/prerender-manifest.json` and every file under `.next/static/` (including lazily loaded wallet-kit chunks).

Never cached or intercepted: any other origin (backend, Soroban RPC, socket.io, IPFS, x402, wallets), requests with `Authorization` or `Range`, non-GET, `/api/`, `/socket.io`.

Update rule: the worker never calls `skipWaiting()` itself. When a new one is waiting, a non-dismissable banner asks the user to reload, and `useWriteGuard` refuses to sign ("Reload to update OracleDesk before signing.") until they do.
