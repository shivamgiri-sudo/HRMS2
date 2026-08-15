/**
 * listPendingForReviewer() is the only source for the budget approval inbox
 * (GET /api/finance/pnl/budgets/pending-my-review -> BudgetApprovalInbox.tsx).
 *
 * It SELECTed h.gross_budget, h.pnl_budget and h.revision_number. None of those
 * columns has ever existed: finance_budget_header carries gross_budget_amount,
 * pnl_budget_amount and revision_no (verified live 2026-08-15 against mas_hrms
 * 8.0.42). Every call therefore raised ER_BAD_FIELD_ERROR, so the approval inbox
 * 500'd for branch_head, finance_head and accounts_head alike - the whole
 * maker-checker queue was unreachable, not merely empty.
 *
 * The repo-wide guard schema-column-refs.test.ts catches the phantom columns
 * themselves. This test pins the other half, which that guard cannot see: the
 * response must keep the field NAMES the already-shipped UI reads, so the columns
 * have to be aliased rather than simply renamed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../../../db/mysql.js", () => ({ db: mockDb }));
vi.mock("../../finance/finance-access-scope.js", () => ({
  resolveFinanceBranchScope: vi.fn(async () => undefined),
  financeBranchFilter: vi.fn(() => ({ sql: "", params: [] })),
}));

const { branchBudgetService } = await import("../branch-budget.service.js");

let lastSql = "";
beforeEach(() => {
  vi.clearAllMocks();
  lastSql = "";
  mockDb.execute.mockImplementation(async (sql: string) => {
    lastSql = String(sql);
    return [[], []];
  });
});

describe("budget approval inbox selects columns that actually exist", () => {
  it("never references the three phantom columns", async () => {
    await branchBudgetService.listPendingForReviewer("finance_head", "user-1", ["finance_head"]);

    expect(lastSql).not.toMatch(/h\.gross_budget\s*,/);
    expect(lastSql).not.toMatch(/h\.pnl_budget\s*,/);
    expect(lastSql).not.toMatch(/h\.revision_number\b/);
  });

  it("selects the real finance_budget_header column names", async () => {
    await branchBudgetService.listPendingForReviewer("finance_head", "user-1", ["finance_head"]);

    expect(lastSql).toContain("h.gross_budget_amount");
    expect(lastSql).toContain("h.pnl_budget_amount");
    expect(lastSql).toContain("h.revision_no");
  });

  it("aliases them back to the field names BudgetApprovalInbox.tsx reads", async () => {
    await branchBudgetService.listPendingForReviewer("branch_head", "user-1", ["branch_head"]);

    expect(lastSql).toMatch(/gross_budget_amount\s+AS\s+gross_budget/i);
    expect(lastSql).toMatch(/pnl_budget_amount\s+AS\s+pnl_budget/i);
    expect(lastSql).toMatch(/revision_no\s+AS\s+revision_number/i);
  });

  it("still maps each reviewer role to the status it is meant to action", async () => {
    // Unchanged behaviour, pinned so the column fix cannot quietly alter the queue.
    await branchBudgetService.listPendingForReviewer("branch_head", "u", ["branch_head"]);
    expect(mockDb.execute.mock.calls[0][1]).toContain("submitted");

    vi.clearAllMocks();
    mockDb.execute.mockImplementation(async () => [[], []]);
    await branchBudgetService.listPendingForReviewer("finance_head", "u", ["finance_head"]);
    expect(mockDb.execute.mock.calls[0][1]).toContain("branch_head_approved");

    vi.clearAllMocks();
    mockDb.execute.mockImplementation(async () => [[], []]);
    await branchBudgetService.listPendingForReviewer("accounts_head", "u", ["accounts_head"]);
    expect(mockDb.execute.mock.calls[0][1]).toContain("finance_head_approved");
  });

  it("returns an empty queue for a role that reviews nothing, without querying", async () => {
    const result = await branchBudgetService.listPendingForReviewer("employee", "u", ["employee"]);
    expect(result).toEqual([]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});
