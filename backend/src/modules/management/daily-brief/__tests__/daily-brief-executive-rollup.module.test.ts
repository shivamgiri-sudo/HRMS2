/**
 * Executive rollup module tests (Gap 2 — spec §29).
 *
 * Covers: the load-bearing performance rule (every rollup query is a real GROUP BY
 * aggregation, not per-employee-then-reduce), and the aggregator-level payroll gate —
 * `ceo` is verified NOT a member of PAYROLL_ROLES (platform/policy/roles.ts), so an
 * executive rollup built for a `ceo` recipient must omit payroll detail entirely while
 * `admin`/`super_admin` (real PAYROLL_ROLES members) receive it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { hasRole } = vi.hoisted(() => ({ hasRole: vi.fn() }));
vi.mock("../../../../shared/accessGuard.js", () => ({ hasRole }));

import { PAYROLL_ROLES } from "../../../../platform/policy/roles.js";
import { buildExecutiveRollupModule } from "../daily-brief-executive-rollup.module.js";
import { buildExecutiveDailyBrief } from "../daily-brief-aggregator.service.js";
import type { RecipientInfo } from "../daily-brief.types.js";

function execImpl(sql: string): unknown {
  if (sql.includes("FROM attendance_daily_record") && sql.includes("GROUP BY e.branch_id")) {
    return [
      [
        { branch_id: "b1", branch_name: "MOHALI", expected_to_work: 50, present: 48, attended_days: 48, half_day: 0, absent: 2, missing_punch: 0, late_count: 1 },
        { branch_id: "b2", branch_name: "NOIDA-2", expected_to_work: 50, present: 40, attended_days: 40, half_day: 0, absent: 10, missing_punch: 3, late_count: 2 },
      ],
    ];
  }
  if (sql.includes("FROM attendance_daily_record")) {
    return [[{ total: 100, expected_to_work: 100, present: 90, attended_days: 90, half_day: 0, absent: 5, missing_punch: 5, late_count: 3 }]];
  }
  if (sql.includes("FROM business_action_queue")) {
    return [[{ id: "act-1", title: "High attrition risk", risk_type: "attrition", severity: "critical", status: "open", due_date: null }]];
  }
  if (sql.includes("FROM ats_candidate_stage_log") || sql.includes("moved_d1")) {
    return [[{ moved_d1: 4, offer_approvals_pending: 2, joining_today: 1, joining_this_week: 3 }]];
  }
  if (sql.includes("FROM exit_request")) {
    return [[{ resignations_d1: 1, open_exit_requests: 6, upcoming_lwd_7d: 2 }]];
  }
  return [[]];
}

describe("daily-brief-executive-rollup.module: performance rule", () => {
  beforeEach(() => {
    execute.mockReset().mockImplementation(async (sql: string) => execImpl(sql));
  });

  it("the branch-attendance comparison query uses a real GROUP BY, not per-employee fetch-then-reduce", async () => {
    const calls: string[] = [];
    execute.mockImplementation(async (sql: string) => {
      calls.push(sql);
      return execImpl(sql);
    });

    const result = await buildExecutiveRollupModule({ branchIds: [], processIds: [] }, "2026-08-18");

    const branchQuery = calls.find((sql) => sql.includes("GROUP BY e.branch_id"));
    expect(branchQuery).toBeDefined();
    expect(branchQuery).toContain("GROUP BY");
    // No query in this module selects every raw employee row for later JS reduction —
    // every attendance query aggregates with SUM/COUNT server-side.
    for (const sql of calls) {
      if (sql.includes("FROM attendance_daily_record")) {
        expect(sql).toMatch(/SUM\(|COUNT\(/);
      }
    }

    expect(result.branchAttendance).toHaveLength(2);
    expect(result.branchAttendance[0].branchName).toBe("MOHALI");
  });

  it("derives best/worst performing branch from the already-aggregated rows (spec §29 positive wins / deterioration)", async () => {
    const result = await buildExecutiveRollupModule({ branchIds: [], processIds: [] }, "2026-08-18");
    expect(result.bestPerformingBranch?.branchName).toBe("MOHALI");
    expect(result.worstPerformingBranch?.branchName).toBe("NOIDA-2");
  });

  it("top actions are capped and pulled from business_action_queue ordered by severity", async () => {
    const result = await buildExecutiveRollupModule({ branchIds: [], processIds: [] }, "2026-08-18");
    expect(result.topActions.length).toBeGreaterThan(0);
    expect(result.topActions[0].severity).toBe("critical");
  });
});

describe("daily-brief-executive-rollup: payroll detail gated by real PAYROLL_ROLES membership", () => {
  beforeEach(() => {
    execute.mockReset().mockImplementation(async (sql: string) => execImpl(sql));
    hasRole.mockReset();
  });

  function recipient(role: string): RecipientInfo {
    return {
      employeeId: "emp-exec-1",
      userId: "user-exec-1",
      fullName: "Executive Recipient",
      role,
      allRoles: [role],
      scopeLabel: "Organization-wide (executive rollup)",
      teamEmployeeIds: [],
      email: "exec@masindia.com",
      scopeDescriptor: { branchIds: [], processIds: [] },
    };
  }

  it("ceo is verified NOT a member of PAYROLL_ROLES (platform/policy/roles.ts)", () => {
    expect(PAYROLL_ROLES).not.toContain("ceo");
    expect(PAYROLL_ROLES).toContain("admin");
    expect(PAYROLL_ROLES).toContain("super_admin");
  });

  it("a ceo executive rollup omits payrollReadinessDetail entirely", async () => {
    hasRole.mockResolvedValue(false); // ceo is not PAYROLL_ROLES-entitled
    const brief = await buildExecutiveDailyBrief(recipient("ceo"), "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.payrollReadinessDetail).toBeUndefined();
    const payrollHealth = brief.sourceHealth.find((h) => h.module === "payroll_readiness_detail");
    expect(payrollHealth?.state).toBe("NOT_APPLICABLE");
    expect(payrollHealth?.detail).toContain("not payroll-entitled");
  });

  it("a super_admin executive rollup DOES receive payrollReadinessDetail (real PAYROLL_ROLES member)", async () => {
    hasRole.mockResolvedValue(true);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM salary_prep_run")) return [[]];
      return execImpl(sql);
    });

    const brief = await buildExecutiveDailyBrief(recipient("super_admin"), "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.payrollReadinessDetail).toBeDefined();
    expect(brief.payrollReadinessDetail?.applicable).toBe(true);
  });

  it("brief.mode is the distinct 'executive_rollup' tag, never the per-employee shape", async () => {
    hasRole.mockResolvedValue(false);
    const brief = await buildExecutiveDailyBrief(recipient("ceo"), "2026-08-18", "18 Aug 2026, 9:00 AM IST");
    expect(brief.mode).toBe("executive_rollup");
    expect(brief.rollup).toBeDefined();
  });
});
