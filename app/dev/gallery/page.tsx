import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge } from "@/components/ui/demo-badge";
import { WalletDemoScreen } from "@/components/demo/screens/wallet-demo-screen";
import { BuyYesDemoScreen } from "@/components/demo/screens/buy-yes-demo-screen";
import { BuyNoDemoScreen } from "@/components/demo/screens/buy-no-demo-screen";
import { ExecutionTerminalScreen } from "@/components/demo/screens/execution-terminal-screen";
import { RETIRED_DEMO_ROUTES, RETIRED_REDIRECT_ONLY } from "@/lib/demo/retired-routes";

/**
 * Design gallery for the demo screens retired from production (issue #49).
 *
 * The seven standalone demo routes are gone from `app/`; their UI lives in
 * `components/demo/` and only renders here, when the build explicitly sets
 * NEXT_PUBLIC_ENABLE_DEMO_ROUTES. The page is noindex, and old URLs redirect
 * to real destinations via `next.config.ts`.
 */
export const metadata: Metadata = {
  title: "OracleDesk design gallery (demo only)",
  robots: { index: false, follow: false },
};

function demosEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_ENABLE_DEMO_ROUTES;
  return value === "1" || value === "true";
}

function Stage({ title, path, children }: { title: string; path: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <header className="px-6 py-4 border-b border-outline-variant flex flex-wrap items-center justify-between gap-2 bg-surface-container-low">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
          <p className="font-data-mono text-[11px] text-on-surface-variant">retired route: {path}</p>
        </div>
        <DemoBadge />
      </header>
      {children}
    </section>
  );
}

export default function DevGalleryPage() {
  if (!demosEnabled()) notFound();

  return (
    <main className="flex-grow pt-8 pb-20 px-gutter max-w-container-max-width mx-auto w-full">
      <header className="mb-10">
        <span className="font-label-caps text-label-caps text-on-surface-variant border border-outline-variant px-3 py-1 rounded-full mb-4 inline-block">
          INTERNAL · NOT INDEXED
        </span>
        <h1 className="font-headline-md text-headline-md text-on-surface mb-2">Design Gallery</h1>
        <p className="text-body-md text-on-surface-variant max-w-2xl">
          Every screen below is a demo with sample data, kept for layout reference only. These routes used to ship as
          standalone pages in production; they now render only here, behind{" "}
          <span className="font-data-mono text-data-mono">NEXT_PUBLIC_ENABLE_DEMO_ROUTES</span>.
        </p>
      </header>

      <div className="space-y-10">
        <Stage title="Wallet dropdown panel" path="/wallet-demo">
          <WalletDemoScreen />
        </Stage>
        <Stage title="Buy YES confirmation sheet" path="/buy-yes-demo">
          <BuyYesDemoScreen />
        </Stage>
        <Stage title="Buy NO confirmation sheet" path="/buy-no-demo">
          <BuyNoDemoScreen />
        </Stage>
        <Stage title="Execution terminal sheet" path="/execution-terminal">
          <ExecutionTerminalScreen />
        </Stage>

        <section className="bg-white border border-outline-variant rounded-xl shadow-sm p-6">
          <h2 className="font-headline-sm text-headline-sm text-on-surface mb-2">Retired redirect stubs</h2>
          <p className="text-body-md text-on-surface-variant mb-4">
            {RETIRED_REDIRECT_ONLY.join(", ")} were already redirect-only pages pointing at <code>/tx</code>. They had
            no UI to preserve; the old URLs now redirect there from the server config.
          </p>
          <ul className="space-y-1 text-sm text-on-surface-variant">
            {RETIRED_DEMO_ROUTES.filter((route) => RETIRED_REDIRECT_ONLY.includes(route.path)).map((route) => (
              <li key={route.path} className="font-data-mono text-[12px]">
                {route.path} → {route.redirectTo}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-10 text-sm text-on-surface-variant">
        Looking for the real app? <Link href="/markets" className="text-primary underline">Browse markets</Link>.
      </p>
    </main>
  );
}
