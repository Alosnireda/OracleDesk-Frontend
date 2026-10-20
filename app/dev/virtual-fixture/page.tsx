import { notFound } from "next/navigation";
import { FixtureClient } from "./fixture-client";
import { generateSyntheticMarkets } from "@/lib/dev/fixtures";

export default function VirtualFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const markets = generateSyntheticMarkets(2000);

  return (
    <main className="min-h-screen bg-surface pt-20 pb-16 px-gutter max-w-container-max-width mx-auto">
      <div className="mb-8">
        <h1 className="font-display-lg text-display-lg text-on-surface">2,000-Market Virtualization Fixture</h1>
        <p className="text-on-surface-variant font-body-md mt-2">
          Deterministic benchmark fixture for windowed rendering vs plain DOM mapping with 2,000 items.
        </p>
      </div>

      <FixtureClient markets={markets} />
    </main>
  );
}
