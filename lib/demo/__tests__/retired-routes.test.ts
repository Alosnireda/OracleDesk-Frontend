import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RETIRED_DEMO_PATHS,
  RETIRED_DEMO_ROUTES,
  RETIRED_REDIRECT_ONLY,
  referencesRetiredRoutes,
} from "../retired-routes";

/** Real app routes that exist in this repo (post-retirement). */
const REAL_ROUTES = new Set([
  "/",
  "/markets",
  "/markets/quick-view",
  "/markets/terminal",
  "/reasoning",
  "/reasoning/detail",
  "/reasoning/verify",
  "/portfolio",
  "/portfolio/analytics",
  "/portfolio/wallets",
  "/premium",
  "/premium/trace",
  "/copy-trade",
  "/stats",
  "/settings",
  "/notifications",
  "/tx",
  "/dev/gallery",
]);

describe("RETIRED_DEMO_ROUTES", () => {
  it("covers exactly the seven retired demo routes", () => {
    expect(RETIRED_DEMO_ROUTES).toHaveLength(7);
    expect([...RETIRED_DEMO_PATHS].sort()).toEqual(
      [
        "/buy-no-demo",
        "/buy-yes-demo",
        "/execution-terminal",
        "/transaction-failed",
        "/transaction-status",
        "/transaction-success",
        "/wallet-demo",
      ].sort(),
    );
  });

  it("redirects every old URL to a real, non-retired destination", () => {
    for (const route of RETIRED_DEMO_ROUTES) {
      expect(REAL_ROUTES.has(route.redirectTo), `${route.path} → ${route.redirectTo}`).toBe(true);
      expect(RETIRED_DEMO_PATHS.includes(route.redirectTo), `${route.path} loops back to a demo route`).toBe(false);
    }
  });

  it("redirects the transaction stubs to the real /tx page", () => {
    for (const path of RETIRED_REDIRECT_ONLY) {
      const route = RETIRED_DEMO_ROUTES.find((r) => r.path === path);
      expect(route?.redirectTo, path).toBe("/tx");
    }
  });
});

describe("referencesRetiredRoutes", () => {
  it("finds retired paths in hrefs, pushes and strings with suffixes", () => {
    expect(referencesRetiredRoutes('<Link href="/wallet-demo">x</Link>')).toEqual(["/wallet-demo"]);
    expect(referencesRetiredRoutes('router.push("/buy-yes-demo?side=YES")')).toEqual(["/buy-yes-demo"]);
    expect(referencesRetiredRoutes('href={"/execution-terminal"}')).toEqual(["/execution-terminal"]);
    expect(
      referencesRetiredRoutes("a /transaction-status and a /transaction-failed link"),
    ).toEqual(["/transaction-status", "/transaction-failed"]);
  });

  it("ignores clean sources and non-route substrings", () => {
    expect(referencesRetiredRoutes('<Link href="/markets">Markets</Link>')).toEqual([]);
    expect(referencesRetiredRoutes("no links here")).toEqual([]);
  });
});

describe("scripts/check-demo-links.mjs", () => {
  const script = readFileSync(
    fileURLToPath(new URL("../../../scripts/check-demo-links.mjs", import.meta.url)),
    "utf8",
  );

  it("checks exactly the retired route list, so the CI guard cannot drift", () => {
    const listed = [...script.matchAll(/^\s+"(\/[a-z-]+)",$/gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...RETIRED_DEMO_PATHS].sort());
  });

  it("scans production sources and skips only the registry and gallery", () => {
    expect(script).toContain('const ROOTS = ["app", "components", "lib"];');
    expect(script).toContain('"lib/demo/"');
    expect(script).toContain('"app/dev/gallery/"');
    expect(script).toContain("process.exit(1)");
  });
});
