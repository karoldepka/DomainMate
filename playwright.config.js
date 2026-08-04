import { defineConfig, devices } from '@playwright/test'

/** @type {import('@playwright/test').PlaywrightTestConfig} */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 90_000,
  // Local dev boxes often run many other processes; concurrent Chromium instances
  // against the shared dev server cause flaky navigation timeouts under load.
  // CI runners are dedicated, so let Playwright pick its own default there.
  workers: process.env.CI ? undefined : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Nuxt's first dev-mode hydration includes a cold client compilation.
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
