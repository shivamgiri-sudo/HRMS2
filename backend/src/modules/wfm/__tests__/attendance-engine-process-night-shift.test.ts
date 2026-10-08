import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute },
}));

import { attendanceEngineService } from "../attendance-engine.service.js";

/**
 * The engine's statements are answered by WHAT they read, not by the order they are issued in.
 *
 * This file used to queue one `mockResolvedValueOnce` per statement. Every query the engine
 * gained since (the wfm_attendance_session read and the night_shift_cross_midnight_merge flag
 * from 3da09af41, the second half-day floor, the exception bucket) shifted every later slot by
 * one, so a fixture meant for "approved leave" was silently handed to the biometric read and
 * the suite failed on `undefined is not iterable` rather than on anything it was written to
 * guard. Routing by table keeps each fixture attached to the read it describes.
 *
 * Anything a test does not set answers as "no rows", which is what an unset feature flag, an
 * empty exception bucket, no leave, no holiday and no session all look like.
 */
type Rows = Record<string, unknown>[];
interface EngineFixture {
  employee?: Rows;
  shift?: Rows;
  rule?: Rows;
  aprEligibilityCount?: Rows;
  aprEligibility?: Rows;
  biometricDaily?: Rows;
  leave?: Rows;
  holiday?: Rows;
  apr?: Rows;
  diallerTotal?: number;
}

const OPS_EXECUTIVE = {
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
};

const NIGHT_SHIFT = { shift_start_time: "21:00:00", shift_end_time: "06:00:00" };
const NO_SHIFT = { shift_start_time: null, shift_end_time: null };

const OPS_BIOMETRIC_RULE = {
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
};

const NO_BIOMETRIC = { minutes: 0, source_system: "cosec_policy_absence", source_reference: null };

function mockEngineDb(fixture: EngineFixture = {}) {
  const f = {
    employee: [OPS_EXECUTIVE],
    shift: [NIGHT_SHIFT],
    rule: [OPS_BIOMETRIC_RULE],
    aprEligibilityCount: [{ cnt: 1 }],
    aprEligibility: [{ id: "apr-elig-1" }],
    biometricDaily: [NO_BIOMETRIC],
    leave: [],
    holiday: [],
    apr: [],
    diallerTotal: 0,
    ...fixture,
  };
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    // dialer_session_log first: its employee_code fallback also joins `employees e`.
    if (sql.includes("FROM dialer_session_log dsl")) return [[{ total: f.diallerTotal }], []];
    // Answer only the ReportDates actually asked for, like the real table would.
    if (sql.includes("SELECT ReportDate, Net_Login FROM apr")) {
      return [f.apr.filter((r) => params.includes(r.ReportDate)), []];
    }
    if (sql.includes("FROM integration_biometric_daily")) return [f.biometricDaily, []];
    if (sql.includes("COUNT(*) AS cnt FROM apr_eligibility_config")) return [f.aprEligibilityCount, []];
    if (sql.includes("FROM apr_eligibility_config")) return [f.aprEligibility, []];
    if (sql.includes("FROM attendance_rule_config")) return [f.rule, []];
    if (sql.includes("FROM leave_request")) return [f.leave, []];
    if (sql.includes("FROM leave_holiday_master")) return [f.holiday, []];
    if (sql.includes("FROM wfm_roster_assignment wra")) return [f.shift, []];
    if (sql.includes("e.employee_code, e.designation_id")) return [f.employee, []];
    return [[], []];
  });
}

function executedSql(): string[] {
  return dbExecute.mock.calls.map(([sql]: [string]) => String(sql));
}

