/**
 * e2e/helpers.ts
 * Shared utilities for HRMS1 Playwright smoke tests.
 */
import type { Page } from '@playwright/test';

/**
 * Inject a demo session into localStorage directly.
 * Mirrors what AuthContext.signIn() does when DEMO_LOGIN_ENABLED=true.
 * Avoids real HTTP calls and is immune to DB state.
 */
export async function injectDemoSession(
  page: Page,
  role: 'admin' | 'hr' | 'recruiter' | 'manager' | 'tl' | 'employee' = 'admin'
): Promise<void> {
  const userMap: Record<string, { id: string; email: string }> = {
    admin:     { id: 'demo-admin-id',     email: 'admin@mascallnet.com' },
    hr:        { id: 'demo-hr-id',        email: 'hr@mascallnet.com' },
    recruiter: { id: 'demo-recruiter-id', email: 'recruiter@mascallnet.com' },
    manager:   { id: 'demo-manager-id',   email: 'manager@mascallnet.com' },
    tl:        { id: 'demo-tl-id',        email: 'tl@mascallnet.com' },
    employee:  { id: 'demo-employee-id',  email: 'employee@mascallnet.com' },
  };

  const user = userMap[role];
  const session = {
    access_token: `mock-token-${role === 'manager' ? 'process_manager' : role === 'tl' ? 'team_leader' : role}`,
    user,
  };

  // Set localStorage before the app boots
  await page.addInitScript((s) => {
    localStorage.setItem('hrms_demo_session', JSON.stringify(s));
  }, session);
}

/**
 * Navigate to a path using domcontentloaded (not networkidle) to avoid
 * false timeouts on pages that poll backend APIs continuously.
 */
export async function gotoSmoke(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

/**
 * Navigate to a page and wait for it to be stable.
 * Returns true if the expected path was reached, false if redirected elsewhere.
 */
export async function goTo(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return page.url().includes(path);
}

/**
 * Assert that the page is not a hard crash (blank white screen, JS error overlay,
 * or "Cannot GET" nginx/express 404).
 */
export async function assertNotCrashed(page: Page): Promise<void> {
  const body = await page.locator('body').textContent() ?? '';
  const isCrash =
    body.trim() === '' ||
    body.includes('Cannot GET') ||
    body.includes('Unexpected token') ||
    body.includes('ChunkLoadError');

  if (isCrash) {
    throw new Error(`Page appears crashed. body excerpt: ${body.substring(0, 200)}`);
  }
}

/**
 * Failures that render as a perfectly healthy page.
 *
 * assertNotCrashed above catches a blank screen or a bundle that failed to load. Every
 * defect the CEO found in UAT Round 2 sailed past it: a routed 404 renders a styled page
 * with a heading, and a leaked driver error renders as ordinary body text. Both look like
 * a working page to anything that only checks the DOM is populated.
 *
 * Each pattern here corresponds to something that actually reached him on 01-Aug-2026.
 */
const RENDERED_FAILURES: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /Oops!\s*Page not found/i, why: 'routed 404 — the page is not mounted at this path' },
  { pattern: /doesn't have a default value/i, why: 'raw MySQL error 1364 leaked to the browser' },
  { pattern: /\bER_[A-Z_]{4,}\b/, why: 'raw MySQL driver error code leaked to the browser' },
  { pattern: /\bSQLSTATE\b/i, why: 'raw SQL state leaked to the browser' },
  { pattern: /\bnginx\/[\d.]+/i, why: 'nginx error page rendered into the app — the backend was unreachable' },
  { pattern: /\b50[023] Bad Gateway|Gateway Time-?out\b/i, why: 'upstream error page rendered into the app' },
  { pattern: /at\s+\/[\w/.-]+\.(?:ts|js):\d+:\d+/, why: 'server stack trace leaked to the browser' },
];

/**
 * Assert the page is not showing a failure that still looks like a page.
 *
 * Deliberately separate from assertNotCrashed so a failure says which of the two it is:
 * "the page did not load" and "the page loaded and is showing you a database error" need
 * different fixes.
 */
export async function assertNoRenderedFailure(page: Page, path: string): Promise<void> {
  const body = await page.locator('body').textContent() ?? '';
  for (const { pattern, why } of RENDERED_FAILURES) {
    const match = body.match(pattern);
    if (match) {
      throw new Error(
        `${path} rendered a failure: ${why}\n  matched: "${match[0]}"\n  excerpt: ${body.substring(0, 300)}`,
      );
    }
  }
}

/**
 * Wait for the DashboardLayout or any primary app shell to appear.
 * Tolerates slow lazy-loaded pages.
 */
export async function waitForAppShell(page: Page): Promise<void> {
  await page.waitForSelector(
    'nav, [role="navigation"], h1, h2, [data-testid="layout"], .min-h-screen',
    { timeout: 15_000 }
  );
}
