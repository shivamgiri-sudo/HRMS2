import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vendor payments, the budget list and the top-up list all honour a multi-branch scope.
 *
 * The export matters most. scopeAccess.ts's own doctrine is that silent truncation is worse
 * than refusal, and a CSV that quietly contains only some of what the caller asked for is
 * indistinguishable from a complete one. exportPayments delegates straight to listPayments,
 * so the scope applied there covers the export by construction — asserted below rather than
 * assumed, because a future refactor could easily give the export its own query.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let vendorPaymentService: typeof import("../vendor-payment.service.js")["vendorPaymentService"];
beforeAll(async () => {
  ({ vendorPaymentService } = await import("../vendor-payment.service.js"));
}, 120_000);

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

function callWith(fragment: string) {
  const hit = execute.mock.calls.find(([sql]) => String(sql).includes(fragment));
  if (!hit) {
    throw new Error(
      `no query containing ${fragment}\n` +
        execute.mock.calls.map(([s]) => String(s).slice(0, 100)).join("\n"),
    );
  }
  return { sql: String(hit[0]), params: (hit[1] ?? []) as unknown[] };
}

describe("listPayments — branch scope", () => {
  it("emits one placeholder per granted branch", async () => {
    await vendorPaymentService.listPayments({
      branchScope: { mode: "branches", branchIds: ["noida", "ahmedabad"] },
    });
    const { sql, params } = callWith("vendor_payment_tracking");
    expect(sql).toContain("vpt.branch_id IN (?, ?)");
    expect(params).toEqual(expect.arrayContaining(["noida", "ahmedabad"]));
  });

  it("emits no branch predicate for a global caller", async () => {
    await vendorPaymentService.listPayments({ branchScope: { mode: "all" } });
    expect(callWith("vendor_payment_tracking").sql).not.toContain("vpt.branch_id IN (");
  });

  it("still honours a single branchId from an unmigrated caller", async () => {
    await vendorPaymentService.listPayments({ branchId: "branch-own" });
    const { sql, params } = callWith("vendor_payment_tracking");
    expect(sql).toContain("vpt.branch_id = ?");
    expect(params).toContain("branch-own");
  });

  it("lets branchScope win over branchId", async () => {
    await vendorPaymentService.listPayments({
      branchId: "ignored",
      branchScope: { mode: "branches", branchIds: ["noida"] },
    });
    const { sql, params } = callWith("vendor_payment_tracking");
    expect(sql).toContain("vpt.branch_id IN (?)");
    expect(params).not.toContain("ignored");
  });
});

describe("exportPayments — must not return a row the list would not", () => {
  it("carries the same branch scope into the export", async () => {
    await vendorPaymentService.exportPayments({
      branchScope: { mode: "branches", branchIds: ["noida", "ahmedabad"] },
    });
    const { sql, params } = callWith("vendor_payment_tracking");
    expect(sql).toContain("vpt.branch_id IN (?, ?)");
    expect(params).toEqual(expect.arrayContaining(["noida", "ahmedabad"]));
  });

  it("is scoped for a single-branch caller too", async () => {
    await vendorPaymentService.exportPayments({ branchId: "branch-own" });
    const { sql, params } = callWith("vendor_payment_tracking");
    expect(sql).toContain("vpt.branch_id = ?");
    expect(params).toContain("branch-own");
  });
});
