import { describe, expect, it } from "vitest";
import { normalizeSwap, normalizeConflict, normalizeWeekoff, normalizeDispute, sortRequests } from "../normalize";

const now = new Date("2026-10-02T10:00:00Z");

describe("normalize", () => {
  it("maps a swap", () => {
    const r = normalizeSwap({ id: "s1", requester_employee_id: "e1", target_employee_id: "e2", swap_date: "2026-10-10", reason: "family", status: "pending", created_at: "2026-10-01T10:00:00Z", requester_name: "A", target_name: "B" } as any, now);
    expect(r).toMatchObject({ kind: "swap", id: "s1", date: "2026-10-10", employeeName: "A", secondaryName: "B", reason: "family" });
  });
  it("maps a week-off rejection", () => {
    const r = normalizeWeekoff({ id: "w1", employee_id: "e1", employee_name: "A", roster_date: "2026-10-04", employee_rejection_reason: "exam", updated_at: "2026-10-01T10:00:00Z" } as any, now);
    expect(r).toMatchObject({ kind: "weekoff_rejection", reason: "exam" });
  });
  it("maps a dispute", () => {
    const r = normalizeDispute({ id: "d1", employee_id: "e1", first_name: "A", last_name: "B", roster_date: "2026-10-04", dispute_reason: "wrong shift" } as any, now);
    expect(r).toMatchObject({ kind: "dispute", employeeName: "A B", reason: "wrong shift" });
  });
  it("maps a conflict", () => {
    const r = normalizeConflict({ id: "c1", conflict_type: "overlap", conflict_date: "2026-10-04", employee_names: ["A"], employees_involved: ["e1"], description: "double booked", created_at: "2026-10-01T10:00:00Z", status: "open" } as any, now);
    expect(r).toMatchObject({ kind: "conflict", employeeName: "A" });
  });
  it("sorts urgent first, then overdue, then oldest", () => {
    const urgent = normalizeSwap({ id: "u", requester_employee_id: "e", target_employee_id: "f", swap_date: "2026-10-03", status: "pending", created_at: "2026-10-02T09:00:00Z" } as any, now);
    const overdue = normalizeSwap({ id: "o", requester_employee_id: "e", target_employee_id: "f", swap_date: "2026-11-03", status: "pending", created_at: "2026-09-25T09:00:00Z" } as any, now);
    const fresh = normalizeSwap({ id: "f", requester_employee_id: "e", target_employee_id: "f", swap_date: "2026-11-03", status: "pending", created_at: "2026-10-02T09:30:00Z" } as any, now);
    expect(sortRequests([fresh, overdue, urgent]).map((r) => r.id)).toEqual(["u", "o", "f"]);
  });
});
