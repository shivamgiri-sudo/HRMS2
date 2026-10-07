import { describe, it, expect } from "vitest";
import { makeCtx } from "./fakeCtx.js";
import { bankChangeAdapter } from "../adapters/bank-change.js";

const row = (over: Record<string, unknown> = {}) => ({
  id: "b1", employee_id: "e1", request_type: "bank_details", status: "pending", requested_at: new Date().toISOString(),
  employee_name: "Asha Rao", employee_code: "MAS100",
  old_values: { bank_name: "SBI", account_number: "11112222333", ifsc_code: "SBIN0001234" },
  new_values: { bank_name: "HDFC", bank_branch: "Pune", account_holder_name: "Asha Rao", account_number: "50100123456789", ifsc_code: "HDFC0000001", account_type: "savings" },
  penny_drop_status: "name_mismatch", beneficiary_name_returned: "A RAO", name_match_tier: "partial", name_match_score: 0.62, employee_name_at_request: "Asha Rao", ...over,
});

describe("bankChangeAdapter", () => {
  it("maps all components with masked account numbers and penny-drop info", async () => {
    const { ctx } = makeCtx({ "GET /api/payroll/bank-change-requests": { data: [row()] } });
    const [it] = await bankChangeAdapter.list(ctx);
    const text = JSON.stringify(it);
    expect(text).not.toContain("50100123456789");
    expect(text).not.toContain("11112222333");
    const by = Object.fromEntries(it.fields.map((f) => [f.label, f.value]));
    expect(by["New account number"]).toBe("****6789");
    expect(by["Current account"]).toBe("****2333");
    expect(by["New IFSC"]).toBe("HDFC0000001");
    expect(by["Penny drop"]).toBe("Name mismatch");
    expect(by["Name returned by bank"]).toBe("A RAO");
    expect(by["Name match"]).toBe("partial");
    expect(by["Name match score"]).toBe("0.62");
    expect(it.fields.map((f) => f.label)).toContain("Heads-up");
    expect(it.viewPath).toBe("/payroll/ho-queues?tab=bankchg&approvalId=b1");
    expect(it.rejectNeedsReason).toBe(false);
  });

  it("a name mismatch does not hide the item; stale items are high priority", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const { ctx } = makeCtx({ "GET /api/payroll/bank-change-requests": { data: [row({ requested_at: old })] } });
    const items = await bankChangeAdapter.list(ctx);
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBe("high");
  });

  it("handles JSON-string values and non-pending rows", async () => {
    const { ctx } = makeCtx({ "GET /api/payroll/bank-change-requests": { data: [row({ new_values: JSON.stringify({ account_number: "123456789" }), old_values: "{}" }), row({ id: "b2", status: "approved" })] } });
    const items = await bankChangeAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["b1"]);
    expect(items[0].fields.find((f) => f.label === "New account number")?.value).toBe("****6789");
  });

  it("approve / reject PATCH decision + note", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/payroll/bank-change-requests/b1": { success: true } });
    await bankChangeAdapter.decide(ctx, { id: "b1" }, "approve", "Verified with cheque");
    await bankChangeAdapter.decide(ctx, { id: "b1" }, "reject", "");
    expect(calls[0].body).toEqual({ decision: "approved", note: "Verified with cheque" });
    expect(calls[1].body).toEqual({ decision: "rejected", note: undefined });
  });
});
