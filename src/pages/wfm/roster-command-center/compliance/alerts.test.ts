import { describe, expect, it, vi } from "vitest";
import { buildAlerts } from "./ComplianceAlerts";
import { sortRows } from "./ViolationsTable";
import type { ComplianceSummary, FeedRow } from "./types";

const summary = (over: Partial<ComplianceSummary> = {}): ComplianceSummary => ({
  period: "2026-09", hasData: true, compliancePct: 60, totalEmployees: 10, employeesWithViolations: 4, totalViolations: 6,
  rules: [
    { ruleId: "WEEKOFF_FAIRNESS", ruleName: "Week-off Fairness", description: "", threshold: "", severity: "medium", violationCount: 2, employeesAffected: 2 },
    { ruleId: "MIN_REST", ruleName: "Minimum Rest Period", description: "", threshold: "", severity: "high", violationCount: 4, employeesAffected: 3 },
    { ruleId: "MAX_HOURS", ruleName: "Maximum Weekly Hours", description: "", threshold: "", severity: "high", violationCount: 0, employeesAffected: 0 },
  ],
  byBranch: [{ branchId: "b1", branchName: "Noida", score: 50, violations: 5, rostered: 6, employeesWithViolations: 3, trend: -3 }],
  trend: -2, previous: null, history: [], attendance: { through: "2026-09-29", scheduled: 10, adhered: 5, late: 0, absent: 1, missingPunch: 0, unreconciled: 4, excused: 0, adherencePct: 50 },
  generatedAt: "", ...over,
});

describe("buildAlerts", () => {
  const cb = { filterRule: vi.fn(), open: vi.fn() };
  it("orders high severity first and skips rules with zero violations", () => {
    const a = buildAlerts(summary(), cb);
    expect(a.map((x) => x.key)).toEqual(["MIN_REST", "b-b1", "WEEKOFF_FAIRNESS", "unrec"]);
  });
  it("is click-to-filter / click-to-drill", () => {
    const a = buildAlerts(summary(), cb);
    a[0].action(); expect(cb.filterRule).toHaveBeenCalledWith("MIN_REST", "roster");
    a[1].action(); expect(cb.open).toHaveBeenCalledWith({ type: "branch", id: "b1" });
  });
  it("raises nothing without data (no false all-clear or false alarm)", () => {
    expect(buildAlerts(summary({ hasData: false }), cb)).toEqual([]);
    expect(buildAlerts(undefined, cb)).toEqual([]);
  });
});

describe("sortRows", () => {
  const row = (id: string, severity: FeedRow["severity"], date: string): FeedRow => ({ violationId: id, date, employeeId: id, employeeCode: id, employeeName: id, processName: null, branchName: null, ruleId: "MIN_REST", ruleName: "r", severity, shiftName: null, status: "OPEN", details: "", affectedDates: [] });
  it("sorts severity high-first and date desc", () => {
    const rows = [row("a", "low", "2026-09-01"), row("b", "high", "2026-09-02"), row("c", "medium", "2026-09-03")];
    expect(sortRows(rows, "severity", "asc").map((r) => r.violationId)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, "date", "desc").map((r) => r.violationId)).toEqual(["c", "b", "a"]);
  });
});
