import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { readinessMock } = vi.hoisted(() => ({ readinessMock: vi.fn() }));
vi.mock("../../../payroll/payroll-governance.service.js", () => ({
  payrollGovernanceService: { readiness: readinessMock },
}));

const { validatePayrollRunCreationMock } = vi.hoisted(() => ({ validatePayrollRunCreationMock: vi.fn() }));
vi.mock("../../../payroll/payroll-branch-readiness.service.js", () => ({
  payrollBranchReadinessService: { validatePayrollRunCreation: validatePayrollRunCreationMock },
}));

import {
  buildPayrollOperationalHint,
  buildPayrollReadinessModule,
  isPayrollEntitledRole,
} from "../daily-brief-payroll.module.js";

const AMOUNT_FIELD_RE = /salary|gross|net_pay|amount|pf_amount|esic_amount/i;

describe("daily-brief-payroll: role gate", () => {
  it("isPayrollEntitledRole is true for payroll-role strings and false for others", () => {
    expect(isPayrollEntitledRole("payroll_head")).toBe(true);
    expect(isPayrollEntitledRole("finance")).toBe(true);
    expect(isPayrollEntitledRole("super_admin")).toBe(true);
    expect(isPayrollEntitledRole("team_leader")).toBe(false);
    expect(isPayrollEntitledRole("branch_head")).toBe(false);
    expect(isPayrollEntitledRole("")).toBe(false);
    expect(isPayrollEntitledRole(undefined as unknown as string)).toBe(false);
  });

  it("SECURITY-CRITICAL: buildPayrollReadinessModule returns NOT_APPLICABLE (not an error, not empty-silent) for role='team_leader'", async () => {
    execute.mockReset();
    const result = await buildPayrollReadinessModule("team_leader", {}, "2026-08-18");

    expect(result.applicable).toBe(false);
    expect(result.sourceHealth.state).toBe("NOT_APPLICABLE");
    expect(result.runs).toEqual([]);
    expect(result.pendingApprovalsCount).toBe(0);
    // The gate must refuse BEFORE any query — salary_prep_run must never be touched.
    expect(execute).not.toHaveBeenCalled();
  });

  it("also refuses for other non-payroll roles (manager, tl, branch_head)", async () => {
    for (const role of ["manager", "tl", "branch_head", "wfm", "qa"]) {
      execute.mockReset();
      const result = await buildPayrollReadinessModule(role, {}, "2026-08-18");
      expect(result.applicable).toBe(false);
      expect(result.sourceHealth.state).toBe("NOT_APPLICABLE");
      expect(execute).not.toHaveBeenCalled();
    }
  });
});

