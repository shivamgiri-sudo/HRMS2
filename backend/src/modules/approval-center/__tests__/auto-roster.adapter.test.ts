import { describe, it, expect, vi } from "vitest";
// Branch / approver policy is covered in scope.adapters.test.ts (fake DB); this file tests mapping + decide only.
vi.mock("../adapters/_scope.js", async () => (await import("./_scopePassthrough.js")).passthrough);
const scoped = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasScopedAccess: (...a: any[]) => scoped(...a) }));
import { autoRosterAdapter } from "../adapters/auto-roster.js";

const plan = (o: any = {}) => ({ id: "pl1", plan_name: "Week 41", process_id: "pr1", branch_id: "b1", from_date: "2030-01-06", to_date: "2030-01-12", required_headcount: 50, assigned_headcount: 48, approval_status: "submitted", last_coverage_score: 92.5, shrinkage_pct: 15, updated_at: "2030-01-02T00:00:00Z", ...o });
const ctx = (plans: any[]) => ({ userId: "u", call: vi.fn(async (_m: string, p: string) => (p.endsWith("/masters") ? { data: { processes: [{ id: "pr1", process_name: "Sales" }], branches: [{ id: "b1", branch_name: "Pune" }] } } : { data: plans })) }) as any;

describe("autoRosterAdapter", () => {
  it("maps fields, only submitted plans in scope", async () => {
    scoped.mockImplementation(async (_u: string, _r: string[], t: any) => t.processId === "pr1");
    const items = await autoRosterAdapter.list(ctx([plan(), plan({ id: "pl2", approval_status: "draft" }), plan({ id: "pl3", process_id: "other" })]));
    expect(items.map((i) => i.id)).toEqual(["pl1"]);
    expect(scoped).toHaveBeenCalledWith("u", ["process_manager"], { processId: "pr1", branchId: "b1" });
    const labels = items[0].fields.map((x) => x.label);
    for (const l of ["Plan", "Process", "Branch", "From", "To", "Required headcount", "Coverage score"]) expect(labels).toContain(l);
    expect(items[0].fields.find((x) => x.label === "Process")?.value).toBe("Sales");
    expect(items[0].viewPath).toBe("/wfm/roster-insights?tab=heatmap&approvalId=pl1");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("decides", async () => {
    const call = vi.fn().mockResolvedValue({});
    const c = { userId: "u", call } as any;
    await autoRosterAdapter.decide(c, { id: "pl1" }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/wfm/auto-roster/plans/pl1/approve", { body: {} });
    await autoRosterAdapter.decide(c, { id: "pl1" }, "reject", "coverage low");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/wfm/auto-roster/plans/pl1/reject", { body: { remarks: "coverage low" } });
  });
});
