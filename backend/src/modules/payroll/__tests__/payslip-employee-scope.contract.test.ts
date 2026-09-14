/**
 * Per-employee payslip/salary routes checked role membership only, never
 * branch/process scope. A branch-scoped hr/finance/payroll user could read
 * any employee's payslip or salary assignment org-wide by supplying a
 * different :employeeId — the same class of defect
 * payroll-payslip-access.contract.test.ts already documents and pins for the
 * *aggregate* /runs and /records endpoints (CEO UAT 31-Jul-2026). This test
 * covers the per-employee endpoints in payroll.routes.ts that were not part
 * of that fix: /salary-assignments/:employeeId[/history], /payslip/list,
 * /payslip/history, /payslip/legacy, /payslip/legacy-detail,
 * /payslip/:runId/:employeeId.
 *
 * The suite has no live DB (see payroll-payslip-access.contract.test.ts's own
 * header for why), so this is verified at the layer that decides it: the
 * route wiring itself, read as source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = readFileSync(resolve(process.cwd(), "src/modules/payroll/payroll.routes.ts"), "utf8");
const MORE_ROUTES = readFileSync(resolve(process.cwd(), "src/modules/payroll/payroll-more.routes.ts"), "utf8");

/** requireRole(...) argument list immediately following a given route path. */
function requireRoleArgsFor(source: string, path: string): string[] {
  const idx = source.indexOf(`"${path}"`);
  expect(idx, `route ${path} not found`).toBeGreaterThan(-1);
  const window = source.slice(idx, idx + 300);
  const match = window.match(/requireRole\(([^)]*)\)/);
  expect(match, `requireRole(...) not found near ${path}`).toBeTruthy();
  return [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("GET /salary-assignments/:employeeId[/history] are branch/process scoped", () => {
  it("both routes chain requireScopedRole after requireRole, using the employeeId param resolver", () => {
    for (const path of ["/salary-assignments/:employeeId", "/salary-assignments/:employeeId/history"]) {
      const idx = ROUTES.indexOf(`"${path}"`);
      expect(idx, `route ${path} not found`).toBeGreaterThan(-1);
      const window = ROUTES.slice(idx, idx + 400);
      expect(window, `${path} should chain requireScopedRole`).toMatch(
        /requireScopedRole\(\["hr", "finance", "payroll"\], resolveEmployeeIdParamScope\)/
      );
    }
  });
});

describe("GET /payslip/list/:employeeId, /payslip/history/:employeeId, /payslip/legacy/:employeeId are scoped and exclude ceo", () => {
  for (const path of ["/payslip/list/:employeeId", "/payslip/history/:employeeId", "/payslip/legacy/:employeeId"]) {
    it(`${path}: requireRole no longer includes ceo`, () => {
      expect(requireRoleArgsFor(ROUTES, path)).not.toContain("ceo");
    });

    it(`${path}: chains requireScopedRole with resolveEmployeeIdParamScope`, () => {
      const idx = ROUTES.indexOf(`"${path}"`);
      const window = ROUTES.slice(idx, idx + 500);
      expect(window).toMatch(/requireScopedRole\(\[[^\]]*\], resolveEmployeeIdParamScope\)/);
    });
  }
});

describe("resolveEmployeeIdParamScope resolves the *target* employee, not the caller", () => {
  it("queries employees by :employeeId param and returns branch/process/department", () => {
    const idx = ROUTES.indexOf("async function resolveEmployeeIdParamScope");
    expect(idx).toBeGreaterThan(-1);
    const body = ROUTES.slice(idx, idx + 500);
    expect(body).toContain("req.params.employeeId");
    expect(body).toMatch(/SELECT branch_id, process_id, department_id FROM employees WHERE id = \?/);
    expect(body).toContain("branchId:");
    expect(body).toContain("processId:");
  });
});

describe("GET /payslip/legacy-detail/:employeeCode/:payMonth excludes ceo and scopes non-self access", () => {
  it("no longer includes ceo in the HR role check", () => {
    const idx = ROUTES.indexOf('"/payslip/legacy-detail/:employeeCode/:payMonth"');
    expect(idx).toBeGreaterThan(-1);
    const body = ROUTES.slice(idx, idx + 1200);
    const match = body.match(/hasAnyRole\(req, \[([^\]]*)\]\)/);
    expect(match, "hasAnyRole(req, [...]) not found").toBeTruthy();
    expect(match![1]).not.toContain('"ceo"');
  });

  it("resolves the target employee by employeeCode and calls hasScopedAccess before returning data for a non-self lookup", () => {
    const idx = ROUTES.indexOf('"/payslip/legacy-detail/:employeeCode/:payMonth"');
    const body = ROUTES.slice(idx, idx + 1200);
    expect(body).toContain("isSelf");
    expect(body).toMatch(/SELECT id, branch_id, process_id, department_id FROM employees WHERE employee_code = \?/);
    expect(body).toContain("await hasScopedAccess(req.authUser!.id,");
  });
});

describe("GET /payslip/:runId/:employeeId scopes non-self privileged access", () => {
  it("checks isSelf first, then requires both a payroll role and matching scope for anyone else", () => {
    const idx = ROUTES.indexOf('"/payslip/:runId/:employeeId"');
    expect(idx).toBeGreaterThan(-1);
    const body = ROUTES.slice(idx, idx + 1400);
    expect(body).toContain("const isSelf = Boolean(callerEmp && callerEmp.id === employeeId)");
    // The exact hasRole(...) call is pinned verbatim by payslip-routes.contract.test.ts;
    // this test only asserts a scope check now also gates the non-self path.
    expect(body).toMatch(
      /hasRole\(req\.authUser!\.id, "admin", "hr", "finance", "payroll", "payroll_head", "payroll_admin"\)/
    );
    expect(body).toContain("await hasScopedAccess(req.authUser!.id,");
  });
});

describe("form16-data routes (payroll.routes.ts and the duplicate in payroll-more.routes.ts) are both scoped", () => {
  it("payroll.routes.ts checks isSelf then scope for non-self access", () => {
    const idx = ROUTES.indexOf('"/form16-data/:runId/:employeeId"');
    expect(idx).toBeGreaterThan(-1);
    const body = ROUTES.slice(idx, idx + 1400);
    expect(body).toContain("isSelf");
    expect(body).toContain("await hasScopedAccess(req.authUser!.id,");
  });

  it("payroll-more.routes.ts (the duplicate implementation) is fixed identically, not left behind", () => {
    const idx = MORE_ROUTES.indexOf('"/form16-data/:runId/:employeeId"');
    expect(idx, "form16-data route not found in payroll-more.routes.ts").toBeGreaterThan(-1);
    const body = MORE_ROUTES.slice(idx, idx + 1200);
    expect(body).toContain("isSelf");
    expect(body).toContain("await hasScopedAccess(req.authUser!.id,");
  });
});
