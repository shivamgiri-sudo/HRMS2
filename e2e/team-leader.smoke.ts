/**
 * e2e/team-leader.smoke.ts
 * Team Leader (tl) role smoke tests.
 */
import { test, expect } from '@playwright/test';
import { injectDemoSession, gotoSmoke, assertNotCrashed, waitForAppShell } from './helpers';

test.describe('Team Leader role smoke', () => {

  test('TL login → dashboard', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/dashboard');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    expect(page.url()).toContain('/dashboard');
  });

  test('TL → WFM roster', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/wfm/roster');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/roster|wfm|schedule/i);
  });

  test('TL → WFM live tracker', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/wfm/live');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/live|tracker|wfm/i);
  });

  test('TL → work inbox', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/work-inbox');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/inbox|task|approval/i);
  });

  test('TL → goals', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/goals');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/goal|appraisal/i);
  });

  test('TL → career planning', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/career-planning');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/career|plan/i);
  });

  test('TL → RTA board', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/rta-board');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/rta|real.?time|board/i);
  });

  test('TL → helpdesk', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/helpdesk');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/help|ticket|support/i);
  });

  test('TL → LMS my learning', async ({ page }) => {
    await injectDemoSession(page, 'tl');
    await gotoSmoke(page, '/lms/my-learning');
    await assertNotCrashed(page);
    await waitForAppShell(page);
    await expect(page.locator('body')).toContainText(/learning|course|training/i);
  });
});
