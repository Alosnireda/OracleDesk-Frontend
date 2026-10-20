# Manual test: wallet flows on Stellar Testnet

These steps cover what automated checks can't: a real browser wallet signing real testnet transactions. Nothing here uses mainnet or real money. Tick each box and note what you saw; anything that doesn't match is a bug.

**Status:** every step below is **unverified**. The port was done without a browser wallet. The automated checks (unit tests, `npm run e2e:testnet`, the backend smoke test) cover the read paths and signing logic, but no human has clicked through these yet.

## Before you start: two known blockers

1. **Test USDC can only be minted by the deployer key.** The collateral is a self-issued test asset wrapped as a Stellar Asset Contract. There is no faucet, so step 4 still needs a maintainer (see [contract-requests.md](contract-requests.md) #3).
2. **Both existing testnet markets are closed.** Markets 0 and 1 were created by the contracts repo's demo with a 90-second trading window on 2026-09-21; market 0 is resolved YES. Buying on them fails with "This market has closed". Step 7 therefore needs a fresh, open market (see below).

## You need

- Chrome, Brave or Firefox with [Freighter](https://www.freighter.app/) installed.
- The backend running locally (its README quick start, plus `scripts/smoke.sh` passing).
- This app running: `cp .env.example .env.local`, set `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`, then `npm run dev`.

## 1. Install Freighter and create a test account

- [ ] Install the Freighter extension and create a new wallet. **Use a fresh wallet for testing; don't import a key that holds real funds.**
- [ ] Copy your public key (starts with `G`).

## 2. Switch Freighter to Testnet

- [ ] Freighter → Settings → Network → **Test Net**.

## 3. Fund the account with Friendbot

- [ ] Before funding, the wallet menu shows **Account not activated** with a **Fund with Friendbot** link (testnet only). A buy is refused with "Your Stellar account isn't activated yet", not a raw SDK error.
- [ ] Open `https://friendbot.stellar.org/?addr=<YOUR_G_ADDRESS>` (or the menu's **Fund with Friendbot** link).
- [ ] Freighter shows about 10,000 XLM. Within about 10 seconds the menu flips from "Account not activated" to an XLM balance (about 10,000 XLM).

## 4. Get test USDC

a. **Enable the trustline in OracleDesk** (the account must trust the asset before it can hold it):

- [ ] Connect your funded wallet, then open the wallet menu or an on-chain market's quick view.
- [ ] Click **Enable USDC** and approve the one-time `changeTrust` transaction. The flow checks spendable XLM for the trustline reserve and transaction fee first.
- [ ] Wait for the trustline to appear. Enabling it does not submit a pending buy; review the amount and click **Buy** again.

b. **Ask a maintainer to mint.** With the deployer key from `scripts/deploy-testnet.sh` (the CLI identity `oracledesk-deployer`), they run:

```bash
stellar contract invoke --id CA2WQQJ4OHQCLHQW6XN4BCLILGRV6V4YDYDT3GVIWXB53BTOO7EMREQH \
  --source-account oracledesk-deployer --network testnet \
  -- mint --to <YOUR_G_ADDRESS> --amount 1000000000   # 100 USDC (7 decimals)
```

- [ ] Freighter shows 100 USDC.

## 5. Connect

- [ ] Open `http://localhost:3000`, click **Connect Wallet**, choose Freighter, approve.
- [ ] After approving, you **stay on the page you were on**. No login signature is requested yet. Reload the page: you stay where you are and are still connected.
- [ ] No login signature appears until you do something that needs OracleDesk's server (copy trade, daily pass, admin). Then Freighter asks you to sign a transaction for OracleDesk login. It is never submitted; it proves you own the key. Approve it, and a sentence explains why it appears.
- [ ] Sub-step: start the connect from `/copy-trade?traceId=…` with a non-default slider value. After approving, the URL and the slider value are unchanged.
- [ ] Expected: no error under the button. In DevTools → Application → Local Storage, `oracledesk_wallet` equals your address once you have signed in.

## 5a. Mobile wallet (WalletConnect)

Needs `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` set and this origin allowed in the project.

- [ ] Desktop: click **Connect Wallet**, pick the WalletConnect option, scan the QR code with LOBSTR or Freighter Mobile on **testnet**.
- [ ] Approve the pairing on the phone. The app shows the account and stays on the current page.
- [ ] Log in (step 5) and buy. Each signature is approved on the phone; the page waits for the wallet's answer.
- [ ] Reload: the session restores without a prompt.
- [ ] If the phone's session has ended, a trade shows "Your mobile wallet session ended. Connect your mobile wallet again." (not a raw error).

## 6. See your balance

- [ ] Open the wallet menu (top right). It says **Stellar Testnet** and shows **100.00 USDC**.
- [ ] Switch Freighter to Mainnet: the menu shows **Wrong network** in red. Switch back to Testnet.
- [ ] "Copy address" copies your G-address; "View on Stellar Expert" opens your testnet account page.
- [ ] `/portfolio/wallets` shows the same balance; its chart and history table carry a "Demo data" label.

## 7. Buy YES

First, a maintainer opens a market that stays open long enough to trade. In the contracts repo (`oracledesk-stellar/`):

```bash
# 150 USDC seed, 50/50 start, closes in 7 days, 1-day dispute window
./scripts/seed-market.sh 1500000000 5000 604800 86400 "Manual test market"
# note the market_id it prints, e.g. market_id=2
```

Then in the app:

- [ ] Open `http://localhost:3000/markets/quick-view?onChainId=<market_id>`. Status shows **OPEN** with a `chain` tag, and YES is about 50%.
- [ ] Select **YES**, enter `10`. A quote appears: "≈ N shares, at least M (1% slippage)".
- [ ] Click **Buy YES**. Freighter shows a `buy` call on market-core (`CC4MMHWZ…`). Approve.
- [ ] A success line shows the shares received and a Stellar Expert link. The transaction there shows `buy` with `min_shares_out` equal to the "at least" figure.
- [ ] The wallet menu balance drops by 10 USDC.
- [ ] Optional, slippage: start a buy, and before approving, buy a large amount from another account. Approving the first should fail with "The price moved before your trade went through…".

To try the same on market 0 (resolved): the buy button is disabled and the panel says "This market is closed to trading". That is the expected result.

## 8. See your position

- [ ] On the same page: "Your position: N YES · 0 NO" with a `chain` tag.
- [ ] The YES price moved up from 50%.

## 9. Verify a trace

- [ ] Open `http://localhost:3000/reasoning/verify?onChainTraceId=1` and click **Begin verification**.
- [ ] Expected: the log shows `reasoning_registry.get_trace(1)`, the on-chain hash `38f728a8…`, then **Content unavailable**. The demo published that trace with the placeholder CID `ipfs://demo-trace-placeholder`, so no gateway can serve it. The page must not show any trace content.
- [ ] To see a **verified** result you need a trace whose content is really on IPFS: run the backend with Pinata keys and `CHAIN_EXECUTION_MODE=live` on testnet so it publishes one, then open `/reasoning/verify?traceId=<backend trace id>`. (Not yet done; see docs/STATUS.md.)
- [ ] For the hash check itself, `npm run e2e:testnet` (header of `e2e/testnet.e2e.test.ts`) verifies the demo trace's reconstructed bytes against the chain and rejects a tampered copy.

## 10. Disconnect

- [ ] Wallet menu → Disconnect. The button returns to **Connect Wallet**, and `oracledesk_token` is gone from Local Storage.

## 11. Low XLM and reserve check (fee preview)

- [ ] On testnet, connect with an account that has only ~1.5 XLM and a USDC trustline (or an account unfunded by Friendbot).
- [ ] Open `http://localhost:3000/markets/quick-view?onChainId=<market_id>`.
- [ ] Observe the fee preview line under the quote: `Network fee ≈ X XLM · spendable Y XLM` (hover for the inclusion + resource fee breakdown and network base reserve note).
- [ ] If unfunded: verify the message "Fund this account with XLM first." is displayed and the Buy button is disabled.
- [ ] If spendable XLM is below the total fee: verify the message "You need about X more XLM to pay the network fee." is displayed and the Buy button is disabled.
- [ ] Verify the same fee preview, spendable XLM display, and blocking warnings appear on `/copy-trade` (next to slippage text) and `/premium` (in the checkout modal above the pay button).

## Also worth clicking

- [ ] `/premium` → **Get a daily pass** → **Pay with wallet**. Freighter shows a USDC `transfer` to the treasury (`CBTFA3EP…`) for 0.50 USDC. After approval the backend verifies it on-chain and says the pass is active. Note: until `PAYMENTS_RECIPIENT` is decided, this payment becomes treasury trading capital (see docs/STATUS.md).
- [ ] `/copy-trade?marketId=<backend market id>&traceId=<trace id>`: the side comes from the trace's edge. With no trace or zero edge the confirm button is disabled and the page explains why.
- [ ] `/admin` with an address not in `NEXT_PUBLIC_ADMIN_ADDRESSES` shows "Access Denied".
- [ ] `/tx?hash=<64-hex>` inspects live ledger state and fee charged for any testnet transaction, falling back cleanly to Stellar Expert when outside RPC retention.
# Wallet reconciliation, market tape and inbox (#39–#42)

1. Connect a testnet wallet with XLM, a USDC trustline and test USDC. Open an
   **open** on-chain market in quick-view; record its position and the wallet
   dropdown balance. Buy, then confirm that contract-returned shares and
   deducted collateral appear with a transaction link and pending indicator.
   Matching reads clear the indicator. Repeat with a sell and a redemption,
   including a losing-side redemption with zero payout. Reject a signature
   and confirm both values remain unchanged. Make two consecutive buys and
   check that the second composes with the first. Disconnect while the RPC
   lags and verify the previous wallet's values do not reappear.
2. Open the same quick-view without a wallet. Its **Recent trades** table
   reads only that market's contract events. Check bigint USDC, shares, fee,
   YES price and movement against explorer events. Check trader/transaction
   links, including a contract trader. Send a trade on that market and check
   one live row appears; a later RPC refetch must replace it without a
   duplicate. A trade on a different market must not appear. Load older
   rows until the retention notice appears. With 2,000 fixture rows, verify
   fewer than 60 DOM rows and scroll to the oldest row.
3. Use wallets A and B in separate browser profiles. Trade as A; only A's
   **Notifications** page should receive a fill and increase the bell count.
   Mark it read explicitly, reload, and verify that it remains read. Switch
   wallets in the same browser and verify no previous-owner items flash.
   Disconnect: show the connect prompt and an empty bell. Check testnet and
   mainnet scopes separately if testing a second network build.
4. Publish reasoning on a market A holds and one it does not hold. Only the
   held market creates a reasoning item. Resolve or void a held seeded
   market; within a visible 60-second poll, a redeemable item links to it.
   Redeem and check the exact payout item. Reload with an already-resolved
   held market to check current-status detection outside event retention.
   Submit a transaction that remains pending or fails and verify its tracker
   item. Rejected signatures must not create submitted-transaction items.
5. Block IndexedDB in browser settings and reconnect. The inbox should work
   in memory and show **Notifications won't be saved in this browser**.
   Generate more than 500 items: read items should be pruned first and only
   the newest 200 should render. Nothing becomes read merely by rendering.
6. Run the simulator in CONTRIBUTING.md at 500/s and 50/s. Check feed bounds,
   a single burst summary, responsiveness and no console exceptions. Hide
   the tab during a burst, return, and check one catch-up and overflow notice
   instead of replayed animations. Enable OS reduced motion: ticker, pulse
   indicators and incoming trade rows must remain static.

These wallet-signing steps require a browser wallet and funded test account;
the automated suite does not submit financial transactions.

## 12. Multisig (2-of-3) export/import XDR

Needs a 2-of-3 testnet account with a USDC trustline and test USDC (step 4).
Use Stellar Lab (https://lab.stellar.org) plus Freighter, or two Freighter
profiles for the co-signers.

a. **Create the multisig account (Stellar Lab):**

- [ ] Create account C as the treasury `G…` (fund with Friendbot).
- [ ] Create signer accounts A and B (`G…`), fund each with Friendbot.
- [ ] In Lab → Transaction Builder, build `setOptions` from C with master weight 1, low 1, medium 2, high 2, adding A (weight 1) and B (weight 1). Sign with C and submit.
- [ ] Add the USDC trustline from C (changeTrust), then ask a maintainer to mint test USDC to C (step 4b).

b. **Prepare a buy (coordinator may be A, B or an outsider):**

- [ ] Connect with any wallet, open `/markets/quick-view?onChainId=<open market>`. The panel shows “This account needs multiple signatures” and offers “Prepare for multisig”.
- [ ] Check “Use multisig”, enter 10 USDC, click **Prepare for multisig**. A review shows the operation (`buy`), contract, `min_shares_out` (3% slippage from the ledger-N quote), fee, sequence, 1-hour expiry countdown and `0/2` progress.
- [ ] Click **Copy XDR**. The session persists in `sessionStorage` (`oracledesk_multisig_sessions`), so a reload during coordination doesn’t lose collected signatures.

c. **Collect two signatures out of band:**

- [ ] In Lab → Transaction → Sign (or Freighter “Sign transaction XDR”): paste the XDR, sign with A, copy the signed XDR. Paste it into **Import signed XDR** → Import. Progress shows `1/2`.
- [ ] Repeat with B. Progress shows `2/2` and **Submit** enables. An XDR signed by an unrelated key shows an “unknown signature” warning (it would fail with `tx_bad_auth_extra`).
- [ ] Tamper with fee/time bounds in Lab and import: the app rejects it (“does not match the prepared one”).

d. **Submit at threshold:**

- [ ] Click **Submit**. The app re-reads the account sequence (another transaction from C in the meantime fails with “Another transaction from this account changed the sequence”), checks `weight >= med`, submits via RPC and polls `getTransaction`.
- [ ] Let a prepared session expire (or prepare with a 20 s window in dev): submit fails with “This transaction expired before it was submitted. Prepare it again with a fresh quote.” (`tx_too_late`).
- [ ] Repeat for the daily-pass USDC `transfer` on `/premium`: check “Use multisig”, **Prepare multisig payment**, collect 2 signatures, submit. The backend `unlock` still verifies the transfer afterwards.
- [ ] If the market’s `close_time` passes first, the trade fails with MarketClosed (error 9); the review shows close time next to expiry and caps the window at close time.

## PWA / offline (#128)

1. `npm run build && npm start`, open http://localhost:3000 in Chrome. DevTools → Application → Manifest shows no errors; the install icon appears. Install on Chrome desktop and on Android Chrome.
2. Application → Service workers: `/sw.js?v=<id>` is active. Cache Storage `shell-<id>` holds routes and `/_next/static` files only.
3. Network → Offline. Navigate /markets, /portfolio, /reasoning: cached shell or the offline page, never the browser error page. Network tab: RPC/backend/socket.io requests are not "(ServiceWorker)".
4. Rebuild and restart, reload: the update banner appears; a buy fails with "Reload to update OracleDesk before signing." until Reload.
5. `npm run dev`: no worker is registered.

## Push notifications (#130)

Needs a backend implementing the contract in the PR description.
- Chrome / Firefox desktop: /settings → Notifications → Turn on (permission prompt, wallet sign-in). "Send test notification" shows a system notification. Trigger a trade/resolution: the notification opens /markets/quick-view?onChainId=…&from=push with the on-chain verified status.
- Android Chrome: same as desktop.
- iOS 16.4+: in Safari the panel says to add to Home Screen; after Share → Add to Home Screen, open from the icon and enable.
- Block notifications in site settings: the panel shows recovery copy.
- Disconnect or switch wallet: the subscription is removed (DevTools → Application → Push shows none).

## RPC failover (#126) and debug panel (#127)

- Set `NEXT_PUBLIC_STELLAR_RPC_URLS=https://invalid.example,https://soroban-testnet.stellar.org`, open `?debug=rpc`; block one host in DevTools and watch failover. A buy during the switch uses one host.
- `?debug=1` or Ctrl/Cmd+Shift+D opens the debug panel; "Copy diagnostics" previews redacted JSON.

## Market generation tracking (#78)

Needs a local backend with your wallet in `ADMIN_ADDRESSES` (and in `NEXT_PUBLIC_ADMIN_ADDRESSES`).
- /admin/create shows the explanation and a single **Start market-maker run** button: no question, category, expiry, liquidity or AI fields, no remote image. Double-clicking starts one run (one job row; DevTools → Network shows one `POST /markets/generate` with an `Idempotency-Key` and body `{}`).
- The row shows **Running** with a live elapsed time; the job events feed shows "Job … started …" and "Still running (…)". Requests to `/markets/generation-status/:jobId` go out every 5 s, every 15 s after two minutes.
- Reload mid-run: the row and its elapsed time come back from `localStorage` (`oracledesk_admin_jobs:stellar:testnet:<address>`), and polling resumes.
- On completion: **Completed**, the market question, **Open market** → `/markets/quick-view?marketId=…`, and the on-chain id. Polling stops. /admin's **Recent generation runs** lists it.
- With `CHAIN_MODE=dry-run` on the backend: the row says "Created in the database only. The backend is in dry-run mode or on-chain creation failed; check backend logs."
- Restart the backend while a job runs: the row becomes **Unknown** with the backend's message and a **Check recent markets** link; polling stops.
- A job id the backend never saw (or pruned after an hour on a long-running server): **Not tracked**, polling stops.
- Clear the JWT (`localStorage.removeItem("oracledesk_token")`) mid-run: the row says "Sign in again to keep tracking"; **Sign in** resumes polling.
- Start six runs within an hour: the counter reaches "5 of 5" and the sixth gets "The backend allows 5 runs per hour. Try again in …" with no new row.
- Open /admin/create in a second tab: a run started in one tab appears in the other. Switch to another admin wallet: only that wallet's runs show.

## x402 unlocks: recovery (#75) and cart (#76)

Needs a local x402 service (`contracts/oracledesk-stellar/x402`, `npm start`) behind the same origin or with CORS (see `docs/contract-requests.md` item 7), `NEXT_PUBLIC_X402_URL` pointing at it, a facilitator, a wallet with Soroban auth-entry signing (Freighter), and testnet USDC of the asset in the 402 (Circle testnet USDC by default).
- `/reasoning/detail?onChainTraceId=<id>` shows **Unlock for 0.01 USDC**. Unlock: one wallet prompt, then "Unlocked. The content matches the on-chain trace hash." DevTools → Application → IndexedDB → `oracledesk-x402` → `payments` holds the entry (`delivered`), with no trace content.
- Kill the service after the facilitator settles, then reload: the app-wide banner says a payment is waiting; the panel says "Your payment is saved…" with **Retry delivery**, never a new **Unlock for** button and never a new wallet prompt.
- Restart the service and **Retry delivery**: delivered without signing again (Network: the same `PAYMENT-SIGNATURE` value).
- Make the gateway serve other bytes for the CID: 502, nothing charged, the payment stays retryable.
- Leave a rejected payment until its "Valid until ledger" passes: the panel offers **Pay again (previous payment expired unpaid)**.
- Private window with storage blocked: the panel refuses to sign and says why.
- Two tabs on the same trace, click both: only one wallet prompt at a time.
- /reasoning: **Add to unlock list** on three locked traces, open **Unlock list (3)**: each row gets its price from the 402. Start checkout: three prompts, one after another. Raise `TRACE_PRICE_USDC` mid-run: the run pauses with accept / accept for all / skip. Kill the service on the second item: the receipt marks it failed and flags it; reopening that trace retries delivery without paying. **Download receipt (JSON)** totals equal the sum of paid amounts.
- With a total at or above the daily-pass price, the drawer recommends a daily pass and links to /premium.
- `NEXT_PUBLIC_X402_URL` empty: no cart, no unlock list buttons, no panel, no banner.
