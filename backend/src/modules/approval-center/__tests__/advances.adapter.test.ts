import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
import { advancesAdapter as a } from "../adapters/advances.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const adv = (o: any = {}) => ({ id: "a1", employee_id: "e1", employee_name: "Sam", employee_code: "E3", amount: 8000, advance_date: "2026-10-02", status: "pending", recovery_months: 3, purpose: "Medical", created_at: "2026-10-02T00:00:00Z", ...o });
beforeEach(() => execute.mockReset());

describe("advances adapter", () => {
  it("filters to pending and maps all fields", async () => {
    execute.mockResolvedValue([[{ role_key: "finance" }]]);
    const { ctx, calls } = fakeCtx({ "GET /api/payroll/advances": { data: [adv(), adv({ id: "a2", status: "approved" })], total: 2 } });
    const items = await a.list(ctx);
    expect(calls[0].query).toMatchObject({ page: 1, limit: 100 });
    expect(items.map((i) => i.id)).toEqual(["a1"]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Advance amount", "Advance date", "Recovery months", "Purpose", "Employee code"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/payroll/ho-queues?tab=advances&approvalId=a1");
    expect(items[0].rejectNeedsReason).toBe(false);
  });
  it("hr (can list, cannot decide) gets nothing", async () => {
    execute.mockResolvedValue([[{ role_key: "hr" }]]);
    const { ctx, calls } = fakeCtx({});
    expect(await a.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("decide approve/reject", async () => {
    const { ctx, calls } = fakeCtx({ "PATCH /api/payroll/advances/a1/approve": {}, "PATCH /api/payroll/advances/a1/reject": {} });
    await a.decide(ctx, { id: "a1" }, "approve", "");
    await a.decide(ctx, { id: "a1" }, "reject", "no budget");
    expect(calls.map((c) => [c.method, c.path])).toEqual([["PATCH", "/api/payroll/advances/a1/approve"], ["PATCH", "/api/payroll/advances/a1/reject"]]);
    expect(calls[1].body).toEqual({ reason: "no budget" });
  });
});
