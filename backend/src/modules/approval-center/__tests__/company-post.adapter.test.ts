import { describe, it, expect } from "vitest";
import { companyPostAdapter } from "../adapters/company-post.js";
import { fakeCtx } from "./_fakeCtx.js";

const post = (o: any = {}) => ({
  id: "p1", author_name: "Ravi", author_code: "E1", content_text: "Hello team", status: "pending_approval", moderation_state: "clean",
  moderation_score: 0.2, auto_reject_reason: null, post_type: "user", active_status: true, submitted_at: "2026-10-01T05:00:00Z",
  created_at: "2026-10-01T05:00:00Z", media: [{ file_id: "f1" }, { file_id: "f2" }], ...o,
});

describe("companyPostAdapter", () => {
  it("maps content, author and media count", async () => {
    const { ctx, calls } = fakeCtx({ "GET /api/engagement/company-posts/approvals": { success: true, posts: [post()], total: 1 } });
    const [it] = await companyPostAdapter.list(ctx);
    expect(calls[0].query).toMatchObject({ limit: 100 });
    expect(it.title).toContain("Ravi");
    const byLabel = Object.fromEntries(it.fields.map((x) => [x.label, x.value]));
    expect(byLabel["Post content"]).toBe("Hello team");
    expect(byLabel["Images attached"]).toBe("2");
    expect(it.viewPath).toBe("/engagement/company-feed/approvals?approvalId=p1");
    expect(it.rejectNeedsReason).toBe(false);
  });
  it("flags borderline as high and ignores non-queued", async () => {
    const { ctx } = fakeCtx({ "GET /api/engagement/company-posts/approvals": { posts: [post({ id: "b", status: "borderline_flagged" }), post({ id: "x", status: "approved" })] } });
    const items = await companyPostAdapter.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["b"]);
    expect(items[0].priority).toBe("high");
  });
  it("decide approve/reject endpoints and bodies", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/engagement/company-posts/p1/approve": {}, "POST /api/engagement/company-posts/p1/reject": {} });
    await companyPostAdapter.decide(ctx, { id: "p1" }, "approve", "ok");
    await companyPostAdapter.decide(ctx, { id: "p1" }, "reject", "spam");
    expect(calls[0].body).toEqual({ review_notes: "ok" });
    expect(calls[1].body).toEqual({ reason: "spam", review_notes: "spam" });
  });
});
