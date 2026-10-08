import { describe, it, expect } from "vitest";
import { makeCtx } from "./fakeCtx.js";
import { statutoryChangeAdapter } from "../adapters/statutory-change.js";

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1", employee_id: "e1", status: "pending", requested_at: "2026-10-01T05:00:00Z", employee_name: "Asha Rao", employee_code: "MAS100", branch_name: "Pune",
  new_values: { pan_number: "ABCDE1234F", aadhaar_id: "123412341234", uan_number: "100200300400", pf_eligible: true },
  old_values: { employees: { pan_number: "ZZZZZ9999Z" }, employee_statutory_info: { aadhaar_id: "999988887777" } }, ...over,
});

describe("statutoryChangeAdapter", () => {
  it("maps the changed fields and never exposes a full PAN / Aadhaar / UAN", async () => {
    const { ctx } = makeCtx({ "GET /api/statutory-change-requests/pending": { data: [row()] } });
    const [it] = await statutoryChangeAdapter.list(ctx);
    const text = JSON.stringify(it);
    for (const full of ["ABCDE1234F", "123412341234", "100200300400", "ZZZZZ9999Z", "999988887777"]) expect(text).not.toContain(full);
    const byLabel = Object.fromEntries(it.fields.map((f) => [f.label, f.value]));
    expect(byLabel["PAN"]).toBe("ZZZZZ9999Z".replace(/.(?=.{4})/g, "*") + " -> ******234F");
    expect(byLabel["Aadhaar"]).toBe("********7777 -> ********1234");
    expect(byLabel["UAN"]).toBe("(none) -> ********0400");
    expect(byLabel["PF eligible"]).toBe("(none) -> Yes");
    expect(it.fields.map((f) => f.label)).toEqual(expect.arrayContaining(["Employee", "Employee code", "Branch", "Requested on"]));
    expect(it.viewPath).toBe("/statutory-change-approvals?approvalId=s1");
    expect(it.rejectNeedsReason).toBe(true);
  });

  it("tolerates JSON-string values and missing old values", async () => {
    const { ctx } = makeCtx({ "GET /api/statutory-change-requests/pending": { data: [row({ new_values: JSON.stringify({ uan_number: "100200300400" }), old_values: "{}" })] } });
    const [it] = await statutoryChangeAdapter.list(ctx);
    expect(it.fields.find((f) => f.label === "UAN")?.value).toBe("(none) -> ********0400");
  });

  it("drops non-pending rows", async () => {
    const { ctx } = makeCtx({ "GET /api/statutory-change-requests/pending": { data: [row({ status: "approved" })] } });
    expect(await statutoryChangeAdapter.list(ctx)).toEqual([]);
  });

  it("approve / reject send decision + note", async () => {
    const { ctx, calls } = makeCtx({ "PATCH /api/statutory-change-requests/s1": { success: true } });
    await statutoryChangeAdapter.decide(ctx, { id: "s1" }, "approve", "");
    await statutoryChangeAdapter.decide(ctx, { id: "s1" }, "reject", "Mismatch with proof");
    expect(calls[0].body).toEqual({ decision: "approved", note: undefined });
    expect(calls[1].body).toEqual({ decision: "rejected", note: "Mismatch with proof" });
  });
});
