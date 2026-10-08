import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Retiring a salary package.
 *
 * salary_package_master has always carried active_status, but nothing honoured
 * it: listPackages selected WHERE 1=1, and that endpoint fills every package
 * dropdown in the product -- both of the Payroll Head review page's and the
 * onboarding offer form's. A package could be marked inactive and still be
 * picked, so the flag was decorative.
 *
 * The package-admin screen's own button made it worse: it asked "Deactivate this
 * package?" and then called DELETE, destroying the row and the component breakup
 * of a package employees may already have been assigned.
 *
 * Two properties make retirement safe, and both are asserted here:
 *   - inactive packages disappear from selection;
 *   - anyone already assigned still resolves their package, so no salary moves.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const svc = await import("../payrollMasters.service.js");

const sqlOf = (call: number) => String(execute.mock.calls[call][0]);

describe("listPackages — retired packages leave the dropdowns", () => {
  beforeEach(() => { execute.mockReset().mockResolvedValue([[]]); });

  it("excludes inactive packages by default", async () => {
    await svc.listPackages({ branch: "NOIDA" });
    expect(sqlOf(0)).toMatch(/spm\.active_status = 1/);
  });

  it("excludes them even with no filters at all", async () => {
    await svc.listPackages();
    expect(sqlOf(0)).toMatch(/spm\.active_status = 1/);
  });

  it("includes them only when the admin screen explicitly asks", async () => {
    await svc.listPackages({ branch: "NOIDA", includeInactive: true });
    expect(sqlOf(0)).not.toMatch(/spm\.active_status = 1/);
  });

  it("still applies the band/branch filters alongside the active filter", async () => {
    await svc.listPackages({ branch: "NOIDA", band: "G" });
    const sql = sqlOf(0);
    expect(sql).toMatch(/spm\.band_code = \?/);
    expect(sql).toMatch(/spm\.branch_name = \?/);
    expect(sql).toMatch(/spm\.active_status = 1/);
  });
});

describe("getPackageById — an existing assignment must not break", () => {
  beforeEach(() => { execute.mockReset().mockResolvedValue([[]]); });

  it("does NOT filter on active_status", async () => {
    // Employees already assigned to a package keep resolving it after it is
    // retired. Filtering here would blank their salary breakup instead.
    await svc.getPackageById("pkg-1");
    expect(sqlOf(0)).not.toMatch(/active_status/);
  });
});

describe("the admin screen retires rather than deletes", () => {
  const PAGE = readFileSync(
    resolve(process.cwd(), "..", "src", "pages", "NativeSalaryPackageAdmin.tsx"),
    "utf8",
  );
  const ROUTES = readFileSync(
    resolve(process.cwd(), "..", "src", "config", "routes", "payroll.routes.tsx"),
    "utf8",
  );

  it("sets active_status instead of calling DELETE", () => {
    expect(PAGE).toMatch(/hrmsApi\.put\(`\/api\/payroll-masters\/packages\/\$\{p\.id\}`, \{ active_status: next \}\)/);
    expect(PAGE).not.toMatch(/hrmsApi\.delete\(`\/api\/payroll-masters\/packages/);
  });

  it("asks for retired rows, so a deactivated package can be reactivated", () => {
    expect(PAGE).toMatch(/params\.set\('includeInactive', '1'\)/);
  });

  it("is actually rendered, not just imported", () => {
    // It was imported and never mounted; the path redirected elsewhere.
    expect(ROUTES).toMatch(/element=\{<ProtectedRoute[^>]*>[\s\S]{0,200}<NativeSalaryPackageAdmin \/>/);
    expect(ROUTES).not.toMatch(/path="\/payroll\/package-admin"\s+element=\{<Navigate/);
  });

  it("lets payroll_head reach it, and the endpoint that writes the flag", () => {
    const ROUTES_BE = readFileSync(
      resolve(process.cwd(), "src/modules/payroll-masters/payrollMasters.routes.ts"),
      "utf8",
    );
    expect(ROUTES).toMatch(/payroll\/package-admin[\s\S]{0,160}payroll_head/);
    // super_admin is intentionally absent: requireRole short-circuits for it.
    expect(ROUTES_BE).toMatch(/put\('\/packages\/:id', requireRole\('admin', 'finance', 'payroll_head'\)/);
  });
});
