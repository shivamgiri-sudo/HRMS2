import { beforeEach, describe, expect, it, vi } from "vitest";

const { rosterRows } = vi.hoisted(() => ({ rosterRows: { current: [] as unknown[] } }));
const exec = vi.hoisted(() => vi.fn());
vi.mock("../src/db/mysql.js", () => ({ db: { execute: exec, query: exec } }));

import { getRosterViolations, getSummary, getTrend, resolveMonth, todayIst } from "../src/modules/wfm/wfm-compliance-console.service.js";

const days = (emp: string, start: number, n: number, sid = "t1") =>
  Array.from({ length: n }, (_, i) => ({ employee_id: emp, d: `2026-09-${String(start + i).padStart(2, "0")}`, wo: 0, sid }));

beforeEach(() => {
  exec.mockReset();
  exec.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM wfm_shift_template")) return [[{ id: "t1", shift_name: "Day", st: "09:00", et: "18:00", night_shift: 0, productive_minutes: 480, break_entitlement: 60 }], []];
    if (sql.includes("FROM wfm_roster_assignment ra") && sql.includes("ra.shift_template_id AS sid")) return [rosterRows.current, []];
    if (sql.includes("FROM employees e") && sql.includes("branch_master")) {
      return [[{ id: "a", employee_code: "A1", full_name: "Amit", branch_id: "b1", branch_name: "Noida", process_id: "p", process_name: "Voice" }, { id: "b", employee_code: "B1", full_name: "Bina", branch_id: "b1", branch_name: "Noida", process_id: "p", process_name: "Voice" }], []];
    }
    return [[], []];
  });
});

describe("compliance summary / violations / trend agree", () => {
  it("uses one incident list: totals, rule counts, feed size and trend match", async () => {
    // a: 30 consecutive working days, no week-off -> CONSECUTIVE_DAYS + WEEKOFF_FAIRNESS + MAX_HOURS...; b: 1 clean week
    rosterRows.current = [...days("a", 1, 30), ...days("b", 1, 5)];
    const scope = { branchId: "b1" };
    const s = await getSummary(scope, "2026-09", true);
    const feed = await getRosterViolations(scope, "2026-09", { page: 1, pageSize: 200 });
    const t = await getTrend(scope, "2026-09");
    const cur = t.trend[t.trend.length - 1];
    expect(s.totalEmployees).toBe(2);
    expect(s.employeesWithViolations).toBe(1);
    expect(s.compliancePct).toBe(50);
    expect(s.totalViolations).toBe(s.rules.reduce((n, r) => n + r.violationCount, 0));
    expect(feed.totalCount).toBe(s.totalViolations);
    expect(cur.violations).toBe(s.totalViolations);
    expect(cur.compliancePct).toBe(s.compliancePct);
    expect(s.byBranch[0]).toMatchObject({ branchId: "b1", branchName: "Noida", violations: s.totalViolations });
  });

  it("returns null compliance (not 100) when nothing is rostered", async () => {
    rosterRows.current = [];
    const s = await getSummary({}, "2026-08", true);
    expect(s.hasData).toBe(false);
    expect(s.compliancePct).toBeNull();
    expect(s.totalViolations).toBe(0);
  });

  it("filters the feed by rule server-side and reports the true total (not the page size)", async () => {
    rosterRows.current = [...days("a", 1, 30)];
    const all = await getRosterViolations({}, "2026-09", { page: 1, pageSize: 1 }, true);
    expect(all.violations).toHaveLength(1);
    expect(all.totalCount).toBeGreaterThan(1);
    const one = await getRosterViolations({}, "2026-09", { ruleId: "CONSECUTIVE_DAYS", page: 1, pageSize: 50 });
    expect(one.violations.every((v) => v.ruleId === "CONSECUTIVE_DAYS")).toBe(true);
    expect(one.totalCount).toBe(all.counts.byRule.CONSECUTIVE_DAYS);
  });
});

describe("IST period helpers", () => {
  it("uses the IST month, not UTC", () => {
    const utcEvening30th = Date.UTC(2026, 8, 30, 19, 0);
    expect(todayIst(utcEvening30th)).toBe("2026-10-01");
    expect(resolveMonth(undefined, utcEvening30th)).toBe("2026-10");
    expect(resolveMonth("2026-02")).toBe("2026-02");
    expect(resolveMonth("garbage", utcEvening30th)).toBe("2026-10");
  });
});
