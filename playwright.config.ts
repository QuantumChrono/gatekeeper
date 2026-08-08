import { defineConfig, devices } from "@playwright/test"

// Node reads .env.local for the app through Next, but this config and the specs
// run outside it, and the reset helper needs the same two variables.
try {
  process.loadEnvFile(".env.local")
} catch {
  // Absent or unreadable. The spec says which variables it needs and why.
}

// `.e2e.ts` rather than `.spec.ts` on purpose: vitest's default include picks up
// `**/*.spec.ts`, and the unit suite must not try to run a browser test.
// Next picks a free port when 3000 is taken, so the port is not a constant on a
// machine that already has a dev server up. Overridable rather than hardcoded:
// `PORT=3001 pnpm test:e2e` reuses a server already running there.
const PORT = process.env.PORT ?? "3000"
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Both flows drive the same seeded queue and reset it between tests, so they
  // run one at a time. Parallel workers would reset a ticket mid-decision.
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
