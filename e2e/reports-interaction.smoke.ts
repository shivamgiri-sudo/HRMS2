/**
 * e2e/reports-interaction.smoke.ts
 *
 * /reports was reported twice, in both UAT rounds, as "clicking is fully inert" and
 * "blank page after 40 seconds". Neither is something a page-load smoke test can see: the
 * page returns 200, renders its tab bar, and is not a 404 or a database error. It looks
 * healthy to every check in ceo-pages.smoke.ts, and it did.
 *
 * The difference between a working tab bar and an inert one is only visible if something
 * clicks it. So this file clicks.
 *
 * Three distinct failures are separated deliberately, because they have different causes
 * and different owners:
 *
 *   1. The click does nothing at all       — handler not bound, or an overlay eating events
 *   2. The URL changes but the view does not — router updates, the view fails to remount
 *   3. Both change, but the view is broken   — lazy chunk fails, or the API 500s underneath
 *
 * A single "tab does not work" assertion would report all three identically and send
 * whoever picks it up looking in the wrong place.
 *
 * Uses an injected demo session, so it needs no seeded database and no real credentials.
 */
import { test, expect } from '@playwright/test';
import {
  injectDemoSession,
  gotoSmoke,
  assertNotCrashed,
  assertNoRenderedFailure,
  waitForAppShell,
} from './helpers';

/**
 * Budget for the tab bar to become usable.
 *
 * The CEO reported a blank page after forty seconds. Ten is generous for a lazy chunk on a
 * warm preview server and still fails long before a human would call it broken — the point
 * of a number here is that "slow" is a defect with a threshold, not a matter of opinion.
 */
const TAB_BAR_BUDGET_MS = 10_000;

/** Tabs an admin session sees. Roles gate the rest; these three are always present. */
const ALWAYS_VISIBLE_TABS = [
  { label: 'Report Library', view: 'library' },
  { label: 'Decision Center', view: 'control-room' },
  { label: 'BPO Reports', view: 'bpo' },
] as const;

test.describe('/reports is interactive, not just rendered', () => {
  test.beforeEach(async ({ page }) => {
    await injectDemoSession(page, 'admin');
  });

  test('the tab bar appears within budget', async ({ page }) => {
    const started = Date.now();
    await gotoSmoke(page, '/reports');
    await waitForAppShell(page);

    await expect(
      page.getByRole('button', { name: 'Report Library' }),
      'the Report Library tab never appeared — this is the "blank after 40 seconds" report',
    ).toBeVisible({ timeout: TAB_BAR_BUDGET_MS });

    const elapsed = Date.now() - started;
    expect(
      elapsed,
      `tab bar took ${elapsed} ms, budget is ${TAB_BAR_BUDGET_MS} ms`,
    ).toBeLessThan(TAB_BAR_BUDGET_MS);

    await assertNotCrashed(page);
    await assertNoRenderedFailure(page, '/reports');
  });

  for (const tab of ALWAYS_VISIBLE_TABS) {
    test(`clicking "${tab.label}" changes the URL and the view`, async ({ page }) => {
      await gotoSmoke(page, '/reports');
      await waitForAppShell(page);

      const button = page.getByRole('button', { name: tab.label });
      await expect(button).toBeVisible({ timeout: TAB_BAR_BUDGET_MS });

      // Capture what is on screen before, so "the view changed" is a real observation
      // rather than an assumption that follows from the URL.
      const contentBefore = (await page.locator('main, [class*="flex-1"]').first().textContent()) ?? '';

      await button.click();

      // Failure 1 — the click did nothing. switchView() writes ?view= via setSearchParams,
      // so if this times out the handler never ran.
      await expect(
        page,
        `clicking "${tab.label}" did not change the URL — the handler never ran`,
      ).toHaveURL(new RegExp(`[?&]view=${tab.view}\\b`), { timeout: 5_000 });

      // Failure 2 — the URL moved but the screen did not. ReportsHub keys its ErrorBoundary
      // on activeView, so a genuine switch remounts the view; identical content means it
      // did not.
      await expect(async () => {
        const contentAfter =
          (await page.locator('main, [class*="flex-1"]').first().textContent()) ?? '';
        expect(
          contentAfter,
          `URL moved to view=${tab.view} but the view content is unchanged — the router ` +
            `updated and the view did not remount`,
        ).not.toBe(contentBefore);
      }).toPass({ timeout: 10_000 });

      // Failure 3 — it switched, and what it switched to is broken. The lazy chunk can fail
      // to load, or the view's own API call can 500 and leak the driver error.
      await assertNotCrashed(page);
      await assertNoRenderedFailure(page, `/reports?view=${tab.view}`);

      // The loader must not still be spinning. A view stuck in Suspense forever is exactly
      // what "inert" looks like from the outside.
      await expect(
        page.locator('.animate-spin'),
        `${tab.label} is still showing its loading spinner — the view never resolved`,
      ).toHaveCount(0, { timeout: 15_000 });
    });
  }

  test('a deep link to a view opens that view directly', async ({ page }) => {
    // The tab bar and the URL are two ways into the same state. If ?view= is only written
    // and never read, tabs appear to work while every shared link lands on the default —
    // which is indistinguishable from "the link is broken" to whoever received it.
    await gotoSmoke(page, '/reports?view=bpo');
    await waitForAppShell(page);

    await expect(page).toHaveURL(/[?&]view=bpo\b/);
    await expect(
      page.getByRole('button', { name: 'BPO Reports' }),
      'deep-linked to view=bpo but the BPO Reports tab is not present',
    ).toBeVisible({ timeout: TAB_BAR_BUDGET_MS });

    await assertNotCrashed(page);
    await assertNoRenderedFailure(page, '/reports?view=bpo');
  });

  test('an unknown view falls back instead of rendering nothing', async ({ page }) => {
    // resolvePermittedView() maps an unrecognised or unauthorised view to the role default.
    // If that ever regresses the page renders an empty shell — a blank page with working
    // chrome, which is precisely the shape of the original report.
    await gotoSmoke(page, '/reports?view=not-a-real-view');
    await waitForAppShell(page);

    await expect(
      page.getByRole('button', { name: 'Report Library' }),
      'an unknown view produced no tab bar — the fallback did not apply',
    ).toBeVisible({ timeout: TAB_BAR_BUDGET_MS });

    await assertNotCrashed(page);
    await assertNoRenderedFailure(page, '/reports?view=not-a-real-view');
  });
});
