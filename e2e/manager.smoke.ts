/**
 * e2e/manager.smoke.ts
 * Manager (process_manager) role smoke tests.
 */
import { test, expect } from '@playwright/test';
import { injectDemoSession, gotoSmoke, assertNotCrashed, waitForAppShell } from './helpers';

test.describe('Manager role smoke', () => {

  test('manager login → dashboard', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/dashboard');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    expect(page.url()).toContain('/dashboard');
  });

  test('manager → management dashboard', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/management/dashboard');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/dashboard|management|kpi|team/i);
  });

  test('manager → team analytics', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/team-analytics');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/team|analytics|performance/i);
  });

  test('manager → performance', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/performance');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/performance|goal|review/i);
  });

  test('manager → employees (scoped list)', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/employees');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    expect(page.url()).toContain('/employees');
  });

  test('manager → employee detail', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/employees');
    await assertNotCrashed(page);
    await waitForAppShell(page);
  });

  test('manager → leave review inbox', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/leave/requests');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/leave|request|pending|review/i);
  });

  test('manager → WFM live tracker', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/wfm/live');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/live|tracker|wfm|workforce/i);
  });

  test('manager → WFM roster', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/wfm/roster');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/roster|wfm|schedule/i);
  });

  test('manager → work inbox', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/work-inbox');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/inbox|task|approval/i);
  });

  test('manager → goals', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/goals');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/goal|appraisal|objective/i);
  });

  test('manager → KPI config', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/kpi-config');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/kpi|metric|performance/i);
  });

  test('manager → process config', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/process-config');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/process|workflow/i);
  });

  test('manager → career planning', async ({ page }) => {
    await injectDemoSession(page, 'manager');
    await gotoSmoke(page, '/career-planning');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/career|plan|development/i);
  });
});
