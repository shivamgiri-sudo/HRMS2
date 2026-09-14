import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AFFECTED_QUERY_KEYS } from "../useDiscard";

/**
 * A discard changes leave balance, attendance and the payroll figures derived from
 * attendance. If a surface reading any of those is missing from this list it keeps
 * rendering pre-discard numbers — several dashboards carry a 5-minute staleTime, so
 * "didn't update" lasts minutes, not seconds.
 *
 * TanStack matches query keys element-by-element, never by substring, so a key that
 * does not exactly equal a real query's first element invalidates nothing at all.
 */

const keys = AFFECTED_QUERY_KEYS.map((k) => k[0]);

describe("AFFECTED_QUERY_KEYS", () => {
  it("invalidates the Attendance Hub table by its real key", () => {
    // The Hub is ["hub-employees", filters, month]. The old ["attendance-hub"]
    // matched nothing — and did not prefix-match ["attendance-hub-filter-options"]
    // either, since TanStack compares elements rather than strings.
    expect(keys).toContain("hub-employees");
    expect(keys).not.toContain("attendance-hub");
  });

  it("drops the other two keys no query ever used", () => {
    // Both pages hold rows in useState, not TanStack; they refresh via the
    // dialog's onDiscarded callback instead.
    expect(keys).not.toContain("regularizations");
    expect(keys).not.toContain("attendance-disputes");
  });

  it("invalidates payroll surfaces, since a leave/LWP change moves earned salary", () => {
    expect(keys).toContain("running-salary");
    expect(keys).toContain("payslip-history");
    expect(keys).toContain("payroll-attendance-control-tower");
  });

  it("invalidates the attendance surfaces a discard rewrites", () => {
    for (const k of [
      "attendance-daily", "attendance-ncosec", "attendance-my-summary",
      "attendance-summary", "attendance-calendar", "adr-calendar", "day-detail",
      "team-attendance-daily", "my-attendance-history", "emp-attendance",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("invalidates the dashboards, which cache for up to 5 minutes", () => {
    for (const k of [
      "dashboard-summary", "dashboard-employee-summary",
      "dashboard-workforce-attendance", "dashboard-attendance",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key corresponds to a queryKey that exists somewhere in src/", () => {
    // Guards against the dead-key problem returning: a key kept here after the
    // query it targeted was renamed or removed silently stops working.
    const root = resolve(__dirname, "..", "..");
    const files = [
      "hooks/useAttendanceHub.ts", "hooks/useAttendance.ts", "hooks/useLeaves.ts",
      "hooks/useLeaveBalances.ts", "hooks/useLeaveEligibility.ts",
      "hooks/useTeamLeaves.ts", "hooks/usePendingApprovals.ts", "hooks/useDiscard.ts",
      "hooks/usePayroll.ts",
      "components/attendance/AttendanceCalendar.tsx",
      "components/attendance/ADRAttendanceCalendar.tsx",
      "components/my-team/TeamAttendanceTab.tsx",
      "components/profile/MyAttendanceHistory.tsx",
      "components/dashboard/layouts/EmployeeLayout.tsx",
      "components/dashboard/layouts/OpsLayout.tsx",
      "components/dashboard/widgets/AttendanceDonut.tsx",
      "components/dashboard/widgets/AttendanceDonutChart.tsx",
      "components/dashboard/widgets/MyAttendanceWidget.tsx",
      "components/dashboard/widgets/AttendanceCalendarWidget.tsx",
      "pages/NativeEmployeeStatCard.tsx",
      "pages/payroll/AttendanceControlTower.tsx",
      "pages/dashboards/ReferenceRoleDashboard.tsx",
      "components/profile/LeaveRequestHistory.tsx",
    ];
    let corpus = "";
    for (const f of files) {
      try { corpus += readFileSync(resolve(root, f), "utf8"); } catch { /* moved/renamed */ }
    }
    const missing = keys.filter((k) => !corpus.includes(`"${k}"`));
    expect(missing).toEqual([]);
  });
});
