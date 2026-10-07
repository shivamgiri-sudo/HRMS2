import { vi } from "vitest";
const hasAnyRole = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));
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

import { payrollHeadReviewAdapter } from "../adapters/payroll-head-review.js";

const row = {
  review_id: "v1", employee_id: "e1", status: "pending_review", package_accepted: 1, employee_code: "MAS1", full_name: "Ravi K",
  designation_name: "Agent", branch_name: "NOIDA", process_name: "Sales", cost_centre_name: "CC", emp_type: "onroll",
  offered_ctc: 300000, final_ctc: 300000, offer_status: "approved", phr_by: "Pat", phr_at: "2026-10-01", bh_by: "Bela",
  bh_status: "approved", bh_at: "2026-10-02", bh_remarks: "fine", pending_hours: 60, created_at: "2026-10-03T10:00:00Z",
  summary: { bank: { penny_drop: { verified: true } } },
};

describe("payrollHeadReviewAdapter", () => {
  it("returns [] without calling the queue when caller is not payroll_head/super_admin", async () => {
    hasAnyRole.mockResolvedValue(false);
    const { ctx, calls } = fakeCtx({});
    expect(await payrollHeadReviewAdapter.list(ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("lists only package-accepted pending reviews, with the CTC and approval chain", async () => {
    hasAnyRole.mockResolvedValue(true);
    const { ctx, calls } = fakeCtx({
      "GET /api/payroll-head-review/queue": { success: true, data: [row, { ...row, employee_id: "e2", package_accepted: 0 }] },
    });
    const items = await payrollHeadReviewAdapter.list(ctx);
    expect(calls[0].query).toEqual({ status: "pending_review" });
    expect(items.map((i) => i.id)).toEqual(["e1"]);
    const i = items[0];
    expect(i.priority).toBe("high");
    expect(i.viewPath).toBe("/payroll/salary-review/e1?approvalId=e1");
    expect(i.meta).toEqual({ rejectViewOnly: true });
    const labels = i.fields.map((x) => x.label);
    for (const l of ["Offered CTC (offer)", "Final CTC (assigned package)", "Offer raised by (Payroll HR)", "Branch head", "Bank penny-drop verified"]) {
      expect(labels).toContain(l);
    }
  });
  it("approve hits /approve; reject is refused (needs category + reason code)", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/payroll-head-review/e1/approve": { success: true } });
    await payrollHeadReviewAdapter.decide(ctx, { id: "e1" }, "approve", "");
    expect(calls[0].path).toBe("/api/payroll-head-review/e1/approve");
    await expect(payrollHeadReviewAdapter.decide(ctx, { id: "e1" }, "reject", "x")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
