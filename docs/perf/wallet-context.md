# Wallet context and quick-view render performance

Measurements for the wallet-context split and the quick-view buy-ticket
extraction.

## What changed

`WalletProvider` used to publish one context value. The value was a fresh
object literal on every provider render, so React re-rendered **every**
`useWallet()` consumer whenever anything in the wallet changed — a kit event
that carried the same address, an error being set or cleared, `isConnecting`
toggling around `openModal()`.

The provider now publishes six memoized slices (identity, network, session,
signer, actions, meta), and the hot consumers read only the slice they need.

The quick-view modal used to hold the amount input, the debounced quote, the
buy mutation and the trade review in the same component as the modal header,
the sparkline and the AI insight. Typing one character re-rendered all of it.
The buy form is now `components/market/buy-ticket.tsx`.

## How the numbers were taken

Two ways, both reproducible:

1. **Automated (the numbers below).** `components/__tests__/render-counts.test.tsx`
   renders the real `BuyTicket` under a real `WalletProvider` with a scripted
   fake kit, and wraps each subtree in a React `Profiler`. React only runs a
   Profiler's callback when the profiled subtree actually rendered, so the
   commit count is the number of renders of that subtree. The chain reads are
   stubbed: this measures render isolation, not contract calls.

   ```
   npx vitest run --project dom components/__tests__/render-counts.test.tsx
   ```

2. **In the browser.** `lib/dev/profiler.tsx` wraps the quick-view content,
   the wallet dropdown and the copy-trade content in a `Profiler` that logs
   `[wallet-profile] <id> <phase> actual=…ms base=…ms` to the console. It is
   a no-op in production. For a browser check, open React DevTools → Profiler
   → record, run the scenario, and read the commit counts and durations for
   the `quick-view`, `wallet-dropdown` and `copy-trade` entries. Use the same
   browser, viewport and animation preference for the before and the after.

## Scenario 1: typing 10 characters in the quick-view amount field

| Subtree | Commits after mount | Commits after 10 keystrokes | Change |
|---|---|---|---|
| Buy ticket | 3 | 13 | **+10** (one per keystroke) |
| Modal header (sibling) | 1 | 1 | 0 |
| Identity slice probe | 2 | 2 | 0 |
| Network slice probe | 1 | 1 | 0 |
| Session slice probe | 1 | 1 | 0 |
| Actions slice probe | 1 | 1 | 0 |

**Before:** the amount input lived in `MarketQuickViewContent` together with
the modal header, the sparkline, the YES/NO buttons, the AI insight and the
trade tape. One keystroke re-rendered that whole subtree — one commit of a
352-line component, with every quote, position, balance and fee read in it.

**After:** one keystroke is one commit of the buy ticket alone. The header,
the sparkline, the YES/NO buttons and the AI insight do not re-render at all.

## Scenario 2: switching the connected account

| Subtree | Commits before | Commits after | Change |
|---|---|---|---|
| Buy ticket | 13 | 14 | +1 (the signer changed, so the ticket needs it) |
| Modal header (sibling) | 1 | 1 | 0 |
| Identity slice probe | 2 | 3 | +1 (the address changed) |
| Network slice probe | 1 | 2 | +1 (the network was reported for the first time) |
| Session slice probe | 1 | 1 | 0 |
| Actions slice probe | 1 | 1 | **0** (the action identities never change) |

**Before:** `openModal`, `ensureSession` and `disconnect` were recreated
whenever the provider rendered, because they were closures over the address,
the session and the router. Every consumer of `useWallet()` re-rendered with
them, whether or not it used an action.

**After:** the actions are created once and read the interpreter's current
state when they are called, so their identities are stable for the lifetime
of the provider. A component that only needs `openModal` does not re-render
when the account changes.

## Scenario 3: signing in (the session slice changes)

| Subtree | Commits before | Commits after | Change |
|---|---|---|---|
| Buy ticket | 14 | 14 | 0 |
| Session slice probe | 1 | 2 | +1 (the session changed) |

The buy ticket does not read the session slice, so signing in does not
re-render it. A component that does read the session (`useWalletSession`)
re-renders exactly once.

## Scenario 4: the kit repeats the same address and network

`KIT_STATE_UPDATED` with the values the provider already has now keeps the
**same state object**, so `useSyncExternalStore` bails out and nothing
re-renders at all. The state machine tests in
`lib/stellar/__tests__/wallet-slices.test.ts` pin this: the same event
before the change produced a new state object on every kit event.

## Browser procedure for the remaining scenarios

| Scenario | How to drive it | What to look for |
|---|---|---|
| Wallet connect | Click "Connect Wallet" in the navbar | `wallet-dropdown` and `quick-view` commit once each; the `actions` slice does not change identity |
| Sign-in | Complete the SEP-10 challenge | `session` changes; `quick-view` does not re-render unless it reads the session slice |
| A buy | Buy on testnet with a small amount | `quick-view` commits once per phase; the header does not |
| Typing 10 characters | Type in the quick-view amount field | `quick-view` commits 10 times, the siblings 0 times |

## Reading the numbers

React's `actualDuration` measures render work, not paint or network time. A
commit count of zero for a subtree means React never rendered it, which is
the property this change is about: the wallet no longer re-renders parts of
the app that do not depend on it.
