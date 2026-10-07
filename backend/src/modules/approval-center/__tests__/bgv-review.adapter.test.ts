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

import { bgvReviewAdapter } from "../adapters/bgv-review.js";

const task = (id: string, extra: any = {}) => ({ id: `bgv:${id}`, source: "derived", entity_type: "candidate_bgv_check", entity_id: id, aging_hours: 100, created_at: "2026-10-01", ...extra });
const detail = (id: string, extra: any = {}) => ({
  id, candidate_id: "c-" + id, check_type: "pan", status: "manual_review", match_score: 62, result_summary: "Name differs",
  candidate_name: "Ravi K", candidate_code: "C-1", mobile: "9", email: "r@x.in", created_at: "2026-10-01T10:00:00Z", ...extra,
});

describe("bgvReviewAdapter", () => {
  it("keeps only derived BGV tasks the caller can open (scope guard) and maps fields", async () => {
    const { ctx, calls } = fakeCtx({
      "GET /api/inbox/my-pending": { success: true, items: [task("b1"), task("b2"), { id: "x", source: "tat", entity_type: "candidate_bgv_check", entity_id: "b3" }, { source: "derived", entity_type: "leave_request", entity_id: "l1" }] },
      "GET /api/inbox/derived/candidate_bgv_check/b1": { success: true, data: detail("b1") },
      "GET /api/inbox/derived/candidate_bgv_check/b2": new Error("403 outside branch"),
    });
    const items = await bgvReviewAdapter.list(ctx);
    expect(calls.filter((c) => c.path.includes("/derived/")).map((c) => c.path)).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["b1"]);
    const i = items[0];
    expect(i.viewPath).toBe("/ats/bgv?approvalId=c-b1");
    expect(i.priority).toBe("high");
    expect(i.rejectNeedsReason).toBe(true);
    const labels = i.fields.map((x) => x.label);
    for (const l of ["Candidate", "Check", "Status", "Match score", "Result summary"]) expect(labels).toContain(l);
  });
  it("ignores a detail whose status is no longer reviewable", async () => {
    const { ctx } = fakeCtx({
      "GET /api/inbox/my-pending": { items: [task("b1")] },
      "GET /api/inbox/derived/candidate_bgv_check/b1": { data: detail("b1", { status: "verified" }) },
    });
    expect(await bgvReviewAdapter.list(ctx)).toEqual([]);
  });
  it("decide posts decision + remarks to the derived endpoint", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/inbox/derived/candidate_bgv_check/b1/decide": { success: true } });
    await bgvReviewAdapter.decide(ctx, { id: "b1" }, "approve", "");
    await bgvReviewAdapter.decide(ctx, { id: "b1" }, "reject", "fake pan");
    expect(calls[0].body).toEqual({ decision: "approve", remarks: undefined });
    expect(calls[1].body).toEqual({ decision: "reject", remarks: "fake pan" });
  });
});
