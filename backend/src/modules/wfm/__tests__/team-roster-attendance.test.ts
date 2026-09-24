import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = await vi.hoisted(async () => (await import("./__fixtures__/team-roster-fake-db.js")).createFakeDb());
const mocks = vi.hoisted(() => ({ weekoff: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: fake }));
// The register's week-off engine is payroll code; it is stubbed (not re-implemented) so the test can pin its output.
vi.mock("../../payroll/weekoff-eligibility.service.js", () => ({ calculateWeekoffEligibility: mocks.weekoff }));

import { attendanceRegisterMonthly } from "../../reporting/executors/attendance.executor.js";
import { ATTENDANCE_LEGEND, getTeamAttendance, getTeamAttendanceDetail, toAttendanceRow, validateMonth } from "../team-roster-attendance.js";
import {
  ATTENDANCE_STATUS_CODE, computePaidBase, computeSalDays, computeTotalWorkingDays, countDayCodes,
} from "../../../shared/attendanceDayCounts.js";
import { rows } from "./__fixtures__/team-roster-fake-db.js";
import { installBase, istDate } from "./__fixtures__/team-roster-scenario.js";

const actor = { id: "mgr-user", role: "employee", roles: ["employee"] };
const month = istDate(-35).slice(0, 7); // always a past month
const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const dayOf = (n: number) => `${month}-${String(n).padStart(2, "0")}`;

const empRow = (id: string, code: string, name: string, extra: Record<string, unknown> = {}) => ({
  employee_id: id, employee_code: code, bio_code: "B1", emp_name: name, department: "Ops", designation: "Agent", profile: "Regular",
  cost_center: "CC-9", emp_location: "Noida", process_name: "Collections", process_lob_name: "Voice", billable: "Yes", employee_status: "Active",
  date_of_joining: "2020-01-01", date_of_exit: null, doj_display: "01-01-2020", salary_start_date_display: "01-01-2020", raw_minutes: 0, is_regularized: 0,
  day_num: null, attendance_status: null, ...extra,
});
const rec = (id: string, code: string, name: string, day: number, status: string, reg = 0) =>
  empRow(id, code, name, { day_num: day, attendance_status: status, is_regularized: reg });

/** Routes the executor's three queries plus this module's own lookups. */
function registerRoutes(records: Array<Record<string, unknown>>) {
  installBase(fake);
  fake.on(/SELECT COUNT\(DISTINCT e\.id\) AS total FROM employees e/, () => rows([{ total: 2 }]));
  fake.on(/SELECT e\.id FROM employees e WHERE/, () => rows([{ id: "e1" }, { id: "e2" }]));
  fake.on(/FROM employees e LEFT JOIN attendance_daily_record adr/, () => rows(records));
  fake.on(/SELECT id, lob_id FROM employees WHERE id IN/, () => rows([{ id: "e1", lob_id: null }, { id: "e2", lob_id: null }]));
  fake.on(/SELECT id, employee_code FROM employees WHERE employee_code IN/, () => rows([{ id: "e1", employee_code: "MAS1" }, { id: "e2", employee_code: "MAS2" }]));
}

const records = () => [
  rec("e1", "MAS1", "Asha K", 1, "present", 1), rec("e1", "MAS1", "Asha K", 2, "present"), rec("e1", "MAS1", "Asha K", 3, "half_day"),
  rec("e1", "MAS1", "Asha K", 4, "leave_approved"), rec("e1", "MAS1", "Asha K", 5, "week_off"), rec("e1", "MAS1", "Asha K", 6, "holiday"),
  rec("e1", "MAS1", "Asha K", 7, "on_duty"), rec("e1", "MAS1", "Asha K", 8, "lwp"), rec("e1", "MAS1", "Asha K", 9, "missing_punch"),
  empRow("e2", "MAS2", "Ravi S"), // no attendance rows at all
];

beforeEach(() => {
  fake.reset();
  mocks.weekoff.mockReset();
  mocks.weekoff.mockResolvedValue(4);
});

describe("month validation", () => {
  it("rejects a future month, a malformed month and a month before the register begins", () => {
    expect(() => validateMonth("2999-01")).toThrowError(expect.objectContaining({ statusCode: 400, code: "FUTURE_MONTH" }));
    expect(() => validateMonth("2026-13")).toThrowError(expect.objectContaining({ code: "BAD_MONTH" }));
    expect(() => validateMonth("26-01")).toThrowError(expect.objectContaining({ code: "BAD_MONTH" }));
    expect(() => validateMonth("2019-12")).toThrowError(expect.objectContaining({ code: "MONTH_TOO_OLD" }));
  });

  it("accepts the current month and past months", () => {
    const today = istDate(0);
    expect(validateMonth(today.slice(0, 7))).toBe(today.slice(0, 7));
    expect(validateMonth("2026-01", "2026-09-24")).toBe("2026-01");
    expect(() => validateMonth("2026-10", "2026-09-24")).toThrowError(expect.objectContaining({ code: "FUTURE_MONTH" }));
  });

  it("a future month never reaches the database", async () => {
    installBase(fake);
    await expect(getTeamAttendance(actor, { month: "2999-01" })).rejects.toMatchObject({ statusCode: 400, code: "FUTURE_MONTH" });
    expect(fake.log).toHaveLength(0);
  });
});

