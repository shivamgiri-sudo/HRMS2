import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch Budget approval was entirely notification-silent, the same gap as GRN: Work Inbox's
 * derived BUDGET_APPROVAL_PENDING query (work-inbox.service.ts) surfaced a pending budget on
 * the Work Inbox page, but nothing ever wrote a `work_inbox_item` row, so the bell (GET
 * /api/inbox, which reads work_inbox_item only) never showed one — confirmed by grep before
 * this change: zero calls to inboxService.createItem anywhere in branch-budget.service.ts.
 *
 * This exercises the fix: submit() raises a branch_head alert, a branch_head approval closes it
 * and raises a finance_head alert, and a rejection or revision-bounce closes the alert with
 * nothing new raised.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const { resolveRoleHolderUserIds } = vi.hoisted(() => ({ resolveRoleHolderUserIds: vi.fn() }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds }));

const { createItem, resolveItems } = vi.hoisted(() => ({ createItem: vi.fn(), resolveItems: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem, resolveItems } }));

let branchBudgetService: typeof import("../branch-budget.service.js")["branchBudgetService"];
beforeAll(async () => {
  ({ branchBudgetService } = await import("../branch-budget.service.js"));
}, 120_000);

const HEADER = {
  id: "budget-1", budget_number: "BUD/2026-27/001", branch_id: "branch-A",
  period_code: "2026-04", financial_year: "2026-27", status: "draft",
  gross_budget_amount: 500000, revision_no: 0,
  submitted_by: null, branch_head_approved_by: null, finance_head_approved_by: null,
};

/** get() issues header/lines/approvals/corrections queries via the pool; empty rows for the
 *  last three keep it lightweight — this test only cares about the notify side effect. */
function poolExecuteMock(header: Record<string, unknown>) {
  return vi.fn(async (sql: string) => {
    if (/FROM finance_budget_header h/.test(sql) && /LEFT JOIN branch_master/.test(sql)) {
      return [[header], []];
    }
    return [[], []];
  });
}

function makeConnection(header: Record<string, unknown>) {
  const conn = {
    execute: vi.fn(async (sql: string) => {
      if (/FROM finance_budget_header/.test(sql) && /SELECT/i.test(sql)) return [[header], []];
      if (/UPDATE finance_budget_header/.test(sql)) return [{ affectedRows: 1 }, []];
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return conn;
}

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  resolveRoleHolderUserIds.mockReset().mockResolvedValue(["user-bh-1"]);
  createItem.mockReset().mockResolvedValue(undefined);
  resolveItems.mockReset().mockResolvedValue(0);
});

describe("submit() raises a branch_head bell alert", () => {
  it("creates an item for each branch_head-role holder in the budget's branch", async () => {
    const conn = makeConnection({ status: "draft" });
    getConnection.mockResolvedValue(conn);
    execute.mockImplementation(poolExecuteMock({ ...HEADER, status: "submitted" }));

    await branchBudgetService.submit("budget-1", "user-1", "branch_admin");

    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("branch_head", "branch-A");
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-bh-1",
      type: "budget_approval_pending",
      entity_type: "finance_budget_header",
      entity_id: "budget-1",
      action_url: "/process-pnl/budgets",
    }));
  });
});

describe("review()'s bell alerts follow the stage", () => {
  it("branch_head approval closes its own alert and raises one for finance_head", async () => {
    const conn = makeConnection({
      status: "submitted", revision_no: 0,
      submitted_by: "user-1", branch_head_approved_by: null, finance_head_approved_by: null,
    });
    getConnection.mockResolvedValue(conn);
    execute.mockImplementation(poolExecuteMock({ ...HEADER, status: "branch_head_approved" }));

    await branchBudgetService.review("budget-1", "approve", "user-bh", "branch_head");

    expect(resolveItems).toHaveBeenCalledWith({
      entity_type: "finance_budget_header", entity_id: "budget-1", types: ["budget_approval_pending"],
    });
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("finance_head", "branch-A");
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      type: "budget_approval_pending",
      entity_id: "budget-1",
    }));
  });

  it("rejection closes the alert and raises nothing new", async () => {
    const conn = makeConnection({
      status: "submitted", revision_no: 0,
      submitted_by: "user-1", branch_head_approved_by: null, finance_head_approved_by: null,
    });
    getConnection.mockResolvedValue(conn);
    execute.mockImplementation(poolExecuteMock({ ...HEADER, status: "rejected" }));

    await branchBudgetService.review("budget-1", "reject", "user-bh", "branch_head", "over budget");

    expect(resolveItems).toHaveBeenCalledWith({
      entity_type: "finance_budget_header", entity_id: "budget-1", types: ["budget_approval_pending"],
    });
    expect(createItem).not.toHaveBeenCalled();
  });

  it("finance_head's own decision closes the alert and raises nothing new (chain ends at 'active')", async () => {
    const conn = makeConnection({
      status: "branch_head_approved", revision_no: 0,
      submitted_by: "user-1", branch_head_approved_by: "user-bh", finance_head_approved_by: null,
    });
    getConnection.mockResolvedValue(conn);
    execute.mockImplementation(poolExecuteMock({ ...HEADER, status: "active" }));

    await branchBudgetService.review("budget-1", "approve", "user-fh", "finance_head");

    expect(resolveItems).toHaveBeenCalledWith({
      entity_type: "finance_budget_header", entity_id: "budget-1", types: ["budget_approval_pending"],
    });
    expect(createItem).not.toHaveBeenCalled();
  });
});
