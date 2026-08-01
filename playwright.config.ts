import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Two projects rather than one testDir, because the specs live in two places under two
  // naming conventions and a single root testDir would also scan the nested worktrees
  // under .claude/ and .codex-tmp/ — each of which carries its own copy of Playwright and
  // makes it refuse to run at all.
  //
  // 'page-smoke' is the important one. e2e/*.smoke.ts is a demo-session harness that loads
  // real pages in a browser, and it had never run: it sat outside testDir AND its
  // *.smoke.ts suffix does not match Playwright's default *.spec.ts / *.test.ts. Four
  // working pages reached the CEO mid-UAT while that suite existed in the tree, unreachable.
  projects: [
    { name: 'page-smoke', testDir: './e2e',       testMatch: /.*\.smoke\.ts$/ },
    { name: 'journeys',   testDir: './tests/e2e', testMatch: /.*\.(spec|test)\.ts$/ },
  ],
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
