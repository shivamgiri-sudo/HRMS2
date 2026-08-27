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
      // penny_drop is the overlay read alongside the readiness classification:
      // classifyBankReadiness can never reach READY for a new hire (no db_bill
      // salary history to verify against), so the confirmation that does exist
      // is carried separately. Null here because the penny-drop lookup is a
      // second db.execute call and this test mocks only the first.
      bank: { employee_id: "e1", payable: true, penny_drop: null },
    });
    // Bank report computed once for the whole batch, not once per row.
    expect(buildBankReadinessReport).toHaveBeenCalledTimes(1);
  });

  it("carries a penny-drop confirmation through without touching the classification", async () => {
    execute
      .mockResolvedValueOnce([[
        {
          review_id: "r1", employee_id: "e1", status: "pending_review", package_accepted: 0,
          final_ctc: null, offer_status: "bh_approved", offered_ctc: 45000,
        },
      ]])
      // fetchPennyDropByEmployee's lookup.
      .mockResolvedValueOnce([[
        {
          employee_id: "e1", verification_status: "verified", verification_method: "penny_drop",
          verified_at: "2026-08-20 10:00:00", provider_account_holder_name: "RAHUL SHARMA",
          name_match_score: "100.00",
        },
      ]]);
    getEmployeeBgvStatus.mockResolvedValueOnce({ overall_status: "clear" });
    // The classifier still says not payable — a new hire has no payment history.
    buildBankReadinessReport.mockResolvedValueOnce({
      rows: [{ employee_id: "e1", payable: false, readiness_class: "BLOCKED" }],
    });

    const rows = await getQueue({ status: "pending_review" }, "caller-1") as any[];
    const bank = rows[0].summary.bank;

    expect(bank.penny_drop).toEqual({
      verified: true, status: "verified", method: "penny_drop",
      verified_at: "2026-08-20 10:00:00", account_holder_name: "RAHUL SHARMA", name_match_score: 100,
    });
    // The overlay must not promote the row to payable: the payment file is built
    // from readiness_class === "READY", and a penny drop alone must not put a new
    // hire into a payroll run.
    expect(bank.payable).toBe(false);
    expect(bank.readiness_class).toBe("BLOCKED");
  });

  // Enrichment used to stop at the Pending tab, which left the BGV and Bank tiles on the
  // Approved/Rejected tabs with nothing to draw. It now runs on every tab — bounded by a row
  // cap, so a tab holding years of history never costs one BGV round-trip per row.
  it("enriches approved/rejected too, so their readiness tiles have data", async () => {
    execute
      .mockResolvedValueOnce([[
        { review_id: "r2", employee_id: "e2", status: "approved", package_accepted: 1 },
      ]])
      .mockResolvedValueOnce([[]]); // fetchPennyDropByEmployee
    getEmployeeBgvStatus.mockResolvedValueOnce({ overall_status: "clear" });
    buildBankReadinessReport.mockResolvedValueOnce({ rows: [{ employee_id: "e2", payable: true }] });

    const rows = await getQueue({ status: "approved" }, "caller-1") as any[];

    expect(rows[0].summary.bgv).toEqual({ overall_status: "clear" });
    expect(rows[0].summary.bank.payable).toBe(true);
  });

  it("stops enriching past the row cap instead of paying one BGV call per row", async () => {
    // 121 rows: one more than ENRICH_ROW_CAP.
    const many = Array.from({ length: 121 }, (_, i) => ({
      review_id: `r${i}`, employee_id: `e${i}`, status: "approved", package_accepted: 1,
    }));
    execute
      .mockResolvedValueOnce([many])
      .mockResolvedValueOnce([[]]);
    getEmployeeBgvStatus.mockResolvedValue({ overall_status: "clear" });
    buildBankReadinessReport.mockResolvedValueOnce({ rows: [] });

    const rows = await getQueue({ status: "approved" }, "caller-1") as any[];

    expect(getEmployeeBgvStatus).toHaveBeenCalledTimes(120);
    expect(rows[119].summary).toBeDefined();
    // The uncovered tail carries NO summary at all — the UI reads that as "Not evaluated"
    // rather than as a check that came back empty.
    expect(rows[120].summary).toBeUndefined();
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
