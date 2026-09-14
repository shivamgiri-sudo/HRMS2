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
    // Slot for the per-employee exception-bucket lookup (migration 1652), which
    // processEmployee resolves immediately after the shift window. Empty = this employee
    // has no exception, which is every employee in these fixtures, so no outcome changes.
    .mockResolvedValueOnce([[], []])
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
    .mockResolvedValueOnce([[], []])
    // The engine resolves TWO half-day floors before classifying — biometric and
    // net-login — and they are adjacent reads of attendance_feature_config.
    // Verified by logging the statement sequence: they are calls 11 and 12. An
    // empty result means "unset", which resolves to the 240 default the engine
    // has always applied, so this adds a slot without changing any outcome.
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
      // Slot for the per-employee exception-bucket lookup (migration 1652), which
      // processEmployee resolves immediately after the shift window. Empty = this employee
      // has no exception, which is every employee in these fixtures, so no outcome changes.
      .mockResolvedValueOnce([[], []])
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

  it("keeps approved leave above APR night-shift minutes for payroll status", async () => {
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
      // Slot for the per-employee exception-bucket lookup (migration 1652), which
      // processEmployee resolves immediately after the shift window. Empty = this employee
      // has no exception, which is every employee in these fixtures, so no outcome changes.
      .mockResolvedValueOnce([[], []])
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
      .mockResolvedValueOnce([[{ id: "leave-1" }], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.status).toBe("leave_approved");
    expect(result.source).toBe("dialler");
    expect(result.rawMinutes).toBe(0);
    expect(result.diallerMinutes).toBeNull();
    expect(result.lwpValue).toBe(0);
    expect(result.sourceSystem).toBe("attendance_override");
  });

  it("keeps holiday above APR night-shift minutes for payroll status", async () => {
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
      // Slot for the per-employee exception-bucket lookup (migration 1652), which
      // processEmployee resolves immediately after the shift window. Empty = this employee
      // has no exception, which is every employee in these fixtures, so no outcome changes.
      .mockResolvedValueOnce([[], []])
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
      .mockResolvedValueOnce([[{ id: "holiday-1" }], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.status).toBe("holiday");
    expect(result.source).toBe("dialler");
    expect(result.rawMinutes).toBe(0);
    expect(result.lwpValue).toBe(0);
    expect(result.sourceSystem).toBe("attendance_override");
  });

  it("classifies cross-midnight APR totals as half day when combined minutes are between 240 and 479", async () => {
    setupAprNightShiftBase();
    dbExecute.mockResolvedValueOnce([[
      { ReportDate: "2026-07-25", Net_Login: "02:30:00" },
      { ReportDate: "2026-07-26", Net_Login: "02:30:00" },
    ], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.night_shift_window");
    expect(result.rawMinutes).toBe(300);
    expect(result.status).toBe("half_day");
    expect(result.lwpValue).toBe(0.5);
  });

  it("does not let the post-midnight date steal the shift-start payroll attendance", async () => {
    setupAprNightShiftBase();
    dbExecute.mockResolvedValueOnce([[
      { ReportDate: "2026-07-26", Net_Login: "08:30:00" },
    ], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.sourceRecordDate).toBe("2026-07-25");
    expect(result.sourceSystem).toBe("apr.night_shift_window");
    expect(result.rawMinutes).toBe(510);
    expect(result.status).toBe("present");
    expect(result.sourceReference).toBe("MAS1001");
  });

  it("falls back to APR for operations employees with incomplete master data when biometric is empty", async () => {
    dbExecute
      .mockResolvedValueOnce([[
        {
          employee_code: "MAS1001",
          designation_id: null,
          department_id: "dept-ops-dup",
          process_id: "proc-1",
          branch_id: "branch-1",
          cost_centre_id: "cc-1",
          date_of_joining: "2026-01-01",
          reporting_manager_id: "mgr-1",
          dept_name: "operations",
          designation_name: "",
        },
      ], []])
      .mockResolvedValueOnce([[{
        shift_start_time: "21:00:00",
        shift_end_time: "06:00:00",
      }], []])
      // Slot for the per-employee exception-bucket lookup (migration 1652), which
      // processEmployee resolves immediately after the shift window. Empty = this employee
      // has no exception, which is every employee in these fixtures, so no outcome changes.
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{
        id: "rule-1",
        rule_name: "Ops Rule",
        scope_type: "process",
        designation_id: null,
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
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{
        minutes: 0,
        source_system: "cosec_policy_absence",
        source_reference: null,
      }], []])
      .mockResolvedValueOnce([[
        { ReportDate: "2026-07-25", Net_Login: "05:00:00" },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.night_shift_window");
    expect(result.rawMinutes).toBe(300);
    expect(result.diallerMinutes).toBe(300);
    expect(result.status).toBe("half_day");
    expect(result.lwpValue).toBe(0.5);
  });

  it("trusts an explicit dialler attendance rule even when APR eligibility config does not match", async () => {
    dbExecute
      .mockResolvedValueOnce([[
        {
          employee_code: "MAS1001",
          designation_id: null,
          department_id: null,
          process_id: "proc-1",
          branch_id: "branch-1",
          cost_centre_id: "cc-1",
          date_of_joining: "2026-01-01",
          reporting_manager_id: "mgr-1",
          dept_name: "",
          designation_name: "",
        },
      ], []])
      .mockResolvedValueOnce([[{
        shift_start_time: null,
        shift_end_time: null,
      }], []])
      // Slot for the per-employee exception-bucket lookup (migration 1652), which
      // processEmployee resolves immediately after the shift window. Empty = this employee
      // has no exception, which is every employee in these fixtures, so no outcome changes.
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{
        id: "arc-apr-ops-exec",
        rule_name: "APR Rule",
        scope_type: "process",
        designation_id: null,
        process_id: "proc-1",
        branch_id: "branch-1",
        attendance_source: "dialler",
        full_day_minutes: 480,
        half_day_minutes: 240,
        grace_minutes: 15,
        effective_from: "2026-01-01",
        effective_to: null,
        active_status: 1,
      }], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{
        minutes: 0,
        source_system: "cosec_policy_absence",
        source_reference: null,
      }], []])
      .mockResolvedValueOnce([[
        { ReportDate: "2026-07-25", Net_Login: "08:10:00" },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).not.toBe("cosec_policy_absence");
  });

  it("does not let a global dialler rule override biometric attendance for non-APR employees", async () => {
    dbExecute
      .mockResolvedValueOnce([[
        {
          employee_code: "MAS47814",
          designation_id: "desig-manager",
          department_id: "dept-quality",
          process_id: "proc-1",
          branch_id: "branch-1",
          cost_centre_id: "cc-1",
          date_of_joining: "2026-01-01",
          reporting_manager_id: "mgr-1",
          dept_name: "training and quality",
          designation_name: "manager",
        },
      ], []])
      .mockResolvedValueOnce([[{
        shift_start_time: null,
        shift_end_time: null,
      }], []])
      // Slot for the per-employee exception-bucket lookup (migration 1652), which
      // processEmployee resolves immediately after the shift window. Empty = this employee
      // has no exception, which is every employee in these fixtures, so no outcome changes.
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{
        id: "arc-apr-ops-exec",
        rule_name: "Operations Executive APR Rule",
        scope_type: "global",
        designation_id: null,
        process_id: null,
        branch_id: null,
        attendance_source: "dialler",
        full_day_minutes: 480,
        half_day_minutes: 240,
        grace_minutes: 0,
        effective_from: "2026-06-13",
        effective_to: null,
        active_status: 1,
      }], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{
        minutes: 557,
        source_system: "integration:cosec_sqlserver",
        source_reference: "ibd-1",
      }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      // Same extra slot as the shared base: both half-day floors are resolved
      // before the APR/biometric branch, so this path reads them too.
      .mockResolvedValueOnce([[], []]);

    const result = await attendanceEngineService.processEmployee("emp-1", "2026-07-25");

    expect(result.source).toBe("biometric");
    expect(result.sourceSystem).toBe("integration:cosec_sqlserver");
    expect(result.rawMinutes).toBe(557);
    expect(result.biometricMinutes).toBe(557);
    expect(result.diallerMinutes).toBeNull();
    expect(result.status).toBe("present");
    expect(result.mismatchFlag).toBe(0);
  });
});
