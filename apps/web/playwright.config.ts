import { defineConfig, devices } from "@playwright/test";

/**
 * M1 Playwright smoke — run against a local `pnpm --filter @hrmny/web dev`.
 * CI: start web then `pnpm --filter @hrmny/web e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  // Only *.spec.ts here — *.test.ts under e2e/ (e.g. route-manifest.test.ts) is a
  // vitest file, not a Playwright test.
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    extraHTTPHeaders: {
      "x-dev-role": "partner",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm exec next dev --port 3000",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
