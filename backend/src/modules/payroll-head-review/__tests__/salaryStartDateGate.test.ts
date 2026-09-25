import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * approve() must refuse to approve a salary whose start date is not the same on every record.
 *
 * Payroll reads employees.salary_start_date; the HR validation row, the package date and the
 * salary assignment are the other copies. Approving while they disagree is exactly how a wrong
 * date becomes wrong pay, so approve() checks first and tells Payroll Head how to repair it
 * (re-saving the salary start date rewrites every copy).
 */

const { execute, getSalaryStartDateConsistency } = vi.hoisted(() => ({
  execute: vi.fn(),
  getSalaryStartDateConsistency: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../employees/employee-bgv.service.js", () => ({
  getEmployeeBgvStatus: vi.fn(),
}));
vi.mock("../../payroll/bank-payment-readiness.service.js", () => ({
  buildBankReadinessReport: vi.fn(),
}));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({
  createPackage: vi.fn(),
  getPackageById: vi.fn(),
}));
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));
vi.mock(
  "../../payroll/salary-start-date.service.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../payroll/salary-start-date.service.js")
    >()),
    getSalaryStartDateConsistency,
  }),
);

import { approve } from "../payroll-head-review.service.js";

describe("approve() salary start date gate", () => {
  beforeEach(() => {
    execute.mockReset();
    getSalaryStartDateConsistency.mockReset();
  });

  it("refuses with SALARY_DATE_INCONSISTENT and never marks the review approved", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "review-1", status: "pending_review", package_accepted: 1 }],
    ]); // getReviewRow
    getSalaryStartDateConsistency.mockResolvedValueOnce({
      consistent: false,
      expected: "2026-08-31",
      problems: [
        "HR validation date 2026-08-25 differs from employee date 2026-08-31",
      ],
    });

    await expect(approve("emp-1", "user-ph")).rejects.toMatchObject({
      statusCode: 409,
      code: "SALARY_DATE_INCONSISTENT",
      message: expect.stringContaining("Re-save the salary start date"),
    });

    const sqls = execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("SET status = 'approved'"))).toBe(false);
  });

  it("does not consult the dates when the package has not been accepted yet", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "review-1", status: "pending_review", package_accepted: 0 }],
    ]);
    await expect(approve("emp-1", "user-ph")).rejects.toMatchObject({
      code: "PACKAGE_NOT_ACCEPTED",
    });
    expect(getSalaryStartDateConsistency).not.toHaveBeenCalled();
  });
});
