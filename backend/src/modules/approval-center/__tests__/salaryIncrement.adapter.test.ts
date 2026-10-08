import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../../salary-increment/salaryIncrement.service.js", () => ({
  INCREMENT_ROLE_GATES: { hr_validate: ["admin", "hr", "payroll_head", "super_admin"], approve: ["payroll_head", "super_admin"] },
}));
import { salaryIncrementAdapter as a } from "../adapters/salaryIncrement.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const row = (o: any = {}) => ({
  id: "i1", employee_name: "Asha Rao", employee_code: "E1", branch_name: "Pune", designation_name: "Agent",
  current_ctc: 240000, proposed_ctc: 276000, increment_percentage: 15, effective_from: "2026-11-01",
  reason_code: "Promotion", reason: "Top performer", business_justification: "Retention", status: "submitted",
  created_at: "2026-10-01T00:00:00Z", ...o,
});
const roles = (set: string[]) => execute.mockResolvedValue([set.map((role_key) => ({ role_key }))]);
beforeEach(() => execute.mockReset());

describe("salary increment adapter", () => {
  it("maps every component and routes payroll head to approve", async () => {
    roles(["payroll_head"]);
    const { ctx, calls } = fakeCtx({ "GET /api/salary-increment/": { data: [row(), row({ id: "i2", status: "hr_validated" })] } });
    const items = await a.list(ctx);
    expect(calls[0].query).toMatchObject({ status: "pending", limit: 200 });
    expect(items).toHaveLength(2);
    const labels = items[0].fields.map((x) => x.label);
    for (const l of ["Current CTC (annual)", "Proposed CTC (annual)", "Increment %", "Effective from", "Reason code", "Reason / notes", "Business justification", "Branch", "Designation"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/salary-increment?approvalId=i1");
    expect(items[0].meta?.action).toBe("approve");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("HR sees only submitted rows and validates", async () => {
    roles(["hr"]);
    const { ctx } = fakeCtx({ "GET /api/salary-increment/": { data: [row(), row({ id: "i2", status: "hr_validated" })] } });
    const items = await a.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["i1"]);
    expect(items[0].meta?.action).toBe("hr_validate");
  });
  it("no role -> no call", async () => {
    roles([]);
    const { ctx, calls } = fakeCtx({});
    expect(await a.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide hits /action with the right action", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/salary-increment/i1/action": {} });
    await a.decide(ctx, { id: "i1", meta: { action: "hr_validate" } }, "approve", "ok");
    await a.decide(ctx, { id: "i1", meta: { action: "approve" } }, "approve", "");
    await a.decide(ctx, { id: "i1", meta: { action: "approve" } }, "reject", "too high");
    expect(calls.map((c) => (c.body as any).action)).toEqual(["hr_validate", "approve", "reject"]);
    expect((calls[2].body as any).remarks).toBe("too high");
  });
});
