import { describe, it, expect, vi } from "vitest";
import { loadAttendanceSection } from "../dossier.attendance.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 3);

const monthRows = [
  { month: "2026-07", working_days: "26", present_days: "24", half_days: "1", absent_days: "1", leave_days: "0", missing_punch: "0", late_marks: "2", lop_days: "1.50", late_minutes: "40" },
  { month: "2026-08", working_days: "26", present_days: "22", half_days: "0", absent_days: "0", leave_days: "2", missing_punch: "1", late_marks: "6", lop_days: "0.00", late_minutes: "90" },
];

describe("loadAttendanceSection", () => {
  it("builds monthly rows and totals from the query", async () => {
    const ex = executor({
      "FROM attendance_daily_record": monthRows,
      "FROM attendance_regularization": [{ status: "approved", n: 3 }, { status: "branch_head_approved", n: 1 }, { status: "rejected", n: 2 }, { status: "manager_approved", n: 1 }],
    });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.months).toHaveLength(2);
    expect(s.months[0]).toMatchObject({ month: "2026-07", workingDays: 26, present: 24, halfDay: 1, absent: 1, lateMarks: 2, lopDays: 1.5 });
    expect(s.totals).toMatchObject({ workingDays: 52, present: 46, halfDay: 1, leave: 2, lateMarks: 8 });
    // (46 + 0.5*1 + 2) / 52 * 100 = 93.27 -> 93.3
    expect(s.attendancePct).toBe(93.3);
  });

  it("derives late coming: average per month, average minutes, worst month", async () => {
    const ex = executor({ "FROM attendance_daily_record": monthRows, "FROM attendance_regularization": [] });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.late.totalLateMarks).toBe(8);
    expect(s.late.avgLateMarksPerMonth).toBe(4); // 8 / 2 months with data
    expect(s.late.avgLateMinutes).toBe(16.3); // 130 / 8
    expect(s.late.worstMonth).toEqual({ month: "2026-08", lateMarks: 6 });
  });

  it("buckets regularizations: approved, rejected, pending", async () => {
    const ex = executor({
      "FROM attendance_daily_record": monthRows,
      "FROM attendance_regularization": [{ status: "approved", n: 3 }, { status: "branch_head_approved", n: 1 }, { status: "rejected", n: 2 }, { status: "manager_approved", n: 1 }, { status: "pending", n: 4 }],
    });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.regularizations).toEqual({ total: 11, approved: 4, rejected: 2, pending: 5 });
  });

  it("returns nulls, not zeros, when there is no attendance at all", async () => {
    const ex = executor({ "FROM attendance_daily_record": [], "FROM attendance_regularization": [] });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.months).toEqual([]);
    expect(s.attendancePct).toBeNull();
    expect(s.late.avgLateMarksPerMonth).toBeNull();
    expect(s.late.avgLateMinutes).toBeNull();
    expect(s.late.worstMonth).toBeNull();
  });

  it("binds the employee and window to the attendance query", async () => {
    const ex = executor({ "FROM attendance_daily_record": [], "FROM attendance_regularization": [] });
    await loadAttendanceSection(ex as never, w);
    const call = ex.execute.mock.calls.find(([sql]) => String(sql).includes("FROM attendance_daily_record"))!;
    expect(call[1]).toEqual(["e1", w.start, w.end]);
  });

  it("caps attendance at 100", async () => {
    const ex = executor({
      "FROM attendance_daily_record": [{ month: "2026-08", working_days: "10", present_days: "10", half_days: "0", absent_days: "0", leave_days: "2", missing_punch: "0", late_marks: "0", lop_days: "0", late_minutes: "0" }],
      "FROM attendance_regularization": [],
    });
    expect((await loadAttendanceSection(ex as never, w)).attendancePct).toBe(100);
  });
});
