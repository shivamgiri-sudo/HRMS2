import { describe, expect, it } from "vitest";
import { buildMonthlyDays, buildTypeTotals, canCancelLeave, filterHistory, sortLeaves, type HistoryFilters } from "./leaveData";
import type { LeaveRequest } from "@/hooks/useLeaves";

const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "1", employeeId: "e1", employee: { name: "Asha Rao", department: "Ops" }, branch: "Noida", process: "Sales",
  type: "Casual Leave", startDate: "2026-10-05", endDate: "2026-10-06", days: 2, reason: "", status: "approved",
  canReview: false, submittedAt: "2026-10-01T09:00:00", ...over,
});

describe("canCancelLeave", () => {
  const today = "2026-10-02";
  it("allows cancelling any open request", () => {
    expect(canCancelLeave(req({ status: "pending" }), today)).toBe(true);
    expect(canCancelLeave(req({ status: "pending_branch_head" }), today)).toBe(true);
  });
  it("allows cancelling an approved leave only if it has not started", () => {
    expect(canCancelLeave(req({ status: "approved", startDate: "2026-10-03" }), today)).toBe(true);
    expect(canCancelLeave(req({ status: "approved", startDate: "2026-10-02" }), today)).toBe(false);
    expect(canCancelLeave(req({ status: "branch_head_approved", startDate: "2026-09-20" }), today)).toBe(false);
  });
  it("never allows cancelling a finished request", () => {
    for (const status of ["rejected", "branch_head_rejected", "cancelled", "lapsed", "discarded"] as const) {
      expect(canCancelLeave(req({ status, startDate: "2026-12-01" }), today)).toBe(false);
    }
  });
});

describe("chart data", () => {
  const rows = [
    req({ id: "a", startDate: "2026-01-10", endDate: "2026-01-11", days: 2, type: "Casual Leave" }),
    req({ id: "b", startDate: "2026-01-20", endDate: "2026-01-20", days: 1, type: "Earned Leave" }),
    req({ id: "c", startDate: "2026-03-02", endDate: "2026-03-02", days: 0.5, type: "Casual Leave" }),
    req({ id: "d", startDate: "2026-03-05", endDate: "2026-03-05", days: 3, status: "pending" }),
    req({ id: "e", startDate: "2025-12-30", endDate: "2025-12-31", days: 2 }),
  ];
  it("sums approved days per month for the year, 12 buckets, other statuses and years ignored", () => {
    const m = buildMonthlyDays(rows, 2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ month: "Jan", days: 3 });
    expect(m[2]).toEqual({ month: "Mar", days: 0.5 });
    expect(m.reduce((n, x) => n + x.days, 0)).toBe(3.5);
  });
  it("totals approved days per leave type, largest first", () => {
    expect(buildTypeTotals(rows, 2026)).toEqual([
      { type: "Casual Leave", days: 2.5 },
      { type: "Earned Leave", days: 1 },
    ]);
  });
});

describe("filterHistory", () => {
  const none: HistoryFilters = { status: "all", type: "all", month: "all", year: "all", branch: "all", process: "all", search: "" };
  const rows = [
    req({ id: "1", status: "approved", employee: { name: "Asha Rao", department: "Ops" }, branch: "Noida", type: "Casual Leave", startDate: "2026-10-05" }),
    req({ id: "2", status: "rejected", employee: { name: "Bimal Das", department: "Ops" }, branch: "Delhi", type: "Earned Leave", startDate: "2026-09-05" }),
    req({ id: "3", status: "cancelled", employee: { name: "Chitra N", department: "HR" }, branch: "Noida", type: "Casual Leave", startDate: "2025-10-05" }),
    req({ id: "4", status: "pending", startDate: "2026-10-09" }),
    req({ id: "5", status: "pending_branch_head", startDate: "2026-10-09" }),
    req({ id: "6", status: "branch_head_approved", startDate: "2026-08-09" }),
  ];
  const ids = (f: Partial<HistoryFilters>) => filterHistory(rows, { ...none, ...f }).map((r) => r.id);

  it("history excludes open requests entirely (escalated rows no longer appear in both lists)", () => {
    expect(ids({})).toEqual(["1", "2", "3", "6"]);
  });
  it("status groups branch-head decisions with their plain equivalents", () => {
    expect(ids({ status: "approved" })).toEqual(["1", "6"]);
    expect(ids({ status: "cancelled" })).toEqual(["3"]);
  });
  it("filters by type, branch, month, year and a name search", () => {
    expect(ids({ type: "Earned Leave" })).toEqual(["2"]);
    expect(ids({ branch: "Noida" })).toEqual(["1", "3", "6"]);
    expect(ids({ month: "8" })).toEqual(["2"]);
    expect(ids({ year: "2025" })).toEqual(["3"]);
    expect(ids({ search: "  bimal " })).toEqual(["2"]);
  });
});

describe("sortLeaves", () => {
  const rows = [
    req({ id: "a", startDate: "2026-10-05", days: 1, type: "Earned Leave" }),
    req({ id: "b", startDate: "2026-10-09", days: 3, type: "Casual Leave" }),
    req({ id: "c", startDate: "2026-10-01", days: 2, type: "Casual Leave" }),
  ];
  const order = (mode: Parameters<typeof sortLeaves>[1]) => sortLeaves(rows, mode).map((r) => r.id).join("");
  it("sorts by start date, length and type without mutating the input", () => {
    expect(order("newest")).toBe("bac");
    expect(order("oldest")).toBe("cab");
    expect(order("longest")).toBe("bca");
    expect(order("type")).toBe("bca");
    expect(rows.map((r) => r.id).join("")).toBe("abc");
  });
});
