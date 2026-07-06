import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    viewport: { width: 390, height: 844 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  timeout: 300_000,
  expect: { timeout: 15_000 },
});
