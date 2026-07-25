import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute },
}));

import { attendanceEngineService } from "../attendance-engine.service.js";

function setupAprNightShiftBase() {
  dbExecute
    .mockResolvedValueOnce([[
      {
        employee_code: "MAS1001",
        designation_id: "desig-1",
        department_id: "dept-1",
        process_id: "proc-1",
        branch_id: "branch-1",
        cost_centre_id: "cc-1",
        date_of_joining: "2026-01-01",
        reporting_manager_id: "mgr-1",
        dept_name: "operations",
        designation_name: "executive",
      },
    ], []])
    .mockResolvedValueOnce([[{
      shift_start_time: "21:00:00",
      shift_end_time: "06:00:00",
    }], []])
    .mockResolvedValueOnce([[{
      id: "rule-1",
      rule_name: "Ops Rule",
      scope_type: "process",
      designation_id: "desig-1",
      process_id: "proc-1",
      branch_id: "branch-1",
      attendance_source: "biometric",
      full_day_minutes: 540,
      half_day_minutes: 240,
      grace_minutes: 15,
      effective_from: "2026-01-01",
      effective_to: null,
      active_status: 1,
    }], []])
    .mockResolvedValueOnce([[{ cnt: 1 }], []])
    .mockResolvedValueOnce([[{ id: "apr-elig-1" }], []])
    .mockResolvedValueOnce([[{
      minutes: 0,
      source_system: "cosec_policy_absence",
      source_reference: null,
    }], []])
    .mockResolvedValueOnce([[], []])
    .mockResolvedValueOnce([[], []])
    .mockResolvedValueOnce([[], []])
    .mockResolvedValueOnce([[], []])
    .mockResolvedValueOnce([[], []]);
}

describe("attendance engine night-shift process flow", () => {
  beforeEach(() => {
    dbExecute.mockReset();
  });

  it("sums APR minutes across shift start and next date for night-shift employees", async () => {
    setupAprNightShiftBase();
    dbExecute.mockResolvedValueOnce([[
      { ReportDate: "2026-07-25", Net_Login: "04:30:00" },
      { ReportDate: "2026-07-26", Net_Login: "04:30:00" },
    ], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.night_shift_window");
    expect(result.sourceRecordDate).toBe("2026-07-25");
    expect(result.rawMinutes).toBe(540);
    expect(result.diallerMinutes).toBe(540);
    expect(result.status).toBe("present");
    expect(result.lwpValue).toBe(0);

    const aprSqlCall = dbExecute.mock.calls.find(([sql]: [string]) => sql.includes("FROM apr WHERE UserID = ?"));
    expect(aprSqlCall).toBeTruthy();
    expect(aprSqlCall?.[0]).toContain("ReportDate IN (?, ?)");
    expect(aprSqlCall?.[1]).toEqual(["MAS1001", "2026-07-25", "2026-07-26"]);
  });

  it("falls back to dialler sessions across both dates when APR rows are absent", async () => {
    setupAprNightShiftBase();
    dbExecute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ total: 510 }], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("dialer_session_log.night_shift_window");
    expect(result.rawMinutes).toBe(510);
    expect(result.diallerMinutes).toBe(510);
    expect(result.status).toBe("present");
    expect(result.lwpValue).toBe(0);

    const diallerSqlCall = dbExecute.mock.calls.find(([sql]: [string]) => sql.includes("FROM dialer_session_log dsl"));
    expect(diallerSqlCall).toBeTruthy();
    expect(diallerSqlCall?.[0]).toContain("dsl.session_date IN (?, ?)");
    expect(diallerSqlCall?.[1]).toEqual(["emp-1", "2026-07-25", "2026-07-26"]);
  });

  it("marks roster week-off worked when APR night-shift evidence exists", async () => {
    dbExecute
      .mockResolvedValueOnce([[
        {
          employee_code: "MAS1001",
          designation_id: "desig-1",
          department_id: "dept-1",
          process_id: "proc-1",
          branch_id: "branch-1",
          cost_centre_id: "cc-1",
          date_of_joining: "2026-01-01",
          reporting_manager_id: "mgr-1",
          dept_name: "operations",
          designation_name: "executive",
        },
      ], []])
      .mockResolvedValueOnce([[{
        shift_start_time: "21:00:00",
        shift_end_time: "06:00:00",
      }], []])
      .mockResolvedValueOnce([[{
        id: "rule-1",
        rule_name: "Ops Rule",
        scope_type: "process",
        designation_id: "desig-1",
        process_id: "proc-1",
        branch_id: "branch-1",
        attendance_source: "biometric",
        full_day_minutes: 540,
        half_day_minutes: 240,
        grace_minutes: 15,
        effective_from: "2026-01-01",
        effective_to: null,
        active_status: 1,
      }], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
      .mockResolvedValueOnce([[{ id: "apr-elig-1" }], []])
      .mockResolvedValueOnce([[{
        minutes: 0,
        source_system: "cosec_policy_absence",
        source_reference: null,
      }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: "woff-1" }], []])
      .mockResolvedValueOnce([[
        { ReportDate: "2026-07-25", Net_Login: "03:00:00" },
        { ReportDate: "2026-07-26", Net_Login: "02:00:00" },
      ], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.status).toBe("week_off_worked");
    expect(result.source).toBe("dialler");
    expect(result.rawMinutes).toBe(300);
    expect(result.diallerMinutes).toBe(300);
    expect(result.lwpValue).toBe(0);
  });
});
