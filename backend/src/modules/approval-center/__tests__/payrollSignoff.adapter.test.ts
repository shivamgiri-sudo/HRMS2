import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
import { payrollSignoffAdapter as a } from "../adapters/payrollSignoff.js";

const run = (o: any = {}) => ({ id: "r1", run_month: "2026-09", status: "processing", created_by: "system", header_employee_count: 1400, employee_count: 1467, total_net_salary: 61000000, finance_approved_at: null, ceo_acknowledged_at: null, ...o });
const asRoles = (...r: string[]) => execute.mockResolvedValue([r.map((role_key) => ({ role_key }))]);
beforeEach(() => execute.mockReset());

describe("payroll sign-off adapter", () => {
  it("finance sees processing un-approved runs; no reject", async () => {
    asRoles("finance");
    const { ctx, calls } = fakeCtx({ "GET /api/payroll/signoff/runs": { data: [run(), run({ id: "r2", finance_approved_at: "2026-10-01" })] } });
    const items = await a.list(ctx);
    expect(calls).toHaveLength(1);
    expect(items.map((i) => i.id)).toEqual(["r1"]);
    expect(items[0].meta).toMatchObject({ stage: "finance", noReject: true });
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Payroll month", "Total net salary", "Employees on run", "Run status"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/sign-off?approvalId=r1");
  });
  it("ceo sees finance-approved runs above threshold only", async () => {
    asRoles("ceo");
    const { ctx } = fakeCtx({
      "GET /api/payroll/signoff/runs": { data: [run({ id: "r2", status: "approved", finance_approved_at: "2026-10-01" }), run({ id: "r3", status: "approved", finance_approved_at: "2026-10-01" })] },
      "GET /api/payroll/signoff/runs/r2/status": { data: { ceo_required: true } },
      "GET /api/payroll/signoff/runs/r3/status": { data: { ceo_required: false } },
    });
    const items = await a.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["r2"]);
    expect(items[0].meta?.stage).toBe("ceo");
  });
  it("other roles get nothing", async () => {
    asRoles("hr");
    const { ctx, calls } = fakeCtx({});
    expect(await a.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide hits the stage endpoint; reject refused", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/payroll/signoff/runs/r1/finance-approve": {}, "POST /api/payroll/signoff/runs/r2/ceo-acknowledge": {} });
    await a.decide(ctx, { id: "r1", meta: { stage: "finance" } }, "approve", "ok");
    await a.decide(ctx, { id: "r2", meta: { stage: "ceo" } }, "approve", "");
    expect(calls.map((c) => c.path)).toEqual(["/api/payroll/signoff/runs/r1/finance-approve", "/api/payroll/signoff/runs/r2/ceo-acknowledge"]);
    await expect(a.decide(ctx, { id: "r1", meta: { stage: "finance" } }, "reject", "x")).rejects.toThrow();
  });
});
