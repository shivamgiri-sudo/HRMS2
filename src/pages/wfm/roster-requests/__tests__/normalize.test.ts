import { describe, expect, it } from "vitest";
import { normalizeSwap, normalizeConflict, normalizeWeekoff, normalizeDispute, sortRequests, computeSla, parseDbTimestamp } from "../normalize";

const now = new Date("2026-10-02T10:00:00Z");

describe("normalize", () => {
  it("maps a swap", () => {
    const r = normalizeSwap({ id: "s1", requester_employee_id: "e1", target_employee_id: "e2", swap_date: "2026-10-10", reason: "family", status: "pending", created_at: "2026-10-01T10:00:00Z", requester_name: "A", target_name: "B" } as any, now);
    expect(r).toMatchObject({ kind: "swap", id: "s1", date: "2026-10-10", employeeName: "A", secondaryName: "B", reason: "family" });
  });
  it("carries swap counterpart_status, null for other kinds", () => {
    const s = normalizeSwap({ id: "s2", requester_employee_id: "e1", target_employee_id: "e2", swap_date: "2026-10-10", status: "pending", created_at: "2026-10-01T10:00:00Z", counterpart_status: "declined" } as any, now);
    expect(s.counterpartStatus).toBe("declined");
    expect(normalizeSwap({ id: "s3", swap_date: "2026-10-10" } as any, now).counterpartStatus).toBeNull();
    expect(normalizeDispute({ id: "d9", roster_date: "2026-10-04" } as any, now).counterpartStatus).toBeNull();
  });
  it("maps a week-off rejection", () => {
    const r = normalizeWeekoff({ id: "w1", employee_id: "e1", employee_name: "A", roster_date: "2026-10-04", employee_rejection_reason: "exam", updated_at: "2026-10-01T10:00:00Z" } as any, now);
    expect(r).toMatchObject({ kind: "weekoff_rejection", reason: "exam" });
  });
  it("maps a dispute", () => {
    const r = normalizeDispute({ id: "d1", employee_id: "e1", first_name: "A", last_name: "B", roster_date: "2026-10-04", dispute_reason: "wrong shift" } as any, now);
    expect(r).toMatchObject({ kind: "dispute", employeeName: "A B", reason: "wrong shift" });
  });
  it("ages a dispute from disputed_at, falling back to updated_at", () => {
    const base = { id: "d2", employee_id: "e1", roster_date: "2026-10-20", updated_at: "2026-10-02T09:00:00Z" };
    expect(normalizeDispute({ ...base, disputed_at: "2026-09-28T10:00:00Z" } as any, now)).toMatchObject({ raisedAt: "2026-09-28T10:00:00Z", slaState: "overdue" });
    expect(normalizeDispute({ ...base, disputed_at: null } as any, now)).toMatchObject({ raisedAt: "2026-10-02T09:00:00Z", slaState: "ok" });
  });
  it("ages a week-off rejection from employee_ack_at, falling back to updated_at", () => {
    const base = { id: "w2", employee_id: "e1", roster_date: "2026-10-20", updated_at: "2026-10-02T09:00:00Z" };
    expect(normalizeWeekoff({ ...base, employee_ack_at: "2026-09-28T10:00:00Z" } as any, now)).toMatchObject({ raisedAt: "2026-09-28T10:00:00Z", slaState: "overdue" });
    expect(normalizeWeekoff({ ...base, employee_ack_at: null } as any, now)).toMatchObject({ raisedAt: "2026-10-02T09:00:00Z" });
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

  it("parses a naive DB string as IST (same ageHours as the equivalent Z instant)", () => {
    // 2026-10-02 10:00:00 IST == 04:30Z; now 10:00Z -> 5.5h -> 5
    const naive = computeSla("2026-10-02 10:00:00", "2026-10-20", now);
    const z = computeSla("2026-10-02T04:30:00Z", "2026-10-20", now);
    expect(naive).toEqual(z);
    expect(naive.ageHours).toBe(5);
  });
  it("treats date-only values as IST midnight", () => {
    expect(parseDbTimestamp("2026-10-02")).toBe(Date.parse("2026-10-01T18:30:00Z"));
    expect(parseDbTimestamp("2026-10-02T10:00:00")).toBe(Date.parse("2026-10-02T04:30:00Z"));
    expect(parseDbTimestamp("2026-10-02T10:00:00+05:30")).toBe(Date.parse("2026-10-02T04:30:00Z"));
    expect(Number.isNaN(parseDbTimestamp("nope"))).toBe(true);
  });
  it("uses IST midnight for the 24h shift boundary", () => {
    // shift 2026-10-03 00:00 IST == 2026-10-02T18:30Z
    const at24 = new Date("2026-10-01T18:30:00Z");
    const before = new Date("2026-10-01T18:29:00Z");
    expect(computeSla("2026-10-01 18:00:00", "2026-10-03", at24).state).toBe("urgent");
    expect(computeSla("2026-10-01 18:00:00", "2026-10-03", before).state).toBe("ok");
  });
});

describe("teamRosterHref", () => {
  it("opens the live roster tab on the request's date and employee", async () => {
    const { teamRosterHref } = await import("../deepLink");
    const r = normalizeDispute({ id: "d1", employee_id: "e 1", roster_date: "2026-10-07" } as any, now);
    expect(teamRosterHref(r)).toBe("/wfm/team-roster?tab=roster&date=2026-10-07&employee=e+1");
  });
  it("omits what the request does not know", async () => {
    const { teamRosterHref } = await import("../deepLink");
    const r = normalizeConflict({ id: "c1", conflict_date: "" } as any, now);
    expect(teamRosterHref(r)).toBe("/wfm/team-roster?tab=roster");
  });
});
