import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GET /api/employees/:id/salary-structure — the first place in the product where an
 * employee's sanctioned salary structure can be read.
 *
 * The data was always there: salary_component_assignments covers 280 of 292 active
 * employees with basic and gross populated on every row, and it keeps every
 * revision — most people carry three to five versions. Nothing rendered any of it.
 *
 * Two things this must not get wrong.
 *
 * ACCESS. canAccessEmployee() is generous in ways that suit a profile page and not
 * pay: it admits 'admin' and 'ceo' outright, the employee themselves, and anyone the
 * target reports to. Passing SALARY_SCOPE_ROLES to it alone would still hand a team
 * lead their reports' salary, so the role check has to come first and separately.
 *
 * CURRENT. "Current" is the row whose status is active, never the newest by date.
 * On live data MAS62938's active row is dated 2026-07-31 while a superseded row is
 * dated 2026-08-20 — sorting by date would show a superseded structure as current.
 */
const routes = readFileSync(
  resolve(process.cwd(), 'src/modules/employees/employee.secure.routes.ts'),
  'utf8',
);

const handler = (() => {
  const start = routes.indexOf('router.get(`${UUID_ROUTE}/salary-structure`');
  expect(start, 'salary-structure route not found').toBeGreaterThan(-1);
  // Bounded at the handler's own closing `}));`, not at the next `router.` — this
  // route is the last one in the file, so searching forward for another router call
  // swallowed the trailing commentary and made the leak check below match prose.
  const end = routes.indexOf('\n}));', start);
  expect(end, 'could not find the end of the handler').toBeGreaterThan(start);
  return routes.slice(start, end);
})();

describe('salary structure — access', () => {
  it('requires a payroll role before anything else', () => {
    const roleCheckAt = handler.indexOf('hasAnyRole(userId, ...SALARY_SCOPE_ROLES)');
    const scopeCheckAt = handler.indexOf('assertEmployeeAccess(');
    const queryAt = handler.indexOf('salary_component_assignments');
    expect(roleCheckAt).toBeGreaterThan(-1);
    expect(roleCheckAt).toBeLessThan(scopeCheckAt);
    expect(roleCheckAt).toBeLessThan(queryAt);
    expect(handler).toContain('403');
  });

  it('still applies the branch/process scope check', () => {
    expect(handler).toContain('assertEmployeeAccess(userId, targetId, SALARY_SCOPE_ROLES)');
  });

  it('does not grant salary to the general people roles', () => {
    const list = routes.match(/SALARY_SCOPE_ROLES = \[(.*?)\]/s)?.[1] ?? '';
    for (const payroll of ['payroll', 'payroll_hr', 'payroll_head', 'finance_head']) {
      expect(list).toContain(`"${payroll}"`);
    }
    for (const notPayroll of ['"hr"', '"manager"', '"tl"', '"assistant_manager"', '"process_manager"', '"branch_head"']) {
      expect(list, `${notPayroll} must not read salary`).not.toContain(notPayroll);
    }
  });
});

describe('salary structure — payload', () => {
  it('reads the component table payroll actually pays from', () => {
    expect(handler).toContain('FROM salary_component_assignments');
    // employee_salary_assignment holds only an annual CTC and a percentage template;
    // it may be reported as a source but never used to synthesise components.
    expect(handler).toContain('ctc_percentage_estimate');
  });

  it('picks current by active status, not by latest date', () => {
    expect(handler).toContain("versions.find((v) => String(v.status ?? \"\").toLowerCase() === \"active\")");
  });

  it('returns every revision, newest first', () => {
    expect(handler).toContain('ORDER BY s.effective_date DESC, s.assigned_at DESC');
    expect(handler).toContain('history: versions');
  });

  it('preserves null amounts instead of coercing them to zero', () => {
    // A null PF is "never filled in", not "no PF deducted" — live rows have both.
    expect(handler).toContain('v === null || v === undefined ? null : Number(v)');
  });

  it('exposes no identity or bank fields', () => {
    for (const leak of ['aadhaar', 'pan_number', 'account_number', 'ifsc', 'bank_name']) {
      expect(handler.toLowerCase(), `${leak} must not appear`).not.toContain(leak);
    }
  });
});

describe('salary structure — the page gate matches the API gate', () => {
  const page = readFileSync(
    resolve(process.cwd(), '../src/pages/NativeEmployeeStatCard.tsx'),
    'utf8',
  );

  it('gates the tab on the same roles the API enforces', () => {
    expect(page).toContain('useHasRole("payroll", "payroll_hr", "payroll_head", "finance_head", "super_admin")');
    // useCanAccessPayroll also admits hr and admin, so the tab would 403 on click.
    // Asserted against the call, not the word — the page's own comment names it.
    expect(page).not.toMatch(/=\s*useCanAccessPayroll\(/);
  });

  it('hides the tab button and refuses to render the panel', () => {
    expect(page).toContain('TABS.filter(tab => tab.key !== "salary" || canSeeSalary)');
    expect(page).toContain('activeTab === "salary" && resolvedId && canSeeSalary');
  });
});
