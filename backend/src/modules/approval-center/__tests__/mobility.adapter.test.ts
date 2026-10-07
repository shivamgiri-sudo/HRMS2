import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx } from "./fakeCtx.js";

const hasRole = vi.hoisted(() => vi.fn());
vi.mock("../adapters/_roles.js", () => ({ callerHasRole: hasRole, callerRoleKeys: vi.fn() }));

import { mobilityAdapter } from "../adapters/mobility.js";

const transfer = (over: Record<string, unknown> = {}) => ({
  id: "t1", employee_id: "e1", transfer_type: "branch", from_value: "Pune", to_value: "Mumbai", effective_date: "2026-11-01", reason: "Business need",
  status: "pending", initiated_by: "hr1", created_at: new Date().toISOString(), employee_name: "Asha Rao", employee_code: "MAS100", ...over,
});
const promo = (over: Record<string, unknown> = {}) => ({
  id: "p1", employee_id: "e2", from_designation: "Executive", to_designation: "Team Lead", from_grade: "G1", to_grade: "G2", effective_date: "2026-11-01",
  salary_revision: 5000, reason: "Top performer", status: "pending", initiated_by: "hr1", created_at: new Date().toISOString(), employee_name: "Ravi K", employee_code: "MAS101", ...over,
});

describe("mobilityAdapter", () => {
  beforeEach(() => hasRole.mockResolvedValue(true));

  it("maps transfers and promotions with every component and tab-aware links", async () => {
    const { ctx, calls } = makeCtx({
      "GET /api/mobility/transfers": { data: [transfer()] },
      "GET /api/mobility/promotions": { data: [promo()] },
    });
    const items = await mobilityAdapter.list(ctx);
    expect(calls.every((c) => c.query?.status === "pending")).toBe(true);
    const [t, p] = items;
    expect(t.kindLabel).toBe("Transfer");
    expect(t.fields.map((f) => f.label)).toEqual(expect.arrayContaining(["Transfer type", "From", "To", "Effective date", "Reason"]));
    expect(t.viewPath).toBe("/mobility?tab=transfers&approvalId=t1");
    expect(t.meta).toEqual({ type: "transfer" });
    expect(p.kindLabel).toBe("Promotion");
    expect(p.fields.map((f) => f.label)).toEqual(expect.arrayContaining(["From designation", "To designation", "From grade", "To grade", "Salary revision", "Effective date", "Reason"]));
    expect(p.fields.find((f) => f.label === "Salary revision")?.value).toBe("₹5,000");
    expect(p.viewPath).toBe("/mobility?tab=promotions&approvalId=p1");
    expect(p.rejectNeedsReason).toBe(false);
  });

  it("filters non-pending rows", async () => {
    const { ctx } = makeCtx({
      "GET /api/mobility/transfers": { data: [transfer({ status: "completed" })] },
      "GET /api/mobility/promotions": { data: [promo({ status: "rejected" })] },
    });
    expect(await mobilityAdapter.list(ctx)).toEqual([]);
  });

  it("returns nothing for callers who are not admin/hr (the GETs would return their own records)", async () => {
    hasRole.mockResolvedValue(false);
    const { ctx, calls } = makeCtx();
    expect(await mobilityAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("routes decide by type with action approved/rejected", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/mobility/transfers/t1": { success: true }, "PATCH /api/mobility/promotions/p1": { success: true } });
    await mobilityAdapter.decide(ctx, { id: "t1", meta: { type: "transfer" } }, "approve", "");
    await mobilityAdapter.decide(ctx, { id: "p1", meta: { type: "promotion" } }, "reject", "Budget freeze");
    expect(calls[0]).toMatchObject({ path: "/api/mobility/transfers/t1", body: { action: "approved", remarks: undefined } });
    expect(calls[1]).toMatchObject({ path: "/api/mobility/promotions/p1", body: { action: "rejected", remarks: "Budget freeze" } });
  });
});
