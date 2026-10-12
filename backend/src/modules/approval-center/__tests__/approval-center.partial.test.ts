import { beforeEach, describe, expect, it, vi } from "vitest";

const slow = { resolve: (() => undefined) as (v: unknown[]) => void };
const adapters = vi.hoisted(() => ({
  list: [] as unknown[],
}));
vi.mock("../adapters/index.js", () => ({ get ADAPTERS() { return adapters.list; } }));

import { invalidateApprovalCache, listPendingApprovals } from "../approval-center.service.js";

const item = (kind: string, id: string) => ({
  uid: `${kind}:${id}`, kind, kindLabel: kind, category: "People", id, title: id, fields: [], viewPath: "/x",
  rejectNeedsReason: false, submittedAt: new Date().toISOString(),
});
const ctx = (userId: string) => ({ userId, call: vi.fn() }) as never;

describe("Approval Center soft deadline", () => {
  beforeEach(() => {
    process.env.APPROVAL_CENTER_SOFT_DEADLINE_MS = "60";
    invalidateApprovalCache("u1");
  });

  it("returns finished queues as partial, then the full list once the slow queue lands", async () => {
    adapters.list = [
      { kind: "fast", label: "Fast", category: "People", list: async () => [item("fast", "1")], decide: vi.fn() },
      { kind: "slow", label: "Slow", category: "People", list: () => new Promise<unknown[]>((r) => { slow.resolve = r; }), decide: vi.fn() },
    ];
    const first = await listPendingApprovals(ctx("u1"), { fresh: true });
    expect(first.partial).toBe(true);
    expect(first.pendingKinds).toEqual(["slow"]);
    expect(first.items.map((i) => i.uid)).toEqual(["fast:1"]);

    slow.resolve([item("slow", "9")]);
    await new Promise((r) => setTimeout(r, 20));
    const second = await listPendingApprovals(ctx("u1"));
    expect(second.partial).toBeUndefined();
    expect(second.items.map((i) => i.uid).sort()).toEqual(["fast:1", "slow:9"]);
    expect(second.timings).toHaveProperty("slow");
  });

  it("concurrent requests share one build (adapter listed once)", async () => {
    const listFn = vi.fn(async () => [item("a", "1")]);
    adapters.list = [{ kind: "a", label: "A", category: "People", list: listFn, decide: vi.fn() }];
    invalidateApprovalCache("u2");
    await Promise.all([listPendingApprovals(ctx("u2"), { fresh: true }), listPendingApprovals(ctx("u2"), { fresh: true })]);
    expect(listFn).toHaveBeenCalledTimes(1);
  });
});
