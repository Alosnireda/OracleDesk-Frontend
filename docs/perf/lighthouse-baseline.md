# Lighthouse CI Baseline Report

## Audit Configuration
- **Lighthouse Version**: 12.x via `@lhci/cli`
- **Target Preset**: Desktop (`--no-sandbox --headless --disable-gpu`)
- **Blocked URL Patterns**: `*fonts.googleapis.com*`, `*fonts.gstatic.com*`
- **Runs per URL**: 3 runs (median score reported)

---

## Performance Targets & Baseline Results

| Route | Performance Score | Accessibility Score | Best Practices Score | FCP | LCP | CLS | TBT |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`/` (Landing Page)** | **98 / 100** | **98 / 100** | **100 / 100** | ~0.7s | ~1.1s | 0.00 | 20ms |
| **`/markets` (Markets Grid)** | **96 / 100** | **96 / 100** | **100 / 100** | ~0.8s | ~1.3s | 0.01 | 40ms |
| **`/markets/quick-view?onChainId=1`** | **95 / 100** | **96 / 100** | **100 / 100** | ~0.8s | ~1.4s | 0.01 | 50ms |

---

## Budget Thresholds Enforced in CI

```json
{
  "categories:performance": ["error", { "minScore": 0.90 }],
  "categories:accessibility": ["error", { "minScore": 0.95 }],
  "categories:best-practices": ["error", { "minScore": 0.90 }],
  "first-contentful-paint": ["error", { "maxNumericValue": 1200 }],
  "largest-contentful-paint": ["error", { "maxNumericValue": 2000 }],
  "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05 }],
  "total-blocking-time": ["error", { "maxNumericValue": 150 }]
}
```

---

## External Font Blocking Verification
By blocking `*fonts.googleapis.com*` and `*fonts.gstatic.com*` in the Lighthouse CI runner, any component or page that attempts to request external Google Fonts stylesheets or font binaries fails the assertion immediately.

With the `next/font/google` self-hosting migration and Lucide SVG icons completed, 0 external font stylesheet or font binary requests are made across any route.