describe("attendance engine night-shift process flow", () => {
  beforeEach(() => {
    dbExecute.mockReset();
  });

  // The dialler files a cross-midnight shift under the date it STARTED (production audit
  // 2026-10-05: 91 of 95 early-morning punch days had their APR on the previous date). Each
  // ReportDate therefore belongs to exactly one attendance date: its own.
  it("credits a night shift with the APR filed on its own start date only", async () => {
    mockEngineDb({
      apr: [
        { ReportDate: "2026-07-25", Net_Login: "09:00:00" },
        { ReportDate: "2026-07-26", Net_Login: "08:30:00" },
      ],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.ReportDate");
    expect(result.sourceRecordDate).toBe("2026-07-25");
    expect(result.rawMinutes).toBe(540);
    expect(result.diallerMinutes).toBe(540);
    expect(result.status).toBe("present");
    expect(result.lwpValue).toBe(0);

    const aprSqlCall = dbExecute.mock.calls.find(([sql]: [string]) =>
      sql.includes("FROM apr WHERE UserID = ?"),
    );
    expect(aprSqlCall).toBeTruthy();
    expect(aprSqlCall?.[0]).toContain("ReportDate IN (?)");
    expect(aprSqlCall?.[1]).toEqual(["MAS1001", "2026-07-25"]);
  });

  // Sep 2026 incident: 79 NOIDA-2 night days were paid from the NEXT night's APR, which was
  // also paid on its own date. One APR day must never feed two attendance dates.
  it("never credits one APR day to two consecutive night-shift dates", async () => {
    mockEngineDb({ apr: [{ ReportDate: "2026-09-06", Net_Login: "08:10:00" }] });

    const sat = await attendanceEngineService.processEmployee("emp-1", "2026-09-05");
    const sun = await attendanceEngineService.processEmployee("emp-1", "2026-09-06");

    expect(sat.rawMinutes).toBe(0);
    expect(sat.status).toBe("absent");
    expect(sun.rawMinutes).toBe(490);
    expect(sun.status).toBe("present");
  });

  it("falls back to the dialler sessions of the same date when APR rows are absent", async () => {
    mockEngineDb({ apr: [], diallerTotal: 510 });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("dialer_session_log.session_date");
    expect(result.rawMinutes).toBe(510);
    expect(result.diallerMinutes).toBe(510);
    expect(result.status).toBe("present");
    expect(result.lwpValue).toBe(0);

    const diallerSqlCall = dbExecute.mock.calls.find(([sql]: [string]) =>
      sql.includes("FROM dialer_session_log dsl"),
    );
    expect(diallerSqlCall).toBeTruthy();
    expect(diallerSqlCall?.[0]).toContain("dsl.session_date IN (?)");
    expect(diallerSqlCall?.[1]).toEqual(["emp-1", "2026-07-25"]);
  });

  // Until f976c1ea6 (owner ruling 2026-09-07) the engine read wfm_roster_assignment for a
  // week-off flag and graded such a day 'week_off' / 'week_off_worked' from the roster. That
  // step was removed on purpose: attendance is graded from evidence alone, so a rostered
  // week-off with APR login is judged on those minutes like any other day. The fixture below is
  // the 5h of APR the old 'week_off_worked' test used, filed on the shift's own date.
  it("grades a rostered week-off on its APR night-shift evidence, not on the roster", async () => {
    mockEngineDb({
      apr: [
        { ReportDate: "2026-07-25", Net_Login: "05:00:00" },
        { ReportDate: "2026-07-26", Net_Login: "02:00:00" },
      ],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.status).toBe("half_day");
    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.ReportDate");
    expect(result.rawMinutes).toBe(300);
    expect(result.diallerMinutes).toBe(300);
    expect(result.lwpValue).toBe(0.5);

    // The roster is still read for shift start/end times, but never for a week-off flag.
    for (const sql of executedSql()) {
      expect(sql).not.toMatch(/week_?off/i);
    }
  });

  it("keeps approved leave above APR night-shift minutes for payroll status", async () => {
    mockEngineDb({
      leave: [{ id: "leave-1" }],
      // APR evidence is present on purpose: approved leave must still win over it.
      apr: [
        { ReportDate: "2026-07-25", Net_Login: "04:30:00" },
        { ReportDate: "2026-07-26", Net_Login: "04:30:00" },
      ],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.status).toBe("leave_approved");
    expect(result.source).toBe("dialler");
    expect(result.rawMinutes).toBe(0);
    expect(result.diallerMinutes).toBeNull();
    expect(result.lwpValue).toBe(0);
    expect(result.sourceSystem).toBe("attendance_override");
  });

  it("keeps holiday above APR night-shift minutes for payroll status", async () => {
    mockEngineDb({
      holiday: [{ id: "holiday-1" }],
      // APR evidence is present on purpose: the holiday must still win over it.
      apr: [
        { ReportDate: "2026-07-25", Net_Login: "04:30:00" },
        { ReportDate: "2026-07-26", Net_Login: "04:30:00" },
      ],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.status).toBe("holiday");
    expect(result.source).toBe("dialler");
    expect(result.rawMinutes).toBe(0);
    expect(result.lwpValue).toBe(0);
    expect(result.sourceSystem).toBe("attendance_override");
  });

  it("classifies a night shift as half day when its own-date APR is between 240 and 479", async () => {
    mockEngineDb({
      apr: [
        { ReportDate: "2026-07-25", Net_Login: "05:00:00" },
        { ReportDate: "2026-07-26", Net_Login: "05:00:00" },
      ],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.ReportDate");
    expect(result.rawMinutes).toBe(300);
    expect(result.status).toBe("half_day");
    expect(result.lwpValue).toBe(0.5);
  });

  it("does not pay a night with no login of its own from the next date's APR", async () => {
    mockEngineDb({
      apr: [{ ReportDate: "2026-07-26", Net_Login: "08:30:00" }],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.sourceRecordDate).toBe("2026-07-25");
    expect(result.rawMinutes).toBe(0);
    expect(result.status).toBe("absent");
    expect(result.sourceReference).toBe("MAS1001");
  });

  it("falls back to APR for operations employees with incomplete master data when biometric is empty", async () => {
    mockEngineDb({
      employee: [{ ...OPS_EXECUTIVE, designation_id: null, department_id: "dept-ops-dup", designation_name: "" }],
      rule: [{ ...OPS_BIOMETRIC_RULE, designation_id: null }],
      // No eligibility row matches: the employee is not configured for APR at all.
      aprEligibility: [],
      apr: [{ ReportDate: "2026-07-25", Net_Login: "05:00:00" }],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).toBe("apr.ReportDate");
    expect(result.rawMinutes).toBe(300);
    expect(result.diallerMinutes).toBe(300);
    expect(result.status).toBe("half_day");
    expect(result.lwpValue).toBe(0.5);
  });

  it("trusts an explicit dialler attendance rule even when APR eligibility config does not match", async () => {
    mockEngineDb({
      employee: [{ ...OPS_EXECUTIVE, designation_id: null, department_id: null, dept_name: "", designation_name: "" }],
      shift: [NO_SHIFT],
      rule: [{
        ...OPS_BIOMETRIC_RULE,
        id: "arc-apr-ops-exec",
        rule_name: "APR Rule",
        designation_id: null,
        attendance_source: "dialler",
        full_day_minutes: 480,
      }],
      aprEligibility: [],
      apr: [{ ReportDate: "2026-07-25", Net_Login: "08:10:00" }],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.source).toBe("dialler");
    expect(result.sourceSystem).not.toBe("cosec_policy_absence");
  });

  it("does not let a global dialler rule override biometric attendance for non-APR employees", async () => {
    mockEngineDb({
      employee: [{
        ...OPS_EXECUTIVE,
        employee_code: "MAS47814",
        designation_id: "desig-manager",
        department_id: "dept-quality",
        dept_name: "training and quality",
        designation_name: "manager",
      }],
      shift: [NO_SHIFT],
      rule: [{
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
      }],
      aprEligibility: [],
      biometricDaily: [{ minutes: 557, source_system: "integration:cosec_sqlserver", source_reference: "ibd-1" }],
    });

    const result = await attendanceEngineService.processEmployee(
      "emp-1",
      "2026-07-25",
    );

    expect(result.source).toBe("biometric");
    expect(result.sourceSystem).toBe("integration:cosec_sqlserver");
    expect(result.rawMinutes).toBe(557);
    expect(result.biometricMinutes).toBe(557);
    expect(result.diallerMinutes).toBeNull();
    expect(result.status).toBe("present");
    expect(result.mismatchFlag).toBe(0);
  });
});
