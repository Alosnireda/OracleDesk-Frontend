// Run with: node --test scripts/__tests__/
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareX402Versions } from "../check-x402-versions.mjs";

const lock = (versions) => ({
  packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])),
});
const frontendPackage = { dependencies: { "@x402/core": "2.26.0", "@x402/stellar": "2.26.0" } };
const same = lock({ "@x402/core": "2.26.0", "@x402/stellar": "2.26.0", "@x402/express": "2.26.0" });

test("passes when both sides resolve the same exact versions", () => {
  assert.deepEqual(compareX402Versions({ frontendPackage, frontendLock: same, serviceLock: same }), []);
});

test("fails when the resolved versions differ", () => {
  const serviceLock = lock({ "@x402/core": "2.27.0", "@x402/stellar": "2.26.0", "@x402/express": "2.27.0" });
  assert.deepEqual(compareX402Versions({ frontendPackage, frontendLock: same, serviceLock }), [
    "@x402/core: frontend resolves 2.26.0, the contracts service resolves 2.27.0",
  ]);
});

test("fails on a caret range in the frontend package.json", () => {
  const problems = compareX402Versions({
    frontendPackage: { dependencies: { ...frontendPackage.dependencies, "@x402/stellar": "^2.26.0" } },
    frontendLock: same,
    serviceLock: same,
  });
  assert.match(problems[0], /@x402\/stellar is declared as "\^2.26.0"/);
});

test("fails when a package is missing on either side", () => {
  const problems = compareX402Versions({ frontendPackage, frontendLock: lock({ "@x402/core": "2.26.0" }), serviceLock: same });
  assert.deepEqual(problems, ["@x402/stellar is missing from package-lock.json"]);
});
