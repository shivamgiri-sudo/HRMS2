import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * budget-closure.service.ts — monthly business-case close/reopen per (budget, head, sub-head).
 *
 * Three things this must be true about:
 *  1. CLOSE IS RESTRICTED TO BRANCH ADMIN + FINANCE HEAD, NOT BRANCH HEAD. The owner's own
 *     wording ("this right should be with Branch admin and finance head") deliberately excludes
 *     branch_head, unlike almost every other budget action in this module.
 *  2. REOPEN NEEDS A CLOSED ROW, AND ONLY ONE PENDING REQUEST AT A TIME. Requesting a reopen on
 *     something that is not closed, or that already has a pending request, must refuse rather
 *     than silently queue a duplicate.
 *  3. A CLOSED HEAD/SUB-HEAD REFUSES NEW SPEND. assertSubheadOpen() is what
 *     budget-consumption.service.ts's reserve() calls before letting a GRN reserve budget.
 */

const { execute, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(), getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const createItem = vi.fn(async () => ({}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));

const { budgetClosureService } = await import("../budget-closure.service.js");

const BUDGET = { id: "budget-1", branch_id: "branch-A", status: "active" };

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  createItem.mockReset().mockResolvedValue({});
  execute.mockImplementation(async (sql: string) => {
    if (/FROM finance_budget_header WHERE id/i.test(String(sql))) return [[BUDGET], []];
    if (/FROM auth_user u/i.test(String(sql))) return [[{ id: "finance-head-user" }], []];
    return [[], []];
  });
});

describe("close() — Branch Admin and Finance Head only, not Branch Head", () => {
  it("lets branch_admin close a head/sub-head directly", async () => {
    await expect(
      budgetClosureService.close("budget-1", "Marketing", "Digital Ads", "month-end close", "user-1", "branch_admin")
    ).resolves.toBeUndefined();
    const insert = execute.mock.calls.find(([sql]) => /INSERT INTO finance_budget_subhead_closure/i.test(String(sql)));
    expect(insert, "the closure row must actually be written").toBeTruthy();
  });

  it("lets finance_head close a head/sub-head directly", async () => {
    await expect(
      budgetClosureService.close("budget-1", "Marketing", null, "month-end close", "user-2", "finance_head")
    ).resolves.toBeUndefined();
  });

  it("refuses branch_head — deliberately excluded per owner wording", async () => {
    await expect(
      budgetClosureService.close("budget-1", "Marketing", null, "x", "user-3", "branch_head")
    ).rejects.toThrow(/cannot close/i);
  });

  it("normalizes a null sub-head to '' so closing twice hits the same row (idempotent)", async () => {
    await budgetClosureService.close("budget-1", "Marketing", null, "first close", "user-1", "branch_admin");
    const insert = execute.mock.calls.find(([sql]) => /INSERT INTO finance_budget_subhead_closure/i.test(String(sql)));
    expect(insert![1]).toContain(""); // sub_head param is '' not null
  });
});

describe("requestReopen() — only against a closed row, only one pending at a time", () => {
  it("refuses to reopen a head/sub-head that is not closed", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM finance_budget_header WHERE id/i.test(String(sql))) return [[BUDGET], []];
      if (/FROM finance_budget_subhead_closure/i.test(String(sql))) return [[{ id: "c-1", status: "open" }], []];
      return [[], []];
    });
    await expect(
      budgetClosureService.requestReopen("budget-1", "Marketing", null, "invoice arrived late", "user-1", "branch_admin")
    ).rejects.toThrow(/not closed/i);
  });

  it("refuses a second pending reopen request for the same closed head/sub-head", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM finance_budget_header WHERE id/i.test(String(sql))) return [[BUDGET], []];
      if (/FROM finance_budget_subhead_closure/i.test(String(sql))) return [[{ id: "c-1", status: "closed" }], []];
      if (/FROM finance_budget_closure_reopen_request WHERE closure_id/i.test(String(sql))) return [[{ id: "existing-pending" }], []];
      return [[], []];
    });
    await expect(
      budgetClosureService.requestReopen("budget-1", "Marketing", null, "invoice arrived late", "user-1", "branch_admin")
    ).rejects.toThrow(/already pending/i);
  });

  it("requires a reason", async () => {
    await expect(
      budgetClosureService.requestReopen("budget-1", "Marketing", null, "", "user-1", "branch_admin")
    ).rejects.toThrow(/reason is required/i);
  });

  it("notifies every finance_head via the work inbox on a valid reopen request", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM finance_budget_header WHERE id/i.test(String(sql))) return [[BUDGET], []];
      if (/FROM finance_budget_subhead_closure/i.test(String(sql))) return [[{ id: "c-1", status: "closed" }], []];
      if (/FROM finance_budget_closure_reopen_request WHERE closure_id/i.test(String(sql))) return [[], []];
      if (/FROM auth_user u/i.test(String(sql))) return [[{ id: "fh-1" }, { id: "fh-2" }], []];
      return [[], []];
    });
    await budgetClosureService.requestReopen("budget-1", "Marketing", null, "invoice arrived late", "user-1", "branch_admin");
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(createItem.mock.calls[0][0]).toMatchObject({
      user_id: "fh-1",
      type: "BUDGET_CLOSURE_REOPEN_PENDING",
      entity_type: "budget_closure_reopen_request",
    });
  });
});

