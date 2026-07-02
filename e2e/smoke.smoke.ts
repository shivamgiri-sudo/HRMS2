/**
 * e2e/smoke.smoke.ts
 * HRMS1 browser smoke tests — validates that key pages load without crashing.
 *
 * Strategy:
 *  - Uses demo sessions (localStorage injection) so tests never depend on a
 *    live backend or seeded database.
 *  - VITE_ENABLE_DEMO_LOGIN=true must be set in the build/dev server so the
 *    frontend AuthContext accepts the injected session.
 *  - Tests use domcontentloaded (not networkidle) to avoid timeouts on pages
 *    that continuously poll backend APIs.
 *  - Assertions check page structure (heading, nav, card) not dynamic data counts.
 */
import { test, expect } from '@playwright/test';
import { injectDemoSession, gotoSmoke, assertNotCrashed, waitForAppShell } from './helpers';

// ── 1. Auth page loads without login ─────────────────────────────────────────
test('auth page loads', async ({ page }) => {
  await gotoSmoke(page, '/auth');

  await assertNotCrashed(page);

  await expect(page.locator('#identifier')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

// ── 2. Login with admin credentials ──────────────────────────────────────────
test('admin login navigates to dashboard', async ({ page }) => {
  await gotoSmoke(page, '/auth');

  await page.locator('#identifier').fill('admin@mascallnet.com');
  await page.locator('#password').fill('Admin@123');
  await page.locator('button[type="submit"]').click();

  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await assertNotCrashed(page);
  await waitForAppShell(page);

  expect(page.url()).toContain('/dashboard');
});

// ── 3–10. Protected pages — use injected demo session ────────────────────────

test('dashboard loads after session inject', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/dashboard');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  expect(page.url()).toContain('/dashboard');
});

test('employees page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/employees');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/employee/i);
});

test('ATS dashboard loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/ats/dashboard');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/ats|recruitment|candidate/i);
});

test('ATS candidate master loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/ats/candidate-master');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/candidate/i);
});

test('attendance page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/attendance');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/attendance/i);
});

test('WFM roster page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/wfm/roster');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/roster|wfm|workforce/i);
});

test('leave page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/leaves');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/leave/i);
});

test('work inbox (task) page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/work-inbox');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/inbox|task|work/i);
});

test('KPI config page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/kpi-config');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/kpi/i);
});

test('process config page loads', async ({ page }) => {
  await injectDemoSession(page, 'admin');
  await gotoSmoke(page, '/process-config');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/process/i);
});

test('client portal login page loads', async ({ page }) => {
  await gotoSmoke(page, '/portal/login');

  await assertNotCrashed(page);
  await expect(page.locator('body')).toContainText(/portal|login|client/i);
});

// ── HR role smoke ─────────────────────────────────────────────────────────────
test('HR role can reach employees page', async ({ page }) => {
  await injectDemoSession(page, 'hr');
  await gotoSmoke(page, '/employees');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  expect(page.url()).toContain('/employees');
});

// ── TL role smoke ─────────────────────────────────────────────────────────────
test('TL role can reach WFM roster page', async ({ page }) => {
  await injectDemoSession(page, 'tl');
  await gotoSmoke(page, '/wfm/roster');

  await assertNotCrashed(page);
  await waitForAppShell(page);

  await expect(page.locator('body')).toContainText(/roster|wfm|workforce/i);
});
