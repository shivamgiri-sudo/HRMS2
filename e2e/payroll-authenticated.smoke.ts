import { test, expect, Page } from '@playwright/test';

/**
 * The payroll UI, reached through a real login.
 *
 * A previous attempt at this used the demo-session helper and was worthless: demo
 * session ids carry no role_page_access rows, so /payroll renders the access gate —
 * "You don't have page access for this HRMS area" — at 384 characters. Every
 * assertion in that test was negative (not.toContain), so all of them passed
 * against a page that had rendered nothing. It was removed.
 *
 * The same blind spot affects the existing page-smoke suite: /payroll/sign-off under
 * a demo session is also an access gate, and assertNoRenderedFailure looks for crash
 * and error text, which an authorisation gate is neither. Those payroll passes are
 * reached, not rendered.
 *
 * So this logs in properly and asserts on content that only exists when the page
 * actually renders. Positive assertions, deliberately: a negative one cannot tell a
 * fixed page from a blank one.
 *
 * Credentials come from the environment and are never written here. Without them the
 * suite skips rather than failing, so it stays runnable in CI where no real account
 * exists:
 *
 *   HRMS_E2E_USER=<code> HRMS_E2E_PASS=<password> npx playwright test --project=page-smoke e2e/payroll-authenticated.smoke.ts
 */

const USER = process.env.HRMS_E2E_USER;
const PASS = process.env.HRMS_E2E_PASS;

test.skip(!USER || !PASS, 'HRMS_E2E_USER / HRMS_E2E_PASS not set — real-login payroll checks skipped');

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  // #identifier carries no type attribute, so an input[type="text"] selector misses
  // it entirely — which is how the first version of this failed to log in at all.
  const user = page.locator('#identifier');
  const pass = page.locator('#password');
  await user.waitFor({ state: 'visible', timeout: 20_000 });
  await user.fill(USER!);
  await pass.fill(PASS!);
  await page.getByRole('button', { name: /sign in/i }).first().click();

  // Landing anywhere other than /login means the session took.
  //
  // Polled rather than waitForFunction: the project sets actionTimeout 15s, which
  // caps a per-call timeout and made this fail at 15s despite asking for 45. Login
  // legitimately takes longer here — the database this runs against answers in
  // ~1.2s per query, and sign-in makes several.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!new URL(page.url()).pathname.startsWith('/login')) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`still on ${page.url()} after 90s — login did not complete`);
}

async function assertNotAccessGated(page: Page, label: string) {
  const body = (await page.textContent('body')) ?? '';
  expect(body, `${label} rendered the access gate, so nothing below was exercised`)
    .not.toContain("don't have page access");
  expect(body.length, `${label} rendered almost nothing (${body.length} chars)`).toBeGreaterThan(1000);
}

test.describe('payroll UI under a real session', () => {
  // Every case logs in, and each login is several slow queries against a remote
  // database. The project default of 300s is not enough once page loads are added.
  test.setTimeout(240_000);

  test('logs in and reaches /payroll with content', async ({ page }) => {
    await login(page);
    await page.goto('/payroll');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(6000);
    await assertNotAccessGated(page, '/payroll');
  });

  test('the Salary tab renders its read-only state', async ({ page }) => {
    await login(page);
    await page.goto('/payroll');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(6000);
    await assertNotAccessGated(page, '/payroll');

    const tab = page.getByRole('tab', { name: /salary/i }).first();
    await expect(tab, 'the Salary tab should exist on the payroll page').toHaveCount(1);
    await tab.click();
    await page.waitForTimeout(2000);

    const body = (await page.textContent('body')) ?? '';
    // Positive: the tab genuinely rendered. Asserted before the negatives below, so
    // those cannot pass against an empty panel.
    expect(body).toContain('Employee Assignments');
    // The write path that could only ever produce a 400 must not be back.
    expect(body).not.toContain('Add Salary Structure');
  });

  test('the governed increment flow it links to is reachable', async ({ page }) => {
    await login(page);
    await page.goto('/salary-increment');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(6000);
    // A dead link here would be worse than the broken form it replaced.
    await assertNotAccessGated(page, '/salary-increment');
  });
});
