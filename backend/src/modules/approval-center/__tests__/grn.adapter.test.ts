import { describe, expect, it, vi } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";

let roles = ["finance_head"];
let scope: any = { mode: "all" };
vi.mock("../adapters/finance-shared.js", async () => {
  const actual = await vi.importActual<any>("../adapters/finance-shared.js");
  return { ...actual, callerRoles: async () => roles, callerBranchScope: async () => scope };
});
import { grnAdapter } from "../adapters/grn.js";

const row = (o: any = {}) => ({
  id: "g1", grn_number: null, grn_type: "vendor", branch_id: "b1", branch_name: "Noida", vendor_name: "Acme Ltd",
  vendor_gstin: "07AAAAA0000A1Z5", invoice_number: "INV-9", head: "Repairs", sub_head: "AC", amount: 1000,
  amount_without_tax: 1000, gst_rate: 18, gst_type: "cgst_sgst", tax_amount: 180, amount_with_tax: 1180, pnl_cost_amount: 1000,
  bill_date: "2026-09-01", due_date: "2026-09-30", payment_terms_days: 29, accounting_period: "2026-09", status: "submitted",
  submitted_by: "u-maker", created_by_name: "Maker", description: "AC repair", submitted_at: "2026-10-01T00:00:00Z",
  pending_since: "2026-10-01T00:00:00Z", pending_with: "Branch Head", ...o,
});

function routes(byStatus: Record<string, any[]>) {
  return { "GET /api/finance/grns": (o: any) => ({ data: byStatus[o.query.status] ?? [], total: 0 }) };
}

describe("grn adapter", () => {
  it("maps every component", async () => {
    roles = ["branch_head"]; scope = { mode: "all" };
    const { ctx, calls } = fakeCtx(routes({ submitted: [row()] }));
    const [it1] = await grnAdapter.list(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].query.status).toBe("submitted");
    expect(it1.uid).toBe("grn:g1");
    expect(it1.stage).toContain("Stage 1 of 3");
    expect(field(it1, "Vendor")).toBe("Acme Ltd");
    expect(field(it1, "Total (incl. tax)")).toBe("₹1,180");
    expect(field(it1, "Tax")).toBe("₹180");
    expect(field(it1, "Head")).toBe("Repairs");
    expect(field(it1, "Invoice number")).toBe("INV-9");
    expect(field(it1, "Raised by")).toBe("Maker");
    expect(it1.viewPath).toBe("/finance/grn?approvalId=g1&approvalStatus=submitted");
    expect(it1.rejectNeedsReason).toBe(true);
  });

  it("only queries and returns stages the caller owns", async () => {
    roles = ["accounts_head"];
    const { ctx, calls } = fakeCtx(routes({ submitted: [row()], branch_head_approved: [row({ id: "g2", status: "branch_head_approved" })] }));
    const items = await grnAdapter.list(ctx);
    expect(calls.map((c) => c.query.status)).toEqual(["branch_head_approved"]);
    expect(items.map((i) => i.id)).toEqual(["g2"]);
  });

  it("super_admin sees all three stages", async () => {
    roles = ["super_admin"];
    const { ctx, calls } = fakeCtx(routes({ submitted: [row()], branch_head_approved: [row({ id: "g2", status: "branch_head_approved" })], accounts_head_approved: [row({ id: "g3", status: "accounts_head_approved" })] }));
    const items = await grnAdapter.list(ctx);
    expect(calls).toHaveLength(3);
    expect(items.map((i) => i.id).sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("drops own submissions, prior-stage reviewers and other-branch rows", async () => {
    roles = ["finance_head"]; scope = { mode: "branches", branchIds: ["b1"] };
    const { ctx } = fakeCtx({ ...routes({ accounts_head_approved: [
      row({ id: "own", status: "accounts_head_approved", submitted_by: "u-me" }),
      row({ id: "bh", status: "accounts_head_approved", branch_head_reviewed_by: "u-me" }),
      row({ id: "ah", status: "accounts_head_approved", accounts_head_reviewed_by: "u-me" }),
      row({ id: "far", status: "accounts_head_approved", branch_id: "b9" }),
      row({ id: "ok", status: "accounts_head_approved" }),
    ] }) });
    const items = await grnAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["ok"]);
  });

  it("no matching role -> no calls", async () => {
    roles = ["employee"];
    const { ctx, calls } = fakeCtx({});
    expect(await grnAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("decide approve / reject hit review with decision + reviewNote", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/grns/g1/review": {} });
    await grnAdapter.decide(ctx, { id: "g1" }, "approve", "");
    await grnAdapter.decide(ctx, { id: "g1" }, "reject", "bad bill");
    expect(calls[0].body).toEqual({ decision: "approved", reviewNote: undefined });
    expect(calls[1].body).toEqual({ decision: "rejected", reviewNote: "bad bill" });
  });
});
