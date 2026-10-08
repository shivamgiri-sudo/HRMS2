import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[]]) } }));

import { buildEscalations } from "../metrics.js";
import { streakFor } from "../history.js";
import { cycleMonthOf } from "../payroll-readiness.js";

const calm = (payroll: Record<string, unknown>): any => ({
  branchId: "b1",
  budget: { totalBudget: 100, consumed: 10, reserved: 0 },
  budgetHeader: { missing: false, status: "active" },
  grnStats: { pending: 0, oldestPendingDays: 0, unbudgeted: { count: 0, amountExGst: 0 } },
  shrinkage: { shrinkagePct: 2 },
  prevShrinkage: { shrinkagePct: 2 },
  leaveAging: { oldestDays: 0, over7Days: 0 },
  regularization: { oldestDays: 0, over7Days: 0, escalated: 0 },
  openHiring: { pastDeliveryRequisitions: 0, pastDeliveryOpenPositions: 0 },
  offers: { offered: 0, joined: 0, conversionPct: null },
  headcount: { exitsNotClosed: 0 },
  runningPnl: { dataAvailable: false, opPct: null },
  budgetByHead: { overBudget: [] },
  attrition: null,
  payrollReadiness: {
    cycleMonth: "2026-09",
    calendar: { attendanceCutoff: "2026-10-03", incentiveDeadline: "2026-10-04", branchReadinessDeadline: null, payrollRunDate: "2026-10-10" },
    pendingRegularization: 0, pendingLeave: 0, incentivesExpected: false, incentiveState: "approved",
    pendingIncrements: 0, oldestIncrementDays: 0,
    ...payroll,
  },
});
const keys = (raw: any, date: string) => buildEscalations(raw, date).map((e) => e.key);

describe("cycleMonthOf", () => {
  it("is the previous calendar month, across a year boundary too", () => {
    expect(cycleMonthOf("2026-10-05")).toBe("2026-09");
    expect(cycleMonthOf("2027-01-02")).toBe("2026-12");
  });
});

describe("payroll readiness escalations", () => {
  it("stay silent when everything is done", () => {
    expect(keys(calm({}), "2026-10-05")).toEqual([]);
  });
  it("attendance: only after the cut-off date has passed", () => {
    const raw = calm({ pendingRegularization: 4, pendingLeave: 2 });
    expect(keys(raw, "2026-10-03")).toEqual([]); // cut-off day itself is not late
    expect(keys(raw, "2026-10-04")).toContain("payroll_attendance_open");
  });
  it("attendance: no calendar row means no claim", () => {
    expect(keys(calm({ calendar: null, pendingRegularization: 9 }), "2026-10-20")).toEqual([]);
  });
  it("incentives: flagged only if the branch normally uploads them", () => {
    expect(keys(calm({ incentiveState: "none", incentivesExpected: false }), "2026-10-05")).toEqual([]);
    expect(keys(calm({ incentiveState: "none", incentivesExpected: true }), "2026-10-05")).toContain("payroll_incentive_missing");
  });
  it("incentives: unreadable state (null) makes no claim", () => {
    expect(keys(calm({ incentiveState: null, incentivesExpected: null }), "2026-10-05")).toEqual([]);
  });
  it("incentives uploaded but unapproved after the deadline", () => {
    expect(keys(calm({ incentiveState: "pending_approval" }), "2026-10-05")).toContain("payroll_incentive_unapproved");
    expect(keys(calm({ incentiveState: "pending_approval" }), "2026-10-04")).toEqual([]);
  });
  it("increments: flagged from 3 days before the payroll run", () => {
    const raw = calm({ pendingIncrements: 2, oldestIncrementDays: 6 });
    expect(keys(raw, "2026-10-06")).toEqual([]);
    expect(keys(raw, "2026-10-07")).toContain("payroll_increments_pending");
  });
});

describe("streakFor", () => {
  const run = (d: string) => ({ date: d, key: "__run__" });
  const red = (d: string) => ({ date: d, key: "k" });
  it("counts today as day 1 with no history", () => {
    expect(streakFor("k", "2026-10-10", [])).toEqual({ days: 1, since: "2026-10-10" });
  });
  it("counts consecutive red days with run markers", () => {
    const rows = ["2026-10-09", "2026-10-08", "2026-10-07"].flatMap((d) => [run(d), red(d)]);
    expect(streakFor("k", "2026-10-10", rows)).toEqual({ days: 4, since: "2026-10-07" });
  });
  it("a clean day (run happened, key absent) ends the streak", () => {
    const rows = [run("2026-10-09"), run("2026-10-08"), red("2026-10-08")];
    expect(streakFor("k", "2026-10-10", rows).days).toBe(1);
  });
  it("a day with no run marker is unknown and ends the streak, not bridged", () => {
    const rows = [run("2026-10-09"), red("2026-10-09"), red("2026-10-07"), run("2026-10-07")];
    expect(streakFor("k", "2026-10-10", rows).days).toBe(2);
  });
});
