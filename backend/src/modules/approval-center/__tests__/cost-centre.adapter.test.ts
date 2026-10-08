import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["finance_head"];
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles };
});
import { costCentreAdapter } from "../adapters/cost-centre.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const row = (o: any = {}) => ({ id: "c1", cost_centre_code: "CC9", cost_centre_name: "Acme Noida", client_name: "Acme", branch_name: "Noida", process_name: "Voice", status: "pending_l1", created_by: "u-a", submitted_by: "u-a", submitted_by_name: "Ops", submitted_at: "2026-10-01T00:00:00Z", mandated_seats_value: 60, revenue_flag: true, payment_terms: "Net 30", fixed_amount: 100000, ...o });

describe("cost centre adapter", () => {
  it("L1 role sees only pending_l1, minus own", async () => {
    roles = ["finance_head"];
    const { ctx } = fakeCtx({ "GET /api/finance/cost-centres/approval-queue": { data: [row(), row({ id: "c2", status: "pending_l2" }), row({ id: "c3", created_by: "u-me" }), row({ id: "c4", submitted_by: "u-me" })] } });
    const items = await costCentreAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["c1"]);
    expect(items[0].stage).toContain("L1");
    expect(field(items[0], "Mandated seats")).toBe("60");
    expect(field(items[0], "Fixed amount")).toBe("₹1,00,000");
    expect(field(items[0], "Revenue")).toBe("Yes");
    expect(items[0].viewPath).toBe("/finance/cost-centres?approvalId=c1");
  });
  it("admin sees both stages", async () => {
    roles = ["admin"];
    const { ctx } = fakeCtx({ "GET /api/finance/cost-centres/approval-queue": { data: [row(), row({ id: "c2", status: "pending_l2" })] } });
    expect((await costCentreAdapter.list(ctx)).map((i) => i.id)).toEqual(["c1", "c2"]);
  });
  it("decide routes by stage; reject sends reason", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/cost-centres/c1/approve-l1": {}, "POST /api/finance/cost-centres/c1/approve-l2": {}, "POST /api/finance/cost-centres/c1/reject": {} });
    await costCentreAdapter.decide(ctx, { id: "c1", meta: { status: "pending_l1" } }, "approve", "");
    await costCentreAdapter.decide(ctx, { id: "c1", meta: { status: "pending_l2" } }, "approve", "fine");
    await costCentreAdapter.decide(ctx, { id: "c1", meta: { status: "pending_l2" } }, "reject", "dup");
    expect(calls.map((c) => [c.path.split("/").pop(), c.body])).toEqual([
      ["approve-l1", { remarks: undefined }], ["approve-l2", { remarks: "fine" }], ["reject", { reason: "dup" }],
    ]);
  });
});
