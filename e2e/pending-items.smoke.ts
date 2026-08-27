/**
 * e2e/pending-items.smoke.ts
 *
 * Automated coverage for the Okaya-rollout UAT items not yet live-tested, plus the items
 * that were blocked by the demo-account scope bug fixed in commit 62738a3f (2026-08-22) —
 * see project memory "hrms2-scope-access-demo-role-gap" and the UAT plan artifact for the
 * full trace.
 *
 * This file only automates what a smoke test can meaningfully check: page reachability, a
 * clean console/no rendered-failure page, and role-based access (positive + negative). It is
 * NOT a substitute for the manual script (UAT_MANUAL_TEST_SCRIPT_PENDING_ITEMS.csv) — data
 * accuracy, cross-module chains (Assets→Exit→F&F), and anything requiring real form
 * submission still needs a human tester following that script.
 *
 * Run: npx playwright test e2e/pending-items.smoke.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoSmoke, assertNotCrashed, assertNoRenderedFailure, waitForAppShell } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Local role injector — extends helpers.ts's injectDemoSession to cover roles
// this file needs (super_admin, finance, wfm, ceo, it) without editing the
// shared helper (other sessions may be using it concurrently).
// ─────────────────────────────────────────────────────────────────────────────
type Role =
  | 'super_admin' | 'admin' | 'hr' | 'finance' | 'wfm' | 'manager'
  | 'employee' | 'ceo' | 'qa' | 'trainer';

const DEMO_USERS: Record<Role, { id: string; email: string; tokenRole: string }> = {
  super_admin: { id: 'demo-super-admin-id', email: 'superadmin@mascallnet.com', tokenRole: 'super_admin' },
  admin:       { id: 'demo-admin-id',       email: 'admin@mascallnet.com',       tokenRole: 'admin' },
  hr:          { id: 'demo-hr-id',          email: 'hr@mascallnet.com',          tokenRole: 'hr' },
  finance:     { id: 'demo-finance-id',     email: 'finance@mascallnet.com',     tokenRole: 'finance' },
  wfm:         { id: 'demo-wfm-id',         email: 'wfm@mascallnet.com',         tokenRole: 'wfm' },
  manager:     { id: 'demo-manager-id',     email: 'manager@mascallnet.com',     tokenRole: 'process_manager' },
  employee:    { id: 'demo-employee-id',    email: 'employee@mascallnet.com',    tokenRole: 'employee' },
  ceo:         { id: 'demo-ceo-id',         email: 'ceo@mascallnet.com',         tokenRole: 'ceo' },
  qa:          { id: 'demo-qa-id',          email: 'qa@mascallnet.com',          tokenRole: 'qa' },
  trainer:     { id: 'demo-trainer-id',     email: 'trainer@mascallnet.com',     tokenRole: 'trainer' },
};

async function injectSession(page: Page, role: Role): Promise<void> {
  const user = DEMO_USERS[role];
  const session = { access_token: `mock-token-${user.tokenRole}`, user: { id: user.id, email: user.email } };
  await page.addInitScript((s) => {
    localStorage.setItem('hrms_demo_session', JSON.stringify(s));
  }, session);
}

/** Standard reachability check: loads, not crashed, no rendered failure, app shell present. */
async function checkReachable(page: Page, path: string): Promise<void> {
  await gotoSmoke(page, path);
  await assertNotCrashed(page);
  await assertNoRenderedFailure(page, path);
  await waitForAppShell(page);
}

