import { beforeEach, describe, expect, it, vi } from "vitest";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
const { ffAttendanceCheck } = await import("../ff-attendance.js");

const rec = (d: string, status: string, lwp = 0) => ({ d, attendance_status: status, lwp_value: lwp });
function world(rows: unknown[], start = "2026-09-01") {
  execute.mockImplementation(async (sql: string) => String(sql).includes("FROM employees") ? [[{ s: start }]] : [rows]);
}

describe("F&F attendance check", () => {
  beforeEach(() => { execute.mockReset(); });

  it("is complete when every day up to the LWD has a record", async () => {
    world([rec("2026-09-01", "present"), rec("2026-09-02", "week_off"), rec("2026-09-03", "leave_approved"), rec("2026-09-04", "present", 0.5)]);
    const r = await ffAttendanceCheck("e1", "2026-09-04");
    expect(r).toMatchObject({ ok: true, calendar_days: 4, unmarked_days: 0, present_days: 2, leave_days: 1, week_off_holiday_days: 1, lwp_days: 0.5 });
  });

  it("lists the days with no record and refuses ok", async () => {
    world([rec("2026-09-01", "present"), rec("2026-09-04", "present")]);
    const r = await ffAttendanceCheck("e1", "2026-09-04");
    expect(r.ok).toBe(false);
    expect(r.unmarked_dates).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("counts records after the LWD separately and does not pay them", async () => {
    world([rec("2026-09-01", "present"), rec("2026-09-02", "present"), rec("2026-09-03", "present")]);
    const r = await ffAttendanceCheck("e1", "2026-09-02");
    expect(r).toMatchObject({ ok: true, calendar_days: 2, post_exit_records: 1, present_days: 2 });
  });

  it("starts counting from the joining date when that is inside the month", async () => {
    world([rec("2026-09-03", "present"), rec("2026-09-04", "present")], "2026-09-03");
    expect((await ffAttendanceCheck("e1", "2026-09-04")).calendar_days).toBe(2);
  });

  it("is not ok without an LWD or when the read fails", async () => {
    expect((await ffAttendanceCheck("e1", null)).ok).toBe(false);
    execute.mockImplementation(() => { throw new Error("db down"); });
    expect((await ffAttendanceCheck("e1", "2026-09-04")).ok).toBe(false);
  });
});
