import { describe, it, expect, vi } from "vitest";
const hasRole = vi.fn();
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: (...a: any[]) => hasRole(...a) }));
vi.mock("../../roster-requests/roster-requests.routes.js", () => ({ rolesForKindAction: (k: string) => ["wfm", `role-for-${k}`] }));
import { rosterConflictAdapter, rosterDisputeAdapter, rosterSwapAdapter, rosterWeekoffAdapter } from "../adapters/roster-requests.js";

const mk = (payloadByPath: Record<string, any>) => ({ userId: "u", call: vi.fn(async (_m: string, p: string) => payloadByPath[p]) }) as any;

describe("roster hub adapters", () => {
  it("swap: only counterpart-accepted, role gated, all fields", async () => {
    hasRole.mockResolvedValue(true);
    const ctx = mk({ "/api/wfm-ext/roster/swaps": { data: [
      { id: "s1", status: "pending", counterpart_status: "accepted", requester_name: "A", target_name: "B", swap_date: "2030-01-05", reason: "Exam", created_at: "2030-01-01T00:00:00Z" },
      { id: "s2", status: "pending", counterpart_status: "pending", requester_name: "C", target_name: "D", swap_date: "2030-01-05" },
    ] } });
    const items = await rosterSwapAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["s1"]);
    expect(items[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Requested by", "Swap with", "Swap date", "Reason"]));
    expect(items[0].viewPath).toBe("/wfm/roster-requests?kind=swap&id=s1&approvalId=s1");
    hasRole.mockResolvedValue(false);
    expect(await rosterSwapAdapter.list(ctx)).toEqual([]);
  });
  it("weekoff: maps and decides with reason fallback", async () => {
    hasRole.mockResolvedValue(true);
    const ctx = mk({ "/api/wfm/manager/weekoff-review": { data: [{ id: "w1", employee_name: "E", employee_code: "C1", roster_date: "2030-02-01", employee_rejection_reason: "Family", branch_name: "Pune", process_name: "BPO", shift_name: "Morning", start_time: "09:00:00", end_time: "18:00:00" }] } });
    const items = await rosterWeekoffAdapter.list(ctx);
    expect(items[0].fields.map((x) => x.label)).toEqual(expect.arrayContaining(["Employee", "Branch", "Process", "Roster date", "Shift", "Employee's reason"]));
    expect(items[0].rejectNeedsReason).toBe(true);
    await rosterWeekoffAdapter.decide(ctx, { id: "w1" }, "approve", "");
    expect(ctx.call).toHaveBeenLastCalledWith("POST", "/api/roster-requests/weekoff_rejection/w1/decide", { body: { action: "approve", reason: "Approved via Approval Center" } });
    await rosterWeekoffAdapter.decide(ctx, { id: "w1" }, "reject", "no");
    expect(ctx.call).toHaveBeenLastCalledWith("POST", "/api/roster-requests/weekoff_rejection/w1/decide", { body: { action: "reject", reason: "no" } });
  });
  it("dispute: maps, skips resolved, decides", async () => {
    hasRole.mockResolvedValue(true);
    const ctx = mk({ "/api/roster-gov/manager-review-queue": { data: [
      { id: "d1", first_name: "X", last_name: "Y", employee_code: "C", roster_date: "2030-03-01", dispute_reason: "Wrong shift", shift_name: "Night" },
      { id: "d2", first_name: "Z", dispute_resolved_at: "2030-03-02" },
    ] } });
    const items = await rosterDisputeAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["d1"]);
    await rosterDisputeAdapter.decide(ctx, { id: "d1" }, "reject", "keep");
    expect(ctx.call).toHaveBeenLastCalledWith("POST", "/api/roster-requests/dispute/d1/decide", { body: { action: "reject", reason: "keep" } });
  });
  it("conflict: approve only", async () => {
    hasRole.mockResolvedValue(true);
    const ctx = mk({ "/api/wfm-ext/roster/conflicts": { data: [{ id: "c1", conflict_type: "shift_overlap", employee_names: ["P"], severity: "high", conflict_date: "2030-04-01", description: "Overlap", created_at: "2030-04-01T00:00:00Z" }] } });
    const items = await rosterConflictAdapter.list(ctx);
    expect(items[0].priority).toBe("high");
    expect(items[0].meta).toEqual({ rejectUnsupported: true });
    await rosterConflictAdapter.decide(ctx, { id: "c1" }, "approve", "moved");
    expect(ctx.call).toHaveBeenLastCalledWith("POST", "/api/roster-requests/conflict/c1/decide", { body: { action: "approve", reason: "moved" } });
    await expect(rosterConflictAdapter.decide(ctx, { id: "c1" }, "reject", "x")).rejects.toThrow();
  });
});
