#!/usr/bin/env node
/**
 * CI guard for issue #49: no production source may link to a retired demo
 * route. The canonical list lives in lib/demo/retired-routes.ts (its tests
 * assert that this script lists exactly the same paths); this script scans
 * app/, components/ and lib/ — excluding the registry itself and the design
 * gallery, which legitimately mention the old paths — and fails on any hit.
 *
 * Run: node scripts/check-demo-links.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RETIRED = [
  "/wallet-demo",
  "/buy-yes-demo",
  "/buy-no-demo",
  "/execution-terminal",
  "/transaction-status",
  "/transaction-success",
  "/transaction-failed",
];

const ROOTS = ["app", "components", "lib"];
/** Paths (relative, posix-style prefixes) allowed to mention retired routes. */
const ALLOWED_PREFIXES = ["lib/demo/", "app/dev/gallery/"];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(file) {
  return relative(ROOT, file).split(sep).join("/");
}

const offenders = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const relPath = rel(file);
    if (ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) continue;
    const content = readFileSync(file, "utf8");
    const hits = RETIRED.filter((path) => content.includes(path));
    if (hits.length > 0) offenders.push({ file: relPath, hits });
  }
}

if (offenders.length > 0) {
  console.error("Production sources must not link to retired demo routes (issue #49).");
  console.error("Their UI lives in the design gallery (/dev/gallery, gated by NEXT_PUBLIC_ENABLE_DEMO_ROUTES).");
  for (const { file, hits } of offenders) {
    console.error(`  ${file}: ${hits.join(", ")}`);
  }
  process.exit(1);
}

console.log(`OK: no production source links to a retired demo route (${RETIRED.length} routes checked).`);
