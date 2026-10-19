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
