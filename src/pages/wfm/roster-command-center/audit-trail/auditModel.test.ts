import { describe, it, expect } from "vitest";
import { fmtDate, fmtDateTime, fmtDuration, fmtNum, buildAlerts, sortBy, pageLabel, daysInRange, changeTypeTone, type AuditSummary } from "./auditModel";

const summary = (over: Partial<AuditSummary> = {}): AuditSummary => ({
  period: { from: "2026-09-01", to: "2026-09-30" }, previousPeriod: { from: "2026-08-02", to: "2026-08-31" },
  totalChanges: 100, manualOverrides: 5, overrideRate: 5, engineErrors: 0, byTypeDetail: [], daily: [], topActors: [],
  generationRuns: { auto: 1, manual: 0, total: 1, failed: 0, partial: 0, totalAssignments: 10, totalConflicts: 0 },
  previous: { totalChanges: 0, manualOverrides: 0, overrideRate: 0, runs: 0, conflicts: 0 },
  deltas: { totalChanges: null, manualOverrides: null, runs: null, conflicts: null }, ...over,
});

describe("formatting", () => {
  it("formats DATE and DATETIME strings without timezone shift", () => {
    expect(fmtDate("2026-09-01")).toBe("01/09/2026");
    expect(fmtDate("2026-09-01T18:30:00.000Z")).toBe("01/09/2026"); // string based, no Date() conversion
    expect(fmtDateTime("2026-09-01 09:05:33")).toBe("01/09/2026 09:05");
    expect(fmtDate(null)).toBe("—");
  });
  it("Indian grouping and durations (0s is 0s, not running)", () => {
    expect(fmtNum(1234567)).toBe("12,34,567");
    expect(fmtNum(null)).toBe("—");
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(125)).toBe("2m 5s");
    expect(fmtDuration(null)).toBe("—");
  });
});

describe("buildAlerts", () => {
  it("is empty for a healthy period", () => expect(buildAlerts(summary())).toEqual([]));
  it("orders by severity then count and carries click-to-filter actions", () => {
    const a = buildAlerts(summary({
      engineErrors: 3, overrideRate: 12, manualOverrides: 12,
      generationRuns: { auto: 1, manual: 1, total: 4, failed: 1, partial: 2, totalAssignments: 1, totalConflicts: 9 },
    }));
    expect(a.map((x) => x.key)).toEqual(["engine-errors", "runs-failed", "override-rate", "conflicts", "runs-partial"]);
    expect(a[0].severity).toBe("critical");
    expect(a.filter((x) => x.severity === "critical").length).toBe(2);
    expect(a[a.length - 1].severity).toBe("warning");
    expect(a.find((x) => x.key === "runs-failed")!.action).toEqual({ tab: "runs", runStatus: "failed" });
    expect(a.find((x) => x.key === "override-rate")!.action).toEqual({ tab: "trails", overridesOnly: true });
  });
  it("does not flag override rate when there are no changes", () => {
    expect(buildAlerts(summary({ totalChanges: 0, overrideRate: 0 }))).toEqual([]);
  });
});

describe("sortBy / paging / ranges", () => {
  it("sorts numerically and naturally with nulls last", () => {
    expect(sortBy([{ n: 10 }, { n: 2 }, { n: null }], (r) => r.n, "asc").map((r) => r.n)).toEqual([2, 10, null]);
    expect(sortBy([{ n: 10 }, { n: 2 }, { n: null }], (r) => r.n, "desc").map((r) => r.n)).toEqual([10, 2, null]);
    expect(sortBy([{ s: "E10" }, { s: "E2" }], (r) => r.s, "asc").map((r) => r.s)).toEqual(["E2", "E10"]);
  });
  it("pageLabel is safe when empty", () => {
    expect(pageLabel(0, 0, 0)).toBe("No records");
    expect(pageLabel(50, 50, 1234)).toBe("Showing 51-100 of 1,234");
  });
  it("daysInRange inclusive and capped", () => {
    expect(daysInRange("2026-09-01", "2026-09-07")).toHaveLength(7);
    expect(daysInRange("2026-01-01", "2026-12-31")).toHaveLength(31);
    expect(daysInRange("bad", "2026-01-01")).toEqual([]);
  });
  it("engine errors are red, overrides violet", () => {
    expect(changeTypeTone("engine_error")).toBe("red");
    expect(changeTypeTone("manual_override")).toBe("violet");
  });
});
