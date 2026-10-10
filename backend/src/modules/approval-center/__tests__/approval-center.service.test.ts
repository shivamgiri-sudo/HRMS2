import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ApprovalAdapter, ApprovalItem, LoopbackCtx } from "../types.js";

const state = vi.hoisted(() => ({ adapters: [] as any[] }));
vi.mock("../adapters/index.js", () => ({ get ADAPTERS() { return state.adapters; } }));

import { listPendingApprovals, decideApproval, invalidateApprovalCache, maxAgeDays } from "../approval-center.service.js";

const day = 86_400_000;
const item = (id: string, ageDays: number | null): ApprovalItem => ({
  uid: `t:${id}`, kind: "t", kindLabel: "T", category: "People", id, title: id, fields: [], viewPath: "/x", rejectNeedsReason: false,
  submittedAt: ageDays === null ? null : new Date(Date.now() - ageDays * day).toISOString(),
});
const decide = vi.fn(async () => undefined);
const ctxFor = (userId: string): LoopbackCtx => ({ userId, call: async () => ({}) as never });
const setup = (items: ApprovalItem[]) => {
  const adapter: ApprovalAdapter = { kind: "t", label: "T", category: "People", list: async () => items, decide };
  state.adapters = [adapter];
};

describe("approval center freshness window", () => {
  const saved = process.env.APPROVAL_CENTER_MAX_AGE_DAYS;
  beforeEach(() => { delete process.env.APPROVAL_CENTER_MAX_AGE_DAYS; decide.mockClear(); });
  afterEach(() => { if (saved === undefined) delete process.env.APPROVAL_CENTER_MAX_AGE_DAYS; else process.env.APPROVAL_CENTER_MAX_AGE_DAYS = saved; });

  it("defaults to 60 days: older items are hidden and counted, undated items stay", async () => {
    expect(maxAgeDays()).toBe(60);
    setup([item("fresh", 3), item("edge", 59), item("old", 61), item("ancient", 400), item("undated", null)]);
    const r = await listPendingApprovals(ctxFor("u-default"), { fresh: true });
    expect(r.items.map((i) => i.id).sort()).toEqual(["edge", "fresh", "undated"]);
    expect(r.staleHidden).toBe(2);
    expect(r.counts).toEqual({ t: 3 });
  });

  it("APPROVAL_CENTER_MAX_AGE_DAYS overrides the window; 0 disables it", async () => {
    setup([item("a", 10), item("b", 45)]);
    process.env.APPROVAL_CENTER_MAX_AGE_DAYS = "30";
    let r = await listPendingApprovals(ctxFor("u-30"), { fresh: true });
    expect(r.items.map((i) => i.id)).toEqual(["a"]);
    expect(r.staleHidden).toBe(1);
    process.env.APPROVAL_CENTER_MAX_AGE_DAYS = "0";
    r = await listPendingApprovals(ctxFor("u-0"), { fresh: true });
    expect(r.items).toHaveLength(2);
    expect(r.staleHidden).toBe(0);
  });

  it("decideApproval can still decide an item older than the window (window is list-only)", async () => {
    setup([item("old", 200)]);
    const out = await decideApproval(ctxFor("u-decide"), "t:old", "approve", "ok");
    expect(out).toEqual({ ok: true });
    expect(decide).toHaveBeenCalledOnce();
    invalidateApprovalCache("u-decide");
  });
});
