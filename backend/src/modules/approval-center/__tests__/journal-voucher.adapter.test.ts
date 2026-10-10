import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeCtx, field } from "./finance-test-utils.js";
import { journalVoucherAdapter } from "../adapters/journal-voucher.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
import { heldRoles, rolesModule } from "./_literalRoles.js";
vi.mock("../adapters/_roles.js", async () => (await import("./_literalRoles.js")).rolesModule);
beforeEach(() => { heldRoles.list = ["finance_head"]; });
__scopeBeforeEach(() => useScope(ORG_WIDE));

const row = (o: any = {}) => ({ id: "j1", voucherNumber: "JV-1", voucherDate: "2026-10-01", jvType: "accrual", narration: "Accrue rent", referenceNo: "REF1", branchName: "Noida", costCentreName: "CC1", processName: null, totalAmount: 50000, lineCount: 2, status: "pending_approval", createdByName: "Maker", submittedAt: "2026-10-02T00:00:00Z", pendingHours: 60, permissions: { canApprove: true }, ...o });
const detail = { data: { lines: [{ accountLabel: "Rent", debitAmount: 50000, creditAmount: 0, narration: "oct" }, { accountLabel: "Payable", accountHint: "AP", debitAmount: 0, creditAmount: 50000 }] } };

describe("journal voucher adapter", () => {
  it("lists only canApprove rows with posting lines + deep link", async () => {
    const { ctx, calls } = fakeCtx({
      "GET /api/finance/journal-vouchers": { data: { rows: [row(), row({ id: "j2", permissions: { canApprove: false } }), row({ id: "j3", status: "posted" })] } },
      "GET /api/finance/journal-vouchers/j1": detail,
    });
    const items = await journalVoucherAdapter.list(ctx);
    expect(calls[0].query.status).toBe("pending_approval");
    expect(items.map((i) => i.id)).toEqual(["j1"]);
    expect(field(items[0], "Total amount")).toBe("₹50,000");
    expect(field(items[0], "Posting lines")).toContain("Rent — Dr ₹50,000 — oct");
    expect(field(items[0], "Posting lines")).toContain("Payable (AP) — Cr ₹50,000");
    expect(items[0].priority).toBe("high");
    expect(items[0].viewPath).toBe("/finance/ledger?tab=journal&approvalId=j1");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("decide approve -> note, reject -> reason", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/finance/journal-vouchers/j1/approve": {}, "POST /api/finance/journal-vouchers/j1/reject": {} });
    await journalVoucherAdapter.decide(ctx, { id: "j1" }, "approve", "ok");
    await journalVoucherAdapter.decide(ctx, { id: "j1" }, "reject", "wrong account");
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ["/api/finance/journal-vouchers/j1/approve", { note: "ok" }],
      ["/api/finance/journal-vouchers/j1/reject", { reason: "wrong account" }],
    ]);
  });
});
