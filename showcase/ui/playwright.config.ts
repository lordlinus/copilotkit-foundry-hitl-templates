import { defineConfig, devices } from "@playwright/test";

// Tier-2 browser E2E. Renders the REAL built UI in Chromium against a gateway
// running in mock mode (hermetic, no Azure). Catches browser-only and
// visibility/UX bugs that jsdom and SSE smoke can't (e.g. the @ag-ui/client
// detached-fetch crash, or an approval card stuck below the fold).
//
// The gateway + UI preview are started by the CI workflow (showcase-ui-e2e.yml);
// locally you can run them yourself and `BASE_URL=http://localhost:4173 npm run test:e2e`.
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:4173",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
