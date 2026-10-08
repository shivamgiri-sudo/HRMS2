import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { hasRole } = vi.hoisted(() => ({ hasRole: vi.fn(async () => false) }));
vi.mock("../../../../shared/accessGuard.js", () => ({ hasRole }));

// Integration pass: buildManagerDailyBrief now also wires daily-brief-quality.module.ts,
// which reads a SEPARATE upstream pool (db/sourceDb.js's querySource) for
// db_audit.call_quality_assessment. Mocked defensively so this file's tests never attempt
// a real cross-DB connection, matching the convention already used in
// daily-brief-quality.module.test.ts.
const { querySource } = vi.hoisted(() => ({ querySource: vi.fn(async () => []) }));
vi.mock("../../../../db/sourceDb.js", () => ({ querySource }));

import { buildManagerDailyBrief } from "../daily-brief-aggregator.service.js";
import type { RecipientInfo } from "../daily-brief.types.js";

function recipient(teamEmployeeIds: string[]): RecipientInfo {
  return {
    employeeId: "emp-mgr-1",
    userId: "user-mgr-1",
    fullName: "Test Manager",
    role: "team_leader",
    scopeLabel: "Your direct/indirect reports",
    teamEmployeeIds,
    email: "mgr@masindia.com",
  };
}

describe("daily-brief-aggregator: attendance summary", () => {
  beforeEach(() => {
    execute.mockReset();
    hasRole.mockReset().mockResolvedValue(false);
  });

  it("counts present/half-day/absent/missing_punch from attendance_daily_record", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_daily_record")) {
        return [[{
          total: 10,
          expected_to_work: 10,
          present: 6,
          attended_days: 6.5,
          half_day: 1,
          absent: 2,
          missing_punch: 1,
          late_count: 3,
        }]];
      }
      if (sql.includes("FROM attendance_reconciliation_issue")) return [[]];
      if (sql.includes("FROM work_item")) return [[]];
      if (sql.includes("FROM business_action_queue")) return [[{ open_count: 0 }]];
      return [[]];
    });

    const brief = await buildManagerDailyBrief(recipient(["e1", "e2", "e3"]), "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.attendance.present).toBe(6);
    expect(brief.attendance.halfDay).toBe(1);
    expect(brief.attendance.absent).toBe(2);
    expect(brief.attendance.missingPunch).toBe(1);
    expect(brief.attendance.lateCount).toBe(3);
    expect(brief.attendance.expectedToWork).toBe(10);
    expect(brief.attendance.attendancePct).toBe(65); // 6.5/10 * 100

    const attendanceHealth = brief.sourceHealth.find((h) => h.module === "attendance");
    expect(attendanceHealth?.state).toBe("AVAILABLE");
  });

  it("a thrown attendance query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_daily_record")) {
        throw new Error("ER_NO_SUCH_TABLE: simulated failure");
      }
      if (sql.includes("FROM attendance_reconciliation_issue")) return [[]];
      if (sql.includes("FROM work_item")) return [[]];
      if (sql.includes("FROM business_action_queue")) return [[{ open_count: 0 }]];
      return [[]];
    });

    const brief = await buildManagerDailyBrief(recipient(["e1"]), "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    const attendanceHealth = brief.sourceHealth.find((h) => h.module === "attendance");
    expect(attendanceHealth?.state).toBe("ERROR");
    expect(attendanceHealth?.detail).toContain("simulated failure");
    // The payload must not read as "zero absences" when the query actually failed —
    // it must be visibly zero-and-unavailable, not zero-and-clean.
    expect(brief.attendance.absent).toBe(0);
    expect(brief.attendance.present).toBe(0);
  });

  it("payroll_readiness signal is hidden (null, NOT_APPLICABLE) for a non-payroll-role recipient", async () => {
    hasRole.mockResolvedValue(false); // team_leader is not in PAYROLL_ROLES
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_daily_record")) return [[{ total: 0, expected_to_work: 0, present: 0, attended_days: 0, half_day: 0, absent: 0, missing_punch: 0, late_count: 0 }]];
      if (sql.includes("FROM attendance_reconciliation_issue")) return [[]];
      if (sql.includes("FROM work_item")) return [[]];
      if (sql.includes("FROM business_action_queue")) return [[{ open_count: 5 }]];
      return [[]];
    });

    const brief = await buildManagerDailyBrief(recipient(["e1"]), "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.payrollReadiness).toBeNull();
    const payrollHealth = brief.sourceHealth.find((h) => h.module === "payroll_readiness");
    expect(payrollHealth?.state).toBe("NOT_APPLICABLE");
    // The business_action_queue query must never even run for a non-payroll recipient.
    expect(execute).not.toHaveBeenCalledWith(expect.stringContaining("business_action_queue"), expect.anything());
  });

  it("payroll_readiness signal IS populated for a payroll-role recipient", async () => {
    hasRole.mockResolvedValue(true);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_daily_record")) return [[{ total: 0, expected_to_work: 0, present: 0, attended_days: 0, half_day: 0, absent: 0, missing_punch: 0, late_count: 0 }]];
      if (sql.includes("FROM attendance_reconciliation_issue")) return [[]];
      if (sql.includes("FROM work_item")) return [[]];
      if (sql.includes("FROM business_action_queue")) return [[{ open_count: 5 }]];
      return [[]];
    });

    const brief = await buildManagerDailyBrief(recipient(["e1"]), "2026-08-18", "18 Aug 2026, 9:00 AM IST");

    expect(brief.payrollReadiness).not.toBeNull();
    expect(brief.payrollReadiness?.value).toBe(5);
  });
});
