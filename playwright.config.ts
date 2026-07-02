import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for HRMS1 browser smoke tests.
 *
 * Target: http://localhost:8080 (vite dev or vite preview)
 * Backend: http://localhost:5055
 *
 * Run locally:
 *   npm run test:e2e:smoke
 *
 * Demo login is enabled via VITE_ENABLE_DEMO_LOGIN=true — tests bypass the real
 * backend auth call and use localStorage-backed demo sessions from demoCreds.ts.
 * This keeps smoke tests deterministic with no seeded DB dependency.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.smoke.ts',

  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
