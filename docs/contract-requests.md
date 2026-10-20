# Requests for the contracts repo

Things this repo would like changed in
[OracleDesk-SmartContract](https://github.com/OracleDesk/OracleDesk-SmartContract)
(`oracledesk-stellar/`). The frontend works around each one; none of them
block the port. File them there, not here.

## 1. Doc fix: wrong path to the FPMM TypeScript port

`docs/frontend-integration.md` line 73 says the sell-side math lives at
`agents/core/src/fpmm.ts`. The file is `agents/core/fpmm.ts` (there is no
`src/` directory under `agents/core`).

Verified with:

```bash
ls contracts/oracledesk-stellar/agents/core/src   # No such file or directory
ls contracts/oracledesk-stellar/agents/core/fpmm.ts
```

## 2. Publish the FPMM math with the bindings

`agents/core/fpmm.ts` is the only TypeScript implementation of the
contract's pricing math, and every client that wants `priceYesBps` or
"sell N shares" needs it. Today each consumer copies it out of `agents/`
(this repo does so in `scripts/sync-bindings.mjs`). Shipping it as part of a
bindings package, or as a tiny `@oracledesk/fpmm` package, would give it a
version number and remove the copy step.

## 3. A way to get test USDC

`deployments/testnet.json` points at a self-issued test USDC: the classic
asset `USDC:<deployer G-address>` wrapped in a Stellar Asset Contract
(`scripts/deploy-testnet.sh`, `stellar contract asset deploy`). A tester's
account needs a trustline to that asset, and only the deployer key can
`mint`. There is no faucet, so a new tester cannot get collateral without
asking a maintainer to mint by hand. A small, rate-limited
faucet script (or an admin `mint` helper in `scripts/`) would make the manual
test plan in `docs/manual-test.md` self-serve.

## 4. Export `ResolutionSpec` in the resolver bindings

The resolver contract hashes `ResolutionSpec` (an enum wrapping
`PriceConfig` or `SignerConfig`), but because no entrypoint takes it as an
argument it is not in the generated TypeScript. Off-chain code that needs
the commitment hash has to rebuild the XDR by hand. A no-op view function
that takes a `ResolutionSpec`, or a `spec_hash(spec) -> BytesN<32>` view,
would put the type in the spec and let clients ask the contract for the
hash instead of re-implementing it.

## 5. Add a share-budget sell quote

The frontend converts "sell N shares" into `collateral_out` by binary-searching
the contract's integer-rounded `calc_sell` math, then confirms the result with
`quote_sell`. A view such as `quote_sell_shares(market_id, outcome, shares) ->
{ collateral_out, shares_in }` would provide the exact inversion on-chain and
avoid repeated local work and quote simulations.

## 6. Expose treasury per-market exposure and the paused flag

The `/portfolio` risk panel reads `get_config`, `daily_usage` and
`available_capital` from the treasury. Two facts it would also show are only
reachable from raw storage today: how much of `max_market` a market has used
(`DataKey::Market(u64)` → `MarketExposure { amount, open }`), and whether the
treasury is paused. Read-only getters `market_exposure(market_id) ->
MarketExposure` and `paused() -> bool` would let the frontend show both
without reading storage keys that the contract may change.

## 7. x402 trace service: safe redelivery, CORS and an explicit asset

The frontend journals every signed x402 payment and redelivers the same
`PAYMENT-SIGNATURE` header after a failure (`lib/x402/recovery.ts`,
`docs/architecture.md`). Checked against `x402/trace-api.ts` and the pinned
`@x402/express` 2.26.0 (`e2e/x402` pins this behaviour):

- **Keep settling only after the trace is loaded and verified.** The Stellar
  `exact` scheme's default `authorization` flow already verifies before the
  handler and settles only when it answered below 400, so a 502 (gateway down,
  hash mismatch) or 404 charges nothing. Please keep that explicit (don't set
  `extra.paymentFlow: "upfront"`) so an upgrade can't start charging for 502s.
- **Accept a settled payment's header as proof of entitlement for a short
  window** (or cache delivery by payment id). Today a replayed header after
  settlement is re-verified, the consumed nonce fails, and the client gets a
  402: a buyer whose response was lost after `/settle` (disconnect, reload)
  has paid and cannot get the trace without paying again. Caching
  `{ payer, nonce } → traceId` for e.g. 24 hours and serving the trace for a
  matching header would let the client redeliver.
- **Send CORS headers.** The browser calls the service cross-origin with a
  custom request header, so it needs a preflight answer allowing
  `PAYMENT-SIGNATURE` and `Accept`, and `Access-Control-Expose-Headers:
  PAYMENT-REQUIRED, PAYMENT-RESPONSE` on responses. Without them the browser
  can't read the 402 requirements or the settlement hash, and in-app unlocks
  only work behind a same-origin proxy.
- **Price in an explicit asset.** `price: "0.01"` resolves to
  `@x402/stellar`'s default asset, Circle's testnet USDC SAC
  (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`), not the
  self-issued USDC in `deployments/testnet.json` that the markets use. Passing an
  `AssetAmount` (`{ amount, asset }`) would make the charged asset a
  deliberate choice, and testers would need only one test USDC.
