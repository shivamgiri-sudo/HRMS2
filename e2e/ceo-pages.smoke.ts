/**
 * e2e/ceo-pages.smoke.ts
 *
 * Pre-deploy page sweep for the CEO role — the CEO's Round 2 Step 2:
 *
 *   "A pre-deploy smoke test covering every page in the CEO, Branch Head and HR role tabs.
 *    It does not need to be sophisticated - it needs to exist and it needs to run before
 *    anything ships."
 *
 * Deliberately unsophisticated. It asserts a page loads, is not a routed 404, and is not
 * displaying a database error. It asserts nothing about the numbers on it — those are
 * covered by the contract tests, and a smoke test that checks values goes stale and gets
 * switched off.
 *
 * Every check here maps to something that actually reached the CEO on 01-Aug-2026:
 *   - two pages were hard 404s in both rounds
 *   - one printed "Field 'session_family_id' doesn't have a default value" on screen
 *   - one rendered an nginx 502 banner, disclosing the server stack and version
 *
 * Uses an injected demo session, so it needs no seeded database and no real credentials.
 * Requires the preview build to be served with VITE_ENABLE_DEMO_LOGIN=true.
 */
import { test } from '@playwright/test';
import {
  injectDemoSession,
  gotoSmoke,
  assertNotCrashed,
  assertNoRenderedFailure,
  waitForAppShell,
} from './helpers';

/**
 * The CEO's real page set is 19, not the 22 in the UAT matrix.
 *
 * ADVANCED_REPORTS, KPI_DASHBOARD and MY_KPI were removed from the role on 31-Jul because
 * nothing sits behind them. The first two now redirect rather than 404, which is what the
 * final two cases below verify — the matrix and the bookmarks still point at the old URLs.
 */
const CEO_PAGES: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/ceo/dashboard', label: 'CEO Dashboard' },
  { path: '/my-dashboard', label: 'My Dashboard' },
  { path: '/management/dashboard', label: 'Management Dashboard' },
  { path: '/operations/dashboard', label: 'Operations Dashboard' },
  { path: '/quality/dashboard', label: 'Quality Dashboard' },
  { path: '/operations-kpi', label: 'Operations KPI' },
  { path: '/performance/command-center', label: 'Workforce Command Center' },
  { path: '/reports', label: 'Reports Center' },
  { path: '/work-inbox', label: 'Work Inbox' },
  { path: '/profile', label: 'My Profile' },
  { path: '/attendance-regularization', label: 'Attendance Regularization' },
  { path: '/payroll/payslips', label: 'Payslips' },
  { path: '/payroll/sign-off', label: 'Payroll Sign-off' },
  { path: '/payroll/tax-declaration', label: 'Tax Declaration' },
  { path: '/expenses', label: 'My Expenses' },
  { path: '/expenses/new', label: 'New Expense Claim' },
  { path: '/lms/my-learning', label: 'My Learning' },
  { path: '/exit/resignation', label: 'My Resignation' },
  { path: '/privacy/dpdp-withdrawal', label: 'DPDP Withdrawal' },
];

test.describe('CEO role page sweep', () => {
  test.beforeEach(async ({ page }) => {
    // 'admin' is the demo persona with the widest page access, so a failure here is a page
    // fault rather than an entitlement gap. Entitlements are covered by ceo-page-scope.
    await injectDemoSession(page, 'admin');
  });

  for (const { path, label } of CEO_PAGES) {
    test(`${label} (${path}) loads without a rendered failure`, async ({ page }) => {
      await gotoSmoke(page, path);
      await waitForAppShell(page);
      await assertNotCrashed(page);
      await assertNoRenderedFailure(page, path);
    });
  }
});

test.describe('retired URLs still resolve', () => {
  test.beforeEach(async ({ page }) => {
    await injectDemoSession(page, 'admin');
  });

  // These two are in the UAT matrix and in testers' bookmarks. Neither has ever had a page,
  // and both returned "Oops! Page not found" in Round 1 and again in Round 2. They now
  // redirect; if a future change removes the redirect, that regresses to a 404 for anyone
  // following an old link, and this catches it.
  const REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
    { from: '/kpi/dashboard', to: '/operations-kpi' },
    { from: '/workforce/command-center', to: '/performance/command-center' },
  ];

  for (const { from, to } of REDIRECTS) {
    test(`${from} redirects to ${to} instead of 404ing`, async ({ page }) => {
      await gotoSmoke(page, from);
      await waitForAppShell(page);
      await assertNoRenderedFailure(page, from);
      if (!page.url().includes(to)) {
        throw new Error(`${from} should redirect to ${to}, landed on ${page.url()}`);
      }
    });
  }
});
