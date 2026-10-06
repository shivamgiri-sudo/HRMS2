import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, processEmployee, upsertDailyRecord } = vi.hoisted(() => ({
  dbExecute: vi.fn(), processEmployee: vi.fn(), upsertDailyRecord: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../attendance-engine.service.js", () => ({ attendanceEngineService: { processEmployee, upsertDailyRecord } }));

import { findStaleGradedDays, regradeStaleDays } from "../attendance-stale-regrade.service.js";

function mockDb(candidates: Array<Record<string, unknown>>, runs: Array<Record<string, unknown>> = []) {
  dbExecute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM salary_prep_run")) return [runs, []];
    if (sql.includes("FROM attendance_daily_record adr")) return [candidates, []];
    return [[], []];
  });
}

describe("re-grading days whose evidence arrived after grading (Oct 2026: 110 days absent with 9h+ punches)", () => {
  beforeEach(() => { vi.clearAllMocks(); upsertDailyRecord.mockResolvedValue({}); });

  it("only picks unlocked absent/missing/half days whose sources now hold more minutes than were graded", async () => {
    mockDb([]);
    await findStaleGradedDays("2026-09-29", "2026-10-05");
    const sql = String(dbExecute.mock.calls[0][0]);
    expect(sql).toContain("adr.is_locked = 0 AND adr.override_by IS NULL AND adr.regularization_id IS NULL");
    expect(sql).toContain("'absent', 'missing_punch', 'half_day', 'unreconciled'");
    expect(sql).toContain("FROM wfm_attendance_session s");
    expect(sql).toContain("FROM integration_biometric_daily ibd");
    expect(sql).toContain("FROM apr a");
    expect(sql).toMatch(/> COALESCE\(adr\.biometric_minutes, 0\)/);
    expect(sql).toMatch(/> COALESCE\(adr\.dialler_minutes, 0\)/);
  });

  it("writes only when the engine's answer changed, and holds months with a payroll run", async () => {
    mockDb(
      [
        { employee_id: "e1", d: "2026-10-03", st: "absent", lwp: 1 },     // punches arrived -> present
        { employee_id: "e2", d: "2026-10-04", st: "absent", lwp: 1 },     // still absent -> no write
        { employee_id: "e3", d: "2026-09-30", st: "absent", lwp: 1 },     // September has a run -> held
      ],
      [{ month: "2026-09", status: "processing" }],
    );
    processEmployee.mockImplementation(async (id: string, date: string) =>
      id === "e1" ? { employeeId: id, date, status: "present", lwpValue: 0 } : { employeeId: id, date, status: "absent", lwpValue: 1 });

    const r = await regradeStaleDays("2026-09-29", "2026-10-05");

    expect(r).toEqual({ candidates: 3, regraded: 1, unchanged: 1, heldPayroll: 1, failed: 0 });
    expect(upsertDailyRecord).toHaveBeenCalledTimes(1);
    expect(upsertDailyRecord).toHaveBeenCalledWith({ employeeId: "e1", date: "2026-10-03", status: "present", lwpValue: 0 }, "system:stale-regrade");
    expect(processEmployee).not.toHaveBeenCalledWith("e3", "2026-09-30");
  });
});
