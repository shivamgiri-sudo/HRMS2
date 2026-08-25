import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two additions built for the Salary Review Queue "sectioned summary cards" feature:
 *
 * 1. getQueue() — for status='pending_review' only, batch-enriches each row with a `summary`
 *    object (offered/final/bgv/bank), reusing the real getEmployeeBgvStatus/buildBankReadinessReport
 *    resolvers rather than a second, drift-prone implementation. Approved/Rejected skip this
 *    entirely (always-small tab only, per the design note in the source).
 * 2. approve() — previously notified only the Branch Head/Payroll HR with just "Monthly CTC: ₹X".
 *    Now also notifies the employee themselves, and both audiences get the full salary breakup.
 */

const { execute, getEmployeeBgvStatus, buildBankReadinessReport, createItem, hasAnyRole, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  getEmployeeBgvStatus: vi.fn(),
  buildBankReadinessReport: vi.fn(),
  createItem: vi.fn().mockResolvedValue(undefined),
  // Default: caller is payroll_head/admin/super_admin — full access, no scoping applied. Tests
  // for the payroll_hr/branch_head scoped path override this per-test.
  hasAnyRole: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../employees/employee-bgv.service.js", () => ({ getEmployeeBgvStatus }));
vi.mock("../../payroll/bank-payment-readiness.service.js", () => ({ buildBankReadinessReport }));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({ createPackage: vi.fn(), getPackageById: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole, buildScopeWhereClause }));

import { getQueue, approve } from "../payroll-head-review.service.js";

describe("getQueue() summary enrichment", () => {
  beforeEach(() => {
    execute.mockReset(); getEmployeeBgvStatus.mockReset(); buildBankReadinessReport.mockReset();
    hasAnyRole.mockReset().mockResolvedValue(true);
    buildScopeWhereClause.mockReset().mockResolvedValue({ sql: "1=1", params: [] });
  });

  it("attaches offered/final/bgv/bank summary for pending_review", async () => {
    execute.mockResolvedValueOnce([[
      {
        review_id: "r1", employee_id: "e1", status: "pending_review", package_accepted: 0,
        final_ctc: null, offer_status: "bh_approved", offered_ctc: 45000,
      },
    ]]);
    getEmployeeBgvStatus.mockResolvedValueOnce({ overall_status: "clear" });
    buildBankReadinessReport.mockResolvedValueOnce({ rows: [{ employee_id: "e1", payable: true }] });

    const rows = await getQueue({ status: "pending_review" }, "caller-1") as any[];

    expect(rows[0].summary).toEqual({
      offered: { status: "bh_approved", ctc: 45000 },
      final: { accepted: false, assigned: false, ctc: null },
      bgv: { overall_status: "clear" },
      bank: { employee_id: "e1", payable: true },
    });
    // Bank report computed once for the whole batch, not once per row.
    expect(buildBankReadinessReport).toHaveBeenCalledTimes(1);
  });

  it("skips BGV/bank enrichment entirely for approved/rejected (no summary field)", async () => {
    execute.mockResolvedValueOnce([[
      { review_id: "r2", employee_id: "e2", status: "approved", package_accepted: 1 },
    ]]);

    const rows = await getQueue({ status: "approved" }, "caller-1") as any[];

    expect(rows[0].summary).toBeUndefined();
    expect(getEmployeeBgvStatus).not.toHaveBeenCalled();
    expect(buildBankReadinessReport).not.toHaveBeenCalled();
  });

  it("scopes payroll_hr/branch_head via buildScopeWhereClause instead of seeing everything", async () => {
    hasAnyRole.mockResolvedValue(false); // not payroll_head/admin/super_admin
    buildScopeWhereClause.mockResolvedValue({ sql: "e.branch_id = ?", params: ["branch-9"] });
    execute.mockResolvedValueOnce([[]]);

    await getQueue({ status: "pending_review" }, "caller-2");

    expect(buildScopeWhereClause).toHaveBeenCalledWith(
      "caller-2",
      expect.arrayContaining(["payroll_head", "payroll_hr", "branch_head"]),
      { branchId: "e.branch_id", processId: "e.process_id" }
    );
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.branch_id = ?");
    expect(params).toContain("branch-9");
  });
});

describe("approve() notification", () => {
  beforeEach(() => { execute.mockReset(); createItem.mockClear(); });

  it("notifies the employee in addition to Branch Head/Payroll HR, with the full breakup", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "review-1", status: "pending_review", package_accepted: 1 }]]) // getReviewRow
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE status='approved'
      .mockResolvedValueOnce(undefined) // audit insert
      .mockResolvedValueOnce(undefined) // writeHistory insert
      .mockResolvedValueOnce([[]]) // resolveRejectionNotifyTargets
      .mockResolvedValueOnce([[{ // empRows: employee + breakup
        full_name: "Jane Doe", employee_code: "E123", user_id: "user-emp-1",
        ctc_annual: 600000, basic: 20000, hra: 8000, conveyance: 1600, special_allowance: 2000,
        gross: 31600, net_in_hand: 28000, ctc: 45000,
      }]])
      .mockResolvedValueOnce([[{ id: "review-1", status: "approved" }]]); // final getReviewRow

    await approve("e1", "actor-1");

    const employeeNotify = createItem.mock.calls.find(([arg]) => arg.user_id === "user-emp-1");
    expect(employeeNotify).toBeTruthy();
    expect(employeeNotify![0].type).toBe("payroll_head_review_approved_employee");
    expect(employeeNotify![0].description).toContain("Basic: ₹20,000");
    expect(employeeNotify![0].description).toContain("CTC (monthly): ₹45,000");
  });
});
