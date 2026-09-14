import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GRN approval was entirely notification-silent: Work Inbox's derived GRN_APPROVAL_PENDING
 * query (work-inbox.service.ts) surfaced a pending GRN on the Work Inbox page, but nothing
 * ever wrote a `work_inbox_item` row, so the bell (GET /api/inbox, which reads work_inbox_item
 * only) never showed one at all — confirmed by grep before this change: zero calls to
 * inboxService.createItem anywhere in grn.service.ts.
 *
 * This exercises the fix: submitForApproval raises a branch_head alert, a branch_head approval
 * closes it and raises a finance_head alert, and a rejection at either stage closes the alert
 * with nothing new raised.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

vi.mock("../../process-pnl/budget-consumption.service.js", () => ({
  budgetConsumptionService: {
    reserve: vi.fn(), consume: vi.fn(), release: vi.fn(), reverseConsumption: vi.fn(),
  },
}));

const { resolveRoleHolderUserIds } = vi.hoisted(() => ({ resolveRoleHolderUserIds: vi.fn() }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds }));

const { createItem, resolveItems } = vi.hoisted(() => ({ createItem: vi.fn(), resolveItems: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem, resolveItems } }));

let grnService: typeof import("../grn.service.js")["grnService"];
beforeAll(async () => {
  ({ grnService } = await import("../grn.service.js"));
}, 120_000);

function makeConnection(grn: Record<string, unknown>) {
  const conn = {
    execute: vi.fn(async (sql: string) => {
      if (/SELECT \* FROM grn_request/.test(sql)) return [[grn], []];
      if (/^\s*UPDATE grn_request/.test(sql)) return [{ affectedRows: 1 }, []];
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return conn;
}

const DRAFT_GRN = {
  id: "grn-1", grn_number: "GRN/2026/0007", branch_id: "branch-A", status: "draft",
  grn_type: "vendor", budget_line_id: "line-1", attachment_path: "uploads/x.pdf",
  vendor_name: "Acme", amount_with_tax: 11800, amount: 10000, quantity: 1,
};

const SUBMITTED_GRN = {
  id: "g1", grn_number: "GRN/2026/0010", branch_id: "branch-A", status: "submitted",
  budget_line_id: "bl1", vendor_name: "Acme", amount_with_tax: 5000, amount: 5000,
  quantity: 1, grn_type: "expense",
};

const BH_APPROVED_GRN = { ...SUBMITTED_GRN, status: "branch_head_approved" };

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  resolveRoleHolderUserIds.mockReset().mockResolvedValue(["user-bh-1", "user-bh-2"]);
  createItem.mockReset().mockResolvedValue(undefined);
  resolveItems.mockReset().mockResolvedValue(0);
});

describe("submitForApproval raises a branch_head bell alert", () => {
  it("creates one item per branch_head-role holder in the GRN's branch", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request/i.test(sql) && /SELECT/i.test(sql)) return [[DRAFT_GRN], []];
      if (/UPDATE grn_request/i.test(sql)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    await grnService.submitForApproval("grn-1", { remarks: "please approve" } as any, "user-1", "branch_admin");

    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("branch_head", "branch-A");
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-bh-1",
      type: "grn_approval_pending",
      entity_type: "grn_request",
      entity_id: "grn-1",
      action_url: "/finance/grn",
    }));
  });

  it("does not block submission when the notification helper itself throws", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request/i.test(sql) && /SELECT/i.test(sql)) return [[DRAFT_GRN], []];
      if (/UPDATE grn_request/i.test(sql)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    resolveRoleHolderUserIds.mockRejectedValue(new Error("db exploded"));

    await expect(
      grnService.submitForApproval("grn-1", {} as any, "user-1", "branch_admin")
    ).resolves.toMatchObject({ success: true, newStatus: "submitted" });
  });
});

describe("reviewGrn's bell alerts follow the stage", () => {
  it("branch_head approval closes its own alert and raises one for finance_head", async () => {
    const conn = makeConnection(SUBMITTED_GRN);
    getConnection.mockResolvedValue(conn);

    await grnService.reviewGrn("g1", { decision: "approved" }, "u1", "branch_head");

    expect(resolveItems).toHaveBeenCalledWith({
      entity_type: "grn_request", entity_id: "g1", types: ["grn_approval_pending"],
    });
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("finance_head", "branch-A");
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      type: "grn_approval_pending",
      entity_id: "g1",
    }));
  });

  it("branch_head rejection closes the alert and raises nothing new", async () => {
    const conn = makeConnection(SUBMITTED_GRN);
    getConnection.mockResolvedValue(conn);

    await grnService.reviewGrn("g1", { decision: "rejected", reviewNote: "wrong amount" }, "u1", "branch_head");

    expect(resolveItems).toHaveBeenCalledWith({
      entity_type: "grn_request", entity_id: "g1", types: ["grn_approval_pending"],
    });
    expect(createItem).not.toHaveBeenCalled();
  });

  it("finance_head's own decision closes the alert and raises nothing new (chain ends)", async () => {
    const conn = makeConnection(BH_APPROVED_GRN);
    getConnection.mockResolvedValue(conn);

    await grnService.reviewGrn("g1", { decision: "approved" }, "u2", "finance_head");

    expect(resolveItems).toHaveBeenCalledWith({
      entity_type: "grn_request", entity_id: "g1", types: ["grn_approval_pending"],
    });
    expect(createItem).not.toHaveBeenCalled();
  });
});
