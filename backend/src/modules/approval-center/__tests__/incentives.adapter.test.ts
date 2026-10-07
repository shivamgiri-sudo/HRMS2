import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
import { incentivesAdapter as a } from "../adapters/incentives.js";

const b = (o: any = {}) => ({ id: "b1", incentive_name: "Attendance bonus", incentive_code: "ATT", pay_month: "2026-09", total_employees: 40, total_amount: 120000, status: "pending_approval", remarks: "monthly", created_at: "2026-10-01T00:00:00Z", ...o });
beforeEach(() => execute.mockReset());

describe("incentives adapter", () => {
  it("finance: pending_approval batches + chain rows, no duplicates", async () => {
    execute.mockResolvedValue([[{ role_key: "finance" }]]);
    const { ctx } = fakeCtx({
      "GET /api/incentives/batches": { data: [b(), b({ id: "z", status: "approved" })] },
      "GET /api/incentives/approvals/pending": { data: [b({ id: "c1", status: "approval_chain_active", pending_step: 2, required_role: "operations_head" })] },
    });
    const items = await a.list(ctx);
    expect(items.map((i) => [i.id, i.meta?.mode])).toEqual([["b1", "batch"], ["c1", "chain"]]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Incentive", "Pay month", "Employees", "Total amount"]) expect(labels).toContain(l);
    expect(items[1].stage).toMatch(/step 2/);
    expect(items[1].rejectNeedsReason).toBe(true);
    expect(items[0].viewPath).toBe("/payroll/incentives?approvalId=b1");
  });
  it("non-finance only gets the chain list (already role-filtered server side)", async () => {
    execute.mockResolvedValue([[{ role_key: "branch_head" }]]);
    const { ctx, calls } = fakeCtx({ "GET /api/incentives/approvals/pending": { data: [b({ id: "c1", pending_step: 1, required_role: "branch_head" })] } });
    expect((await a.list(ctx)).map((i) => i.id)).toEqual(["c1"]);
    expect(calls.map((c) => c.path)).toEqual(["/api/incentives/approvals/pending"]);
  });
  it("decide per mode", async () => {
    const { ctx, calls } = fakeCtx({});
    const ok = { "POST /api/incentives/batches/b1/approve": {}, "POST /api/incentives/batches/b1/reject": {}, "POST /api/incentives/batches/c1/step-approve": {}, "POST /api/incentives/batches/c1/step-reject": {} };
    const f2 = fakeCtx(ok);
    await a.decide(f2.ctx, { id: "b1", meta: { mode: "batch" } }, "approve", "");
    await a.decide(f2.ctx, { id: "b1", meta: { mode: "batch" } }, "reject", "dup");
    await a.decide(f2.ctx, { id: "c1", meta: { mode: "chain" } }, "approve", "ok");
    await a.decide(f2.ctx, { id: "c1", meta: { mode: "chain" } }, "reject", "bad data");
    expect(f2.calls.map((c) => c.path.split("/").slice(-1)[0])).toEqual(["approve", "reject", "step-approve", "step-reject"]);
    expect(f2.calls[3].body).toEqual({ reason: "bad data" });
    expect(calls).toHaveLength(0); void ctx;
  });
});
