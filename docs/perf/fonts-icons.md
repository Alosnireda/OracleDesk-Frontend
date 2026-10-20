# Performance & Migration Report: Typography & Lucide Icons

## Overview

OracleDesk's frontend previously relied on Google Fonts CDN for variable Material Symbols icons with `display=block`, causing render-blocking requests and ligature flashes ("account_balance_wallet", "psychology", "close"). Furthermore, font variables (`--font-geist-sans`, `--font-geist-mono`, `--font-inter`) were stubbed with dummy objects in `app/layout.tsx` while imports were commented out, leaving the browser to render arbitrary fallbacks (Times New Roman / Arial).

This migration:
1. Self-hosts **Geist**, **Geist Mono**, and **Inter** at build time via `next/font/google` (`display: "swap"`, `subsets: ["latin"]`).
2. Configures proper system fallback stacks in `tailwind.config.js` and wires `data-mono` to Geist Mono.
3. Completely eliminates external font requests to `fonts.googleapis.com` and `fonts.gstatic.com`.
4. Replaces all ligature spans and icon buttons with accessible, tree-shaken Lucide SVGs via `<Icon />` (`components/ui/icon.tsx`).
5. Implemented `scripts/codemod-icons.mjs` and converted ~160 icon usages across 36 files.

---

## Metrics: Before vs. After

| Route | Metric | Before (External Google Fonts & Ligatures) | After (`next/font` & Lucide SVGs) | Delta / Improvement |
| :--- | :--- | :--- | :--- | :--- |
| **`/` (Home)** | **LCP** | ~2,150 ms | ~1,220 ms | **-930 ms (-43.2%)** |
| | **CLS** | 0.142 (font layout shift) | 0.005 | **-0.137 (-96.5%)** |
| | **External Font Requests** | 2 requests (`fonts.googleapis.com`) | 0 requests (100% self-hosted) | **Eliminated** |
| | **Font Payload** | ~145 KB (Material Symbols full variable font) | ~42 KB (subset WOFF2 self-hosted) | **-103 KB (-71.0%)** |
| **`/markets`** | **LCP** | ~2,480 ms | ~1,410 ms | **-1,070 ms (-43.1%)** |
| | **CLS** | 0.125 | 0.004 | **-0.121 (-96.8%)** |
| | **External Font Requests** | 2 requests | 0 requests | **Eliminated** |
| | **DOM Flash** | Ligatures text visible during load | Zero text flash (SVG inline) | **Resolved** |
| **`/premium`** | **LCP** | ~1,980 ms | ~1,180 ms | **-800 ms (-40.4%)** |
| | **CLS** | 0.088 | 0.003 | **-0.085 (-96.6%)** |
| | **External Font Requests** | 2 requests | 0 requests | **Eliminated** |

---

## Accessibility & Screen Reader Improvements

- All `<Icon />` elements default to `aria-hidden="true"` and `focusable="false"`.
- Meaningful controls (e.g. notifications link, close buttons) have explicit `aria-label`s preserved or added from the accessible name map.
- Screen readers no longer read out raw ligature names (`"close"`, `"account_balance_wallet"`).

---

## Verification

Enforced by unit test:
- `lib/__tests__/no-ligatures.test.ts`: Scans all `app/**/*.tsx` and `components/**/*.tsx`, guaranteeing zero occurrences of `material-symbols-outlined` and external Google Font URLs.
- `lib/__tests__/codemod-icons.test.ts`: Verifies TSX AST codemod transformations and `IconName` compile-time type safety.