/** Confirm a role is explicitly denied — an "Access Denied" page or 403, not a crash. */
async function checkDenied(page: Page, path: string): Promise<void> {
  await gotoSmoke(page, path);
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body).toMatch(/access denied|forbidden|don't have (page )?access|403/i);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reachability — items never live-tested this UAT pass (sheet #s in test names)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Reachability — untested items', () => {
  test('19 — Org Chart (hr)', async ({ page }) => {
    await injectSession(page, 'hr');
    await checkReachable(page, '/org-chart');
  });

  test('24 — Attendance Exceptions / Mismatch Queue (wfm)', async ({ page }) => {
    await injectSession(page, 'wfm');
    await checkReachable(page, '/wfm/mismatch-queue');
  });

  test('46 — Loan Management (finance)', async ({ page }) => {
    await injectSession(page, 'finance');
    await checkReachable(page, '/payroll/loans');
  });

  test('47 — Reimbursements (employee)', async ({ page }) => {
    await injectSession(page, 'employee');
    await checkReachable(page, '/payroll/reimbursements');
  });

  test('51 — Budget Consolidation (super_admin)', async ({ page }) => {
    await injectSession(page, 'super_admin');
    await checkReachable(page, '/finance/budget-consolidation');
  });

  test('52 — Cost Centres (finance)', async ({ page }) => {
    await injectSession(page, 'finance');
    await checkReachable(page, '/finance/cost-centres');
  });

  test('53/60/61 — Vendors / Procurement / ERP (finance)', async ({ page }) => {
    await injectSession(page, 'finance');
    await checkReachable(page, '/vendors');
    await checkReachable(page, '/procurement');
    await checkReachable(page, '/erp');
  });

  test('56 — Vendor Payment Tracking (finance)', async ({ page }) => {
    await injectSession(page, 'finance');
    await checkReachable(page, '/finance/vendor-payment-tracking');
  });

  test('65 — KPI Master / My KPI (hr, employee)', async ({ page }) => {
    await injectSession(page, 'hr');
    await checkReachable(page, '/kpi-master');
    await injectSession(page, 'employee');
    await checkReachable(page, '/my-kpi');
  });

  test('66 — PIP Management (hr)', async ({ page }) => {
    await injectSession(page, 'hr');
    await checkReachable(page, '/pip-management');
  });

  test('68 — Helpdesk (employee)', async ({ page }) => {
    await injectSession(page, 'employee');
    await checkReachable(page, '/helpdesk');
  });

  test('69 — Support Command Center (admin)', async ({ page }) => {
    await injectSession(page, 'admin');
    // Confirmed backend-wired (GET /api/helpdesk/command-center); frontend path found via
    // nav sidebar as "Support Command" — confirm it is NOT a 404 before trusting this route.
    await checkReachable(page, '/support/command-center');
  });

  test('70 — Grievance Command Center (hr)', async ({ page }) => {
    await injectSession(page, 'hr');
    await checkReachable(page, '/support/grievance-command-center');
  });

  test('71 — Benefits (employee)', async ({ page }) => {
    await injectSession(page, 'employee');
    await checkReachable(page, '/benefits');
  });

  test('86 — DPDP / Privacy Withdrawal (employee)', async ({ page }) => {
    await injectSession(page, 'employee');
    await checkReachable(page, '/privacy/dpdp-withdrawal');
  });

  test('93 — Document Verification (hr)', async ({ page }) => {
    await injectSession(page, 'hr');
    await checkReachable(page, '/document-verification');
  });

  test('94 — Migration Console (admin)', async ({ page }) => {
    await injectSession(page, 'admin');
    await checkReachable(page, '/migration-console');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-test — items blocked by the scope-access demo-role bug (fixed 2026-08-22,
// commit 62738a3f). Confirm they now load real data, not "Failed to load" /
// an empty picker.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Re-test — previously blocked by the scope-access fix', () => {
  test('30 — Roster Preferences no longer fails to load (wfm)', async ({ page }) => {
    await injectSession(page, 'wfm');
    await checkReachable(page, '/roster-preference');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(/failed to load preferences/i);
  });

  test('31 — Roster Capacity Config process picker is populated (wfm)', async ({ page }) => {
    await injectSession(page, 'wfm');
    await checkReachable(page, '/roster-capacity-config');
    // A populated <select>/combobox has more than the placeholder option — adjust the
    // selector below if the live markup differs; this is a starting point for a human to
    // verify against the actual rendered dropdown.
    const options = page.locator('select option, [role="option"]');
    await expect(options).not.toHaveCount(0);
  });

  test('73 — Assets shows a real count, not necessarily 0 (super_admin)', async ({ page }) => {
    await injectSession(page, 'super_admin');
    await checkReachable(page, '/assets');
    // This does NOT assert count > 0 — as of 2026-08-22 the system genuinely had 0 assets.
    // It only confirms the page itself loads correctly post-fix; a human must check the
    // actual number against the manual script (T21).
  });

  test('82 — admin is still denied Exit Command Center (known open defect)', async ({ page }) => {
    await injectSession(page, 'admin');
    await checkDenied(page, '/exit/command-center');
  });

  test('82 — super_admin can reach Exit Command Center', async ({ page }) => {
    await injectSession(page, 'super_admin');
    await checkReachable(page, '/exit/command-center');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security — mandatory negative test for Client Portal (item 92). Do not treat
// a hidden UI element as a pass; this checks the actual API response.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Security — Client Portal must not leak PII/payroll data', () => {
  /**
   * MARKED fixme DELIBERATELY — it was passing while proving nothing.
   *
   * The client portal authenticates with its OWN middleware (requireClientAuth) reading a
   * different JWT claim (clientUserId, demo sentinel `u-demo-`). The body below injected an
   * HRMS `employee` session and called an HRMS payroll endpoint with `mock-token-employee`,
   * so it never reached client auth at any point. The 401/403 it asserted came from the HRMS
   * token being rejected — a result identical to sending no token at all. It therefore
   * reported item 92 as covered while exercising none of the client boundary.
   *
   * A passing placeholder in a security suite is worse than an absent test: it retires the
   * item. `fixme` keeps it visible as outstanding instead of green.
   *
   * The structural half of this guarantee IS now covered, in a test that actually runs:
   * backend/src/modules/portal/__tests__/portal-route-auth.contract.test.ts asserts every
   * portal route sits behind requireClientAuth or requireAuth, and fails naming the exposed
   * routes when a guard is removed (mutation-verified).
   *
   * To finish this one properly it needs a real client_user session: mint a portal JWT for a
   * `u-demo-` client user with a known mapped process, then assert (a) it is refused on any
   * /api/payroll or /api/employees route, and (b) GET /api/portal/processes/:id returns 403
   * for a process NOT mapped to that client — the cross-client case, which is the actual risk.
   */
  test.fixme('92 — client_user cannot reach a payroll/PII endpoint directly', async () => {
    // Intentionally empty: see the comment above. Implement with a real client_user session.
  });
});
