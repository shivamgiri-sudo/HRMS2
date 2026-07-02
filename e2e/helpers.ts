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
 * Wait for the DashboardLayout or any primary app shell to appear.
 * Tolerates slow lazy-loaded pages.
 */
export async function waitForAppShell(page: Page): Promise<void> {
  await page.waitForSelector(
    'nav, [role="navigation"], h1, h2, [data-testid="layout"], .min-h-screen',
    { timeout: 15_000 }
  );
}