describe("reviewReopen() — Finance Head approval flips the closure back to open", () => {
  function connectionReturning(request: Record<string, unknown>) {
    const connectionExecute = vi.fn(async (sql: string) => {
      if (/FROM finance_budget_closure_reopen_request WHERE id/i.test(String(sql))) return [[request], []];
      return [[], []];
    });
    const connection = {
      execute: connectionExecute,
      beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}), release: vi.fn(() => {}),
    };
    getConnection.mockResolvedValue(connection);
    return connection;
  }

  it("lets finance_head approve a reopen request they raised themselves (exempt, mirrors MAKER_CHECKER_EXEMPT_ROLES)", async () => {
    const connection = connectionReturning({
      id: "r-1", closure_id: "c-1", status: "pending", requested_by: "fh-self",
    });
    await expect(
      budgetClosureService.reviewReopen("r-1", "approve", "fh-self", "finance_head")
    ).resolves.toMatchObject({ status: "approved" });
    const reopened = connection.execute.mock.calls.find(([sql]) =>
      /UPDATE finance_budget_subhead_closure SET status = 'open'/i.test(String(sql)));
    expect(reopened, "approval must flip the closure row back to open").toBeTruthy();
  });

  it("refuses to reject without a reason", async () => {
    connectionReturning({ id: "r-1", closure_id: "c-1", status: "pending", requested_by: "user-1" });
    await expect(
      budgetClosureService.reviewReopen("r-1", "reject", "fh-1", "finance_head")
    ).rejects.toThrow(/reason is required/i);
  });

  it("refuses a role outside finance_head/super_admin", async () => {
    connectionReturning({ id: "r-1", closure_id: "c-1", status: "pending", requested_by: "user-1" });
    await expect(
      budgetClosureService.reviewReopen("r-1", "approve", "user-2", "branch_admin")
    ).rejects.toThrow(/cannot review/i);
  });

  it("refuses a request that is already decided", async () => {
    connectionReturning({ id: "r-1", closure_id: "c-1", status: "approved", requested_by: "user-1" });
    await expect(
      budgetClosureService.reviewReopen("r-1", "approve", "fh-1", "finance_head")
    ).rejects.toThrow(/already approved/i);
  });
});

describe("assertSubheadOpen() — the actual GRN spend gate", () => {
  it("throws BUDGET_SUBHEAD_CLOSED when the head/sub-head is closed", async () => {
    const connExecute = vi.fn(async () => [[{ status: "closed" }], []]);
    await expect(
      budgetClosureService.assertSubheadOpen({ execute: connExecute } as any, "budget-1", "Marketing", null)
    ).rejects.toMatchObject({ code: "BUDGET_SUBHEAD_CLOSED" });
  });

  it("passes silently when the head/sub-head is open", async () => {
    const connExecute = vi.fn(async () => [[{ status: "open" }], []]);
    await expect(
      budgetClosureService.assertSubheadOpen({ execute: connExecute } as any, "budget-1", "Marketing", null)
    ).resolves.toBeUndefined();
  });

  it("passes silently when no closure row exists at all — nothing has to be closed to be spendable", async () => {
    const connExecute = vi.fn(async () => [[], []]);
    await expect(
      budgetClosureService.assertSubheadOpen({ execute: connExecute } as any, "budget-1", "Marketing", null)
    ).resolves.toBeUndefined();
  });
});
