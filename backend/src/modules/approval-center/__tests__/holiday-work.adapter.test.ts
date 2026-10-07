import { describe, it, expect, vi } from "vitest";
const hasRole = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: (...a: any[]) => hasRole(...a) }));
import { holidayWorkAdapter } from "../adapters/holiday-work.js";

const listRow = (o: any = {}) => ({ id: "h1", status: "submitted", holiday_name: "Diwali", holiday_type: "national", request_month: "2026-10-01", branch_id: "b1", process_id: "p1", requested_by_name: "Ravi", request_reason: "Client volume", payout_type: "double", payout_rate_multiplier: 2, min_hours_required: 480, created_at: "2026-10-01T05:00:00Z", ...o });

function ctxWith(rows: any[]) {
  const call = vi.fn(async (_m: string, path: string) => {
    if (path.endsWith("/requests")) return { data: rows };
    return { data: { ...rows[0], branch_name: "Pune", process_name: "BPO", designations: [{ designation_name: "Agent" }] } };
  });
  return { userId: "u", call } as any;
}

describe("holidayWorkAdapter", () => {
  it("maps all fields from list + detail and only submitted", async () => {
    hasRole.mockResolvedValue(true);
    const ctx = ctxWith([listRow(), listRow({ id: "h2", status: "payroll_head_approved" })]);
    const items = await holidayWorkAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["h1"]);
    const labels = items[0].fields.map((x) => x.label);
    for (const l of ["Holiday", "Branch", "Process", "Payout policy", "Eligible designations", "Reason", "Minimum hours"]) expect(labels).toContain(l);
    expect(items[0].fields.find((x) => x.label === "Branch")?.value).toBe("Pune");
    expect(items[0].rejectNeedsReason).toBe(false);
    expect(items[0].viewPath).toBe("/payroll/holiday-work?tab=approvals&approvalId=h1");
  });
  it("returns nothing for roles that cannot decide (finance / branch_wfm)", async () => {
    hasRole.mockResolvedValue(false);
    expect(await holidayWorkAdapter.list(ctxWith([listRow()]))).toEqual([]);
  });
  it("decides", async () => {
    const call = vi.fn().mockResolvedValue({});
    await holidayWorkAdapter.decide({ userId: "u", call } as any, { id: "h1" }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("PATCH", "/api/payroll/holiday-work/requests/h1/approve", { body: { action: "approve", remarks: undefined } });
    await holidayWorkAdapter.decide({ userId: "u", call } as any, { id: "h1" }, "reject", "no");
    expect(call).toHaveBeenLastCalledWith("PATCH", "/api/payroll/holiday-work/requests/h1/approve", { body: { action: "reject", remarks: "no" } });
  });
});
