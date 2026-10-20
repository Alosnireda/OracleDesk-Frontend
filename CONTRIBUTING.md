# Contributing to the OracleDesk frontend

Thanks for helping. This is a testnet-only, unaudited project; see
[docs/STATUS.md](docs/STATUS.md) for what works today.

## Setup

```bash
git clone --recurse-submodules https://github.com/OracleDesk/OracleDesk-Frontend.git
cd OracleDesk-Frontend
nvm use            # Node 22 (see .nvmrc)
npm ci
cp .env.example .env.local
npm run dev
```

Forgot `--recurse-submodules`? Run `git submodule update --init`.

## Branches and commits

- Branch names: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`.
- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `test:`, `chore:`, `refactor:`. One logical change per
  commit.
- No force-pushes to shared branches.

## Checks (CI runs exactly these)

```bash
npm run check:bindings   # generated contract code matches the submodule
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run e2e:testnet` is an optional, read-only check against a running
backend and live testnet; see the header of `e2e/testnet.e2e.test.ts`.

## Measuring realtime feeds

Use separate terminals:

```bash
node scripts/realtime-burst.mjs --manual --port 4310
NEXT_PUBLIC_API_URL=http://localhost:4310/api/v1 npm run dev
```

Open `/markets?profile=1` or `/?profile=1` and keep that tab visible.
Development-only React Profiler logs `[realtime-profile]`, the component
name, commit count and total `actualDuration` every second. Let the page
settle, then trigger each sample from another terminal:

```bash
curl 'http://localhost:4310/burst?count=500&rate=500'
# Wait for completion before starting the next sample.
curl 'http://localhost:4310/burst?count=500&rate=50'
```

Sum logged intervals covering each burst and its final settling interval.
Use the same browser, viewport and animation preference for both revisions.
For a baseline, instrument the original feed with the same profiler wrapper;
the original feeds need no functional changes. Profiler time measures React
render work, not socket validation, paint, or end-to-end latency. Slow
baselines may coalesce events under load, so fewer commits alone do not
prove better responsiveness. Production ignores `?profile=1`.

The simulator serves an empty market API and emits synthetic public trades;
it never signs or submits transactions. `--count`, `--rate` and `--port` also
configure its automatic burst (omit `--manual` to emit after the first
connection). See [docs/STATUS.md](docs/STATUS.md) for measured results.

## When the contracts change

The contracts live in
[OracleDesk-SmartContract](https://github.com/OracleDesk/OracleDesk-SmartContract)
and are the source of truth. This repo pins them as the `contracts`
submodule and copies the generated code into `lib/stellar/generated/`.

```bash
git -C contracts fetch origin
git -C contracts checkout <new commit>
npm run sync:bindings
npm run typecheck && npm test   # the Category exhaustiveness check fails here if the enum changed
git add contracts lib/stellar/generated
```

Never edit `lib/stellar/generated/` by hand. If you think a contract needs
to change, write it up in [docs/contract-requests.md](docs/contract-requests.md)
and open the issue in the contracts repo.

### x402 contract tests

`e2e/x402/` runs the frontend's x402 client (`lib/x402/client.ts`) against the
real trace service from the submodule (`x402/trace-api.ts`), fully offline: a
stub facilitator (`e2e/x402/stub-facilitator.ts`) checks the signed payment,
a fake gateway serves the fixtures in `e2e/x402/fixtures/traces/`, the Soroban
RPC is answered in-process, and any connection to a non-loopback host fails.
CI runs it as the `x402-contract` job.

```bash
npm ci --ignore-scripts --prefix contracts/oracledesk-stellar/x402   # the service's own dependencies
npm run check:x402       # frontend and service resolve the same @x402/* versions
npx tsc -p e2e/x402      # typecheck the harness (kept out of the app's tsconfig)
npm run e2e:x402
```

When the submodule moves:

1. Run `npm ci --ignore-scripts --prefix contracts/oracledesk-stellar/x402`, then `npm run check:x402`. If the service now resolves
   different `@x402/*` versions, pin the frontend to exactly those
   (`npm install --save-exact @x402/core@<v> @x402/stellar@<v>`) and read
   the release notes for header, payload or settlement-flow changes.
2. Run `npm run e2e:x402`. "contracts/x402 API changed: update
   e2e/x402/harness.ts and the frontend client" means `createTraceApi` or
   `MapTraceRepository` moved or changed shape: adapt `e2e/x402/harness.ts`,
   then `lib/x402/client.ts` if the wire format changed.
3. If the service's trace format changes, regenerate the fixture with the
   submodule's `agents/core/trace.ts` `buildTrace` (canonical JSON) and update
   `FIXTURE_TRACE_HASH` in `e2e/x402/harness.ts` to its sha256.

## Working on a Drips Wave issue

This repo takes part in [Drips Wave](https://docs.drips.network/wave/).
Per the current Drips docs:

1. Find the issue on the Drips Wave **Explore** page (or in this repo's
   issues once a maintainer has added it to a Wave).
2. **Apply** for it on Drips. Don't start coding until a maintainer assigns
   you; the issue isn't yours before that.
3. Open a PR that links the issue (`Closes #123`).
4. Points are earned when the PR is merged and the issue is marked resolved
   **before the Wave ends**. Complexity (Trivial 100 / Medium 150 /
   High 200 points) is set by the maintainer; if an issue turns out harder
   than labelled, say so on the issue before it's resolved.

Drips also limits how many issues one person can be assigned per
organization in a Wave; check the Drips docs for the current numbers.
Issue drafts live in [docs/wave-issues/](docs/wave-issues/) before they're
filed.

## What a good PR includes

- A short description and the issue it closes.
- All checks above passing locally.
- Screenshots or a short recording for any UI change.
- Tests for new logic (`lib/**` especially), and updated docs
  (`docs/api.md` is owned by the backend; change it there first).
- UI copy in plain sentence case, from the user's point of view. Don't
  claim anything the app doesn't do; label sample data as demo data.
- Amounts as `bigint` in 7-decimal USDC base units
  (`lib/stellar/units.ts`), never floats, for anything that reaches a
  transaction.

## Never commit secrets

No `.env*` files (only `.env.example`), no Stellar secret seeds (`S…`), no
API keys. Every `NEXT_PUBLIC_*` variable ends up in browser JavaScript, so a
secret must never go in one. If you commit a secret by accident, tell a
maintainer privately (see [SECURITY.md](SECURITY.md)) so it can be rotated;
removing it in a later commit is not enough.
