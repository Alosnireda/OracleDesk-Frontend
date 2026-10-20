#!/usr/bin/env node
/**
 * CI guard for issue #77: the frontend's x402 client and the contracts repo's
 * x402 trace service must run the exact same @x402/* release, because they
 * agree on a wire protocol neither side owns. Compares the versions each
 * lockfile resolves, and requires the frontend to pin them without a range.
 *
 * Run: node scripts/check-x402-versions.mjs   (npm run check:x402)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Packages both sides depend on: the protocol core and the Stellar scheme. */
export const SHARED_PACKAGES = ["@x402/core", "@x402/stellar"];
export const SERVICE_DIR = "contracts/oracledesk-stellar/x402";

const resolved = (lock, name) => lock?.packages?.[`node_modules/${name}`]?.version ?? null;

/** Returns a list of problems; empty when the versions agree. */
export function compareX402Versions({ frontendPackage, frontendLock, serviceLock }) {
  const problems = [];
  for (const name of SHARED_PACKAGES) {
    const declared = frontendPackage.dependencies?.[name];
    const frontend = resolved(frontendLock, name);
    const service = resolved(serviceLock, name);
    if (!declared) problems.push(`${name} is not a frontend dependency`);
    else if (!/^\d+\.\d+\.\d+$/.test(declared)) problems.push(`${name} is declared as "${declared}" in package.json; pin an exact version`);
    if (!frontend) problems.push(`${name} is missing from package-lock.json`);
    if (!service) problems.push(`${name} is missing from ${SERVICE_DIR}/package-lock.json`);
    if (frontend && service && frontend !== service) problems.push(`${name}: frontend resolves ${frontend}, the contracts service resolves ${service}`);
  }
  // The service's server middleware must be the same release as its core.
  const express = resolved(serviceLock, "@x402/express");
  const serviceCore = resolved(serviceLock, "@x402/core");
  if (express && serviceCore && express !== serviceCore) problems.push(`@x402/express ${express} and @x402/core ${serviceCore} differ in the contracts service`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  let problems;
  try {
    problems = compareX402Versions({
      frontendPackage: json("package.json"),
      frontendLock: json("package-lock.json"),
      serviceLock: json(`${SERVICE_DIR}/package-lock.json`),
    });
  } catch (error) {
    problems = [`couldn't read a lockfile (is the contracts submodule checked out?): ${error.message}`];
  }
  if (problems.length) {
    console.error("x402 versions differ between the frontend and the contracts service:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("Pin the frontend's @x402/* to the versions in the submodule's lockfile (npm install --save-exact).");
    process.exit(1);
  }
  console.log(`x402 versions match: ${SHARED_PACKAGES.map((name) => `${name}@${resolved(json("package-lock.json"), name)}`).join(", ")}`);
}
