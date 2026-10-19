/**
 * The demo-only routes retired from production by issue #49.
 *
 * These seven routes used to ship as first-class pages: prerendered,
 * publicly reachable and each carrying its own fake navbar/footer. They are
 * gone from `app/`; the UI worth keeping lives in `components/demo/`, old
 * URLs redirect via `next.config.ts`, and `scripts/check-demo-links.mjs` (CI)
 * fails if a production source links to one of these paths again.
 */

export interface RetiredRoute {
  /** The old route path. */
  path: string;
  /** Where the old URL now permanently redirects. */
  redirectTo: string;
  /** Human title for the gallery entry and CI output. */
  title: string;
}

export const RETIRED_DEMO_ROUTES: readonly RetiredRoute[] = [
  { path: "/wallet-demo", redirectTo: "/portfolio/wallets", title: "Wallet dropdown panel" },
  { path: "/buy-yes-demo", redirectTo: "/markets", title: "Buy YES confirmation sheet" },
  { path: "/buy-no-demo", redirectTo: "/markets", title: "Buy NO confirmation sheet" },
  { path: "/execution-terminal", redirectTo: "/markets", title: "Execution terminal sheet" },
  { path: "/transaction-status", redirectTo: "/tx", title: "Transaction status" },
  { path: "/transaction-success", redirectTo: "/tx", title: "Transaction success" },
  { path: "/transaction-failed", redirectTo: "/tx", title: "Transaction failed" },
] as const;

export const RETIRED_DEMO_PATHS: readonly string[] = RETIRED_DEMO_ROUTES.map((route) => route.path);

/**
 * Returns the retired paths referenced anywhere in `text` (hrefs, router
 * pushes, string literals). Plain substring matching on purpose: every path
 * is distinctive, and `includes` also catches `?query` and `#hash` suffixes.
 */
export function referencesRetiredRoutes(text: string): string[] {
  return RETIRED_DEMO_PATHS.filter((path) => text.includes(path));
}

/**
 * The two transaction-status pages were already redirect stubs pointing at
 * /tx; nothing of them survived to the gallery. Kept here so the gallery can
 * explain where they went.
 */
export const RETIRED_REDIRECT_ONLY: readonly string[] = [
  "/transaction-status",
  "/transaction-success",
  "/transaction-failed",
];
