# Performance Engineering & Monitoring

## Overview
OracleDesk implements automated performance budgeting and real-user monitoring (RUM) to prevent regressions and maintain fast load times and responsive interfaces across devices.

---

## Performance Tooling & Architecture
1. **Windowed Virtualization** (`@tanstack/react-virtual`):
   - Documentation: [virtualization.md](file:///Users/marvellous/Desktop/OracleDesk-Frontend/docs/perf/virtualization.md)
   - Binds mounted elements on `/markets`, `/reasoning`, and `/portfolio` to viewport + overscan.
2. **Typography & Zero-Latency Icons**:
   - Documentation: [fonts-icons.md](file:///Users/marvellous/Desktop/OracleDesk-Frontend/docs/perf/fonts-icons.md)
   - Self-hosted `next/font/google` eliminates external Google Fonts stylesheet requests (`0 requests to fonts.googleapis.com`).
   - Lucide SVG icons eliminate Material Symbols font file downloads and layout shifts.
3. **Ledger Heartbeat & Event Invalidation**:
   - Documentation: [polling.md](file:///Users/marvellous/Desktop/OracleDesk-Frontend/docs/perf/polling.md)
   - Singleton clock with visibility-aware pause and exponential backoff replaces independent intervals.
   - Soroban `getEvents` invalidates only queries whose state changed on-chain.
4. **Lighthouse CI & Core Web Vitals**:
   - Documentation: [lighthouse-baseline.md](file:///Users/marvellous/Desktop/OracleDesk-Frontend/docs/perf/lighthouse-baseline.md)
   - Automated budget enforcement on PRs.
   - Production telemetry beaconing with PII sanitization and 10% sampling.

---

## Running Benchmarks Locally

### 1. Run Lighthouse CI Locally
Ensure the production bundle is built, then run the automated test suite:
```bash
npm run build
npm run perf:lhci
```
This starts the mock server (`e2e/perf/mock-server.mjs`) on port 8787, starts Next.js production server on port 3000, and collects 3 runs against `/`, `/markets`, and `/markets/quick-view?onChainId=1`.

Reports are saved to `.lighthouseci/reports/`.

### 2. View Virtualization Fixture
Start the development server and open `/dev/virtual-fixture`:
```bash
npm run dev
# Open http://localhost:3000/dev/virtual-fixture
```
Use the toggle bar to compare **Virtualized (ON)** (bounds mounted cards to viewport) vs **Plain Map (OFF)** (renders all 2,000 cards directly into DOM).