describe("scope: the caller's reporting tree, decided server-side", () => {
  it("an empty tree (or an unlinked login) returns an empty list and never calls the register", async () => {
    installBase(fake, { team: [] });
    const out = await getTeamAttendance(actor, { month });
    expect(out).toMatchObject({ total: 0, rows: [] });
    expect(fake.statements(/attendance_daily_record adr/)).toHaveLength(0);
    fake.reset();
    installBase(fake, { caller: null });
    expect(await getTeamAttendance(actor, { month })).toMatchObject({ total: 0, rows: [] });
  });

  it("hands the register exactly the caller's tree as an id filter, whatever the client sends", async () => {
    registerRoutes(records());
    await getTeamAttendance(actor, { month, limit: 99999, offset: 0 });
    const count = fake.statements(/SELECT COUNT\(DISTINCT e\.id\) AS total FROM employees e/)[0];
    expect(count.sql).toMatch(/e\.id IN \(\?,\?\)/);
    expect(count.params.slice(0, 2)).toEqual(["e1", "e2"]);
    const page = fake.statements(/SELECT e\.id FROM employees e WHERE/)[0];
    expect(page.sql).toMatch(/LIMIT 500 OFFSET 0/); // capped like the roster grid
    const att = fake.statements(/FROM employees e LEFT JOIN attendance_daily_record adr/)[0];
    expect(att.sql).toMatch(/WHERE e\.id IN \(\?,\?\)/);
  });

  it("search narrows within the tree: only matching team ids reach the register; no match means no register call", async () => {
    registerRoutes(records());
    fake.on(/SELECT id FROM employees WHERE id IN \(.*\) AND \(full_name LIKE/, () => rows([{ id: "e2" }]));
    await getTeamAttendance(actor, { month, search: "ravi" });
    const q = fake.statements(/full_name LIKE/)[0];
    expect(q.params.slice(0, 2)).toEqual(["e1", "e2"]); // the search is AND-ed onto the tree
    expect(fake.statements(/SELECT COUNT\(DISTINCT e\.id\)/)[0].params[0]).toBe("e2");
    fake.reset();
    registerRoutes(records());
    fake.on(/SELECT id FROM employees WHERE id IN \(.*\) AND \(full_name LIKE/, () => rows([]));
    expect(await getTeamAttendance(actor, { month, search: "zzz" })).toMatchObject({ total: 0, rows: [] });
    expect(fake.statements(/SELECT COUNT\(DISTINCT e\.id\)/)).toHaveLength(0);
  });

  it("the drawer detail refuses an employee outside the tree (403) and never calls the register", async () => {
    registerRoutes(records());
    await expect(getTeamAttendanceDetail(actor, "someone-else", month)).rejects.toMatchObject({ statusCode: 403, code: "NOT_IN_TEAM" });
    expect(fake.statements(/attendance_daily_record adr/)).toHaveLength(0);
  });

  it("the register's own executor treats an explicit empty id list as 'nobody' (fail closed)", async () => {
    fake.on(/SELECT COUNT\(DISTINCT e\.id\)/, () => rows([{ total: 0 }]));
    const open = { mode: "all" as const, ids: [] };
    const scope = { companyId: "", isSuperAdmin: false, branchScope: open, processScope: open, departmentScope: open, costCentreScope: open, canViewAllEmployees: false, canViewSensitiveFields: false, canExportSensitiveReports: false, roles: [] };
    await attendanceRegisterMonthly({ month, employeeIds: [] }, scope, { limit: 10, offset: 0, includeTotal: true, mode: "preview" });
    expect(fake.statements(/SELECT COUNT\(DISTINCT e\.id\)/)[0].sql).toMatch(/1 = 0/);
  });
});

describe("parity with the Attendance Register", () => {
  it("day codes come from the register's own status map and fill rule", async () => {
    registerRoutes(records());
    const out = await getTeamAttendance(actor, { month });
    const asha: any = out.rows[0];
    expect(asha.days.slice(0, 9)).toEqual([
      ATTENDANCE_STATUS_CODE.present, ATTENDANCE_STATUS_CODE.present, ATTENDANCE_STATUS_CODE.half_day, ATTENDANCE_STATUS_CODE.leave_approved,
      ATTENDANCE_STATUS_CODE.week_off, ATTENDANCE_STATUS_CODE.holiday, ATTENDANCE_STATUS_CODE.on_duty, ATTENDANCE_STATUS_CODE.lwp, ATTENDANCE_STATUS_CODE.missing_punch,
    ]);
    expect(asha.days.slice(0, 9)).toEqual(["P", "P", "HD", "L", "A", "H", "OD", "A", "A"]);
    expect(asha.days).toHaveLength(daysInMonth);
    expect(new Set(asha.days.slice(9))).toEqual(new Set(["A"])); // no record on an active past date = absent
    expect(asha.regularizedDays).toEqual([1]);
    expect(out.rows[1]).toMatchObject({ code: "MAS2", days: Array(daysInMonth).fill("A") });
  });

  it("month totals equal the shared day-count helpers applied to the same day cells", async () => {
    registerRoutes(records());
    const out = await getTeamAttendance(actor, { month });
    for (const r of out.rows as any[]) {
      const counts = countDayCodes((d) => r.days[d - 1], daysInMonth);
      const paidBase = computePaidBase(counts);
      expect(r.totals).toEqual({
        present: counts.present, absent: counts.absent, onDuty: counts.od, halfDay: counts.hd, leave: counts.leave,
        holiday: counts.holiday, weekOff: 4, totalWorkingDays: computeTotalWorkingDays(paidBase, 4, counts.holiday),
      });
    }
    // the register's week-off engine was asked exactly what the register asks it
    expect(mocks.weekoff).toHaveBeenCalledWith("e1", computePaidBase(countDayCodes((d) => (out.rows[0] as any).days[d - 1], daysInMonth)), month, 1);
  });

  it("a row exposes only manager-safe fields: no salary days, cost centre, biometric code, branch, register LOB text or profile (only the employee LOB name is shown)", async () => {
    registerRoutes(records());
    const out = await getTeamAttendance(actor, { month });
    const asha: any = out.rows[0];
    expect(Object.keys(asha).sort()).toEqual(["code", "days", "designation", "employeeId", "lobName", "name", "processName", "regularizedDays", "totals"]);
    expect(Object.keys(asha.totals).sort()).toEqual(["absent", "halfDay", "holiday", "leave", "onDuty", "present", "totalWorkingDays", "weekOff"]);
    const wire = JSON.stringify(out);
    for (const leaked of ["sal_days", "CC-9", "B1", "Noida", "Voice", "Regular", "cost_center"]) expect(wire).not.toContain(leaked);
    expect(computeSalDays(1, 0, 0, 30)).toBeGreaterThan(0); // (sal days exist in the register; deliberately not surfaced here)
  });

  it("maps each row back to an employee id inside the tree, so the row can open its drawer", async () => {
    registerRoutes(records());
    const out = await getTeamAttendance(actor, { month });
    expect(out.rows.map((r: any) => r.employeeId)).toEqual(["e1", "e2"]);
    expect(out.total).toBe(2);
    expect(out.legend).toEqual(ATTENDANCE_LEGEND);
    expect(out.notes.join(" ")).toMatch(/source of truth/);
  });

  it("detail returns the day-by-day list with weekday, code, regularized flag and the same totals", async () => {
    registerRoutes(records());
    fake.on(/SELECT COUNT\(DISTINCT e\.id\) AS total FROM employees e/, () => rows([{ total: 1 }]));
    fake.on(/SELECT e\.id FROM employees e WHERE/, () => rows([{ id: "e1" }]));
    const out = await getTeamAttendanceDetail(actor, "e1", month);
    expect(out.employee).toMatchObject({ employeeId: "e1", code: "MAS1", name: "Asha K", designation: "Agent", processName: "Collections" });
    expect(out.days).toHaveLength(daysInMonth);
    expect(out.days[0]).toMatchObject({ date: dayOf(1), day: 1, code: "P", regularized: true });
    expect(out.days[2].code).toBe("HD");
    expect(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).toContain(out.days[0].weekday);
    expect(out.totals.present).toBe(2);
    const att = fake.statements(/FROM employees e LEFT JOIN attendance_daily_record adr/)[0];
    expect(att.params.slice(-1)).toEqual(["e1"]); // one employee only
  });
});

describe("toAttendanceRow", () => {
  it("pads to the month length and reads regularized flags", () => {
    const row = toAttendanceRow({ emp_code: "X", emp_name: " Y ", day_1: "P", day_2_reg: true, present_count: "1", total_working_days: "1.5" }, 3);
    expect(row).toMatchObject({ code: "X", name: "Y", days: ["P", "", ""], regularizedDays: [2], totals: { present: 1, totalWorkingDays: 1.5, absent: 0 } });
  });
});