describe("daily-brief-payroll: payroll-role path never touches monetary fields", () => {
  beforeEach(() => {
    execute.mockReset();
    readinessMock.mockReset();
    validatePayrollRunCreationMock.mockReset();
  });

  it("returns run summaries with operational fields only, and no query string names a monetary column", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM salary_prep_run")) {
        return [[
          {
            id: "run-1",
            run_month: "2026-08",
            status: "processing",
            attendance_snapshot_locked: 1,
            compliance_checked: 0,
            validation_status: "pending",
            finance_approved_by: null,
            finance_approved_at: null,
            ceo_acknowledged_by: null,
            ceo_acknowledged_at: null,
          },
        ]];
      }
      return [[]];
    });
    readinessMock.mockResolvedValue({
      summary: { blockers: 2, warnings: 1 },
      categories: {
        bank: { status: "BLOCKED" },
        statutory: { status: "WARNING" },
      },
    });
    validatePayrollRunCreationMock.mockResolvedValue({ blocked: ["Branch A"], ready: ["Branch B"] });

    const result = await buildPayrollReadinessModule("payroll_head", {}, "2026-08-18");

    expect(result.applicable).toBe(true);
    expect(result.sourceHealth.state).toBe("AVAILABLE");
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      runId: "run-1",
      runMonth: "2026-08",
      status: "processing",
      attendanceSnapshotLocked: true,
      complianceChecked: false,
      validationStatus: "pending",
      financeApproved: false,
      ceoAcknowledged: false,
      blockerCount: 2,
      warningCount: 1,
      categoryStatuses: { bank: "BLOCKED", statutory: "WARNING" },
      branchReadinessGaps: { blockedBranches: ["Branch A"], readyBranches: ["Branch B"] },
    });
    expect(result.pendingApprovalsCount).toBe(1);

    // Every SQL string's SELECTED COLUMN LIST (not table/FROM names — "salary_prep_run" itself
    // legitimately contains "salary") must be free of monetary field names.
    for (const call of execute.mock.calls) {
      const sql = String(call[0]);
      const selectClause = sql.match(/SELECT\s+([\s\S]*?)\s+FROM/i)?.[1] ?? "";
      expect(selectClause).not.toMatch(AMOUNT_FIELD_RE);
    }
    // The result object's own keys must not name a monetary field either.
    const resultJson = JSON.stringify(result);
    // categoryStatuses values are readiness *category* names like "bank"/"statutory" —
    // acceptable; this checks no numeric monetary payload leaked into the JSON keys.
    expect(Object.keys(result.runs[0])).not.toEqual(
      expect.arrayContaining(["grossSalary", "netSalary", "amount", "pfAmount", "esicAmount"]),
    );
    expect(resultJson).not.toMatch(/"gross|"net_pay|"pfAmount|"esicAmount/i);
  });

  it("a readiness-service failure is treated as unknown/not-clear (blockerCount -1), never as PASS", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM salary_prep_run")) {
        return [[
          {
            id: "run-2",
            run_month: "2026-08",
            status: "draft",
            attendance_snapshot_locked: 0,
            compliance_checked: 0,
            validation_status: null,
            finance_approved_by: null,
            finance_approved_at: null,
            ceo_acknowledged_by: null,
            ceo_acknowledged_at: null,
          },
        ]];
      }
      return [[]];
    });
    readinessMock.mockRejectedValue(new Error("simulated readiness failure"));
    validatePayrollRunCreationMock.mockResolvedValue({ blocked: [], ready: [] });

    const result = await buildPayrollReadinessModule("finance_head", {}, "2026-08-18");

    expect(result.runs[0].blockerCount).toBe(-1);
    expect(result.runs[0].categoryStatuses._CHECK_ERROR).toContain("simulated readiness failure");
  });

  it("a thrown salary_prep_run query still returns applicable:true with sourceHealth ERROR, never a silent empty pass", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM salary_prep_run")) throw new Error("ER_NO_SUCH_TABLE simulated");
      return [[]];
    });

    const result = await buildPayrollReadinessModule("payroll", {}, "2026-08-18");

    expect(result.applicable).toBe(true);
    expect(result.sourceHealth.state).toBe("ERROR");
    expect(result.sourceHealth.detail).toContain("simulated");
    expect(result.runs).toEqual([]);
  });
});

describe("daily-brief-payroll: buildPayrollOperationalHint never touches salary_prep_run", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns a safe one-liner sourced from attendance_reconciliation_issue only", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_reconciliation_issue")) return [[{ open_count: 3 }]];
      return [[]];
    });

    const hint = await buildPayrollOperationalHint(["e1", "e2"], "2026-08-18");

    expect(hint).toBe("3 unresolved attendance records may block payroll readiness for your team.");
    for (const call of execute.mock.calls) {
      expect(String(call[0])).not.toMatch(/salary_prep_run/i);
    }
  });

  it("returns null when there are zero open issues (no false all-clear message)", async () => {
    execute.mockImplementation(async () => [[{ open_count: 0 }]]);
    const hint = await buildPayrollOperationalHint(["e1"], "2026-08-18");
    expect(hint).toBeNull();
  });

  it("returns null for an empty team without issuing any query", async () => {
    const hint = await buildPayrollOperationalHint([], "2026-08-18");
    expect(hint).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("SECURITY-CRITICAL: never references salary_prep_run even when the underlying query throws", async () => {
    execute.mockImplementation(async () => {
      throw new Error("simulated failure");
    });
    const hint = await buildPayrollOperationalHint(["e1"], "2026-08-18");
    expect(hint).toBeNull();
    for (const call of execute.mock.calls) {
      expect(String(call[0])).not.toMatch(/salary_prep_run/i);
    }
  });
});
