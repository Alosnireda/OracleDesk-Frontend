// Run with: node --test scripts/__tests__/
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../build-sw-manifest.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "next");

test("reads build id, static routes and every chunk", () => {
  const m = buildManifest(fixture);
  assert.equal(m.buildId, "abc123");
  assert.deepEqual(m.routes, ["/", "/markets", "/offline"]);
  assert.deepEqual(m.assets, [
    "/_next/static/chunks/app/wallet-kit-2.js",
    "/_next/static/chunks/main-1.js",
    "/_next/static/css/a.css",
  ]);
});
