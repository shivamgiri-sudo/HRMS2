import { test, expect } from '@playwright/test';
import { injectDemoSession, waitForAppShell, assertNoRenderedFailure } from './helpers';

/**
 * The Payroll page and its Salary tab, loaded in a real browser.
 *
 * The Salary tab's Add/Edit/Delete controls posted a per-employee rupee breakdown to
 * POST /api/payroll/structures, which validates a shared percentage template and
 * requires structureCode/structureName. Every submit failed validation behind a
 * generic "Failed to create salary structure" toast, so the feature never worked for
 * anyone who clicked it. Re-pointing it at the real per-employee endpoint would not
 * have helped either: salary assignment is governance-gated and refuses a manual
 * amount without an approved slab or proposal.
 *
 * The write path was therefore removed in favour of a link to the governed increment
 * flow. These assertions exist because the frontend suite has no test for this
 * component at all, and `npm run typecheck` compiles zero files — a production build
 * would catch a syntax error but not a page that renders blank or an affordance that
 * quietly came back.
 */
test.describe('Payroll salary tab', () => {
  test.beforeEach(async ({ page }) => {
    await injectDemoSession(page, 'admin');
  });

  test('/payroll loads without a rendered failure', async ({ page }) => {
    await page.goto('/payroll');
    await waitForAppShell(page);
    await assertNoRenderedFailure(page, '/payroll');
  });

  test('the Salary tab renders and offers no write affordance', async ({ page }) => {
    await page.goto('/payroll');
    await waitForAppShell(page);

    const salaryTab = page.getByRole('tab', { name: /salary/i }).first();
    if (await salaryTab.count()) {
      await salaryTab.click();
      await page.waitForTimeout(1500);
    }
    await assertNoRenderedFailure(page, '/payroll (salary tab)');

    // The controls that could only ever produce a 400. Their return would mean the
    // broken write path is back.
    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('Add Salary Structure');
    expect(body).not.toContain('Add First Salary Structure');
  });

  test('salary revisions point at the governed increment flow', async ({ page }) => {
    await page.goto('/salary-increment');
    await waitForAppShell(page);
    // The destination the Salary tab now sends people to. A dead link there would be
    // worse than the broken form it replaced.
    await assertNoRenderedFailure(page, '/salary-increment');
    expect(page.url()).toContain('/salary-increment');
  });
});
