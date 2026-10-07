import { describe, it, expect } from "vitest";
import type { LoopbackCtx } from "../types.js";

function fakeCtx(routes: Record<string, any>, userId = "u1") {
  const calls: Array<{ method: string; path: string; query?: any; body?: any }> = [];
  const ctx: LoopbackCtx = {
    userId,
    async call(method, path, opts) {
      calls.push({ method, path, query: opts?.query, body: opts?.body });
      const r = routes[`${method} ${path}`];
      if (r instanceof Error) throw r;
      if (r === undefined) throw new Error(`unexpected ${method} ${path}`);
      return typeof r === "function" ? r() : r;
    },
  } as LoopbackCtx;
  return { ctx, calls };
}

import { atsOfferAdapter } from "../adapters/ats-offer.js";

const ready = {
  offer_id: "o1", candidate_id: "c1", candidate_code: "C-1", full_name: "Ravi K", mobile: "9", email: "r@x.in", father_name: "S K",
  offered_ctc: 25000, gross: 24000, net_in_hand: 21000, emp_type: "onroll", date_of_joining: "2026-10-20", salary_band: "B2",
  branch_name: "NOIDA", process_name: "Sales", cost_centre_code: "CC1", cost_centre_name: "Sales CC", client_name: "ACME",
  payroll_validated: 1, payroll_joining_date: "2026-10-21", payroll_salary_start_date: "2026-10-21",
  is_proposed_exception: 1, proposed_exception_reason: "Skill premium", profile_status: "complete",
};

describe("atsOfferAdapter", () => {
  it("maps fields and skips rows without payroll validation", async () => {
    const { ctx } = fakeCtx({
      "GET /api/ats/onboarding/pending-approval": { ok: true, data: [ready, { ...ready, offer_id: "o2", payroll_validated: 0 }] },
    });
    const items = await atsOfferAdapter.list(ctx);
    expect(items).toHaveLength(1);
    const i = items[0];
    expect(i.uid).toBe("ats_offer:o1");
    expect(i.priority).toBe("high");
    expect(i.viewPath).toBe("/ats/offer-approvals?candidate=c1&approvalId=o1");
    const labels = i.fields.map((x) => x.label);
    for (const l of ["Offered CTC", "Gross", "Net in hand", "Joining date (Payroll HR)", "Salary start (Payroll HR)", "Payroll HR validation", "Cost centre", "Exception reason"]) {
      expect(labels).toContain(l);
    }
    expect(i.rejectNeedsReason).toBe(true);
  });
  it("accepts a bare array payload", async () => {
    const { ctx } = fakeCtx({ "GET /api/ats/onboarding/pending-approval": [ready] });
    expect(await atsOfferAdapter.list(ctx)).toHaveLength(1);
  });
  it("approve / reject hit offer endpoints with remarks", async () => {
    const { ctx, calls } = fakeCtx({
      "POST /api/ats/onboarding/offers/o1/approve": { ok: true },
      "POST /api/ats/onboarding/offers/o1/reject": { ok: true },
    });
    await atsOfferAdapter.decide(ctx, { id: "o1" }, "approve", "");
    await atsOfferAdapter.decide(ctx, { id: "o1" }, "reject", "salary too high");
    expect(calls[0].body).toEqual({ remarks: "" });
    expect(calls[1].body).toEqual({ remarks: "salary too high" });
  });
});
