import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a head or sub-head from the Expense Master.
 *
 * The rule under test: budget lines and GRNs name a head/sub-head in plain text and coverage
 * reviews point at it by id, so anything already referenced is RETIRED (active_status = 0) rather
 * than removed. Only an entry nothing references is actually dropped. Getting this backwards
 * either orphans approved budget rows or leaves the user with a delete button that never deletes.
 */

const { executeMock, connectionExecuteMock, getConnectionMock, tableExistsMock, auditMock } =
  vi.hoisted(() => ({
    executeMock: vi.fn(),
    connectionExecuteMock: vi.fn(),
    getConnectionMock: vi.fn(),
    tableExistsMock: vi.fn(),
    auditMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: executeMock, getConnection: getConnectionMock },
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: auditMock }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: tableExistsMock }));

const { financeExpenseMasterService } = await import("../finance-expense-master.service.js");

const ACTOR = "00000000-0000-0000-0000-0000000000aa";
const HEAD_ID = "00000000-0000-0000-0000-000000000001";
const SUB_ID = "00000000-0000-0000-0000-000000000002";

const HEAD_ROW = { id: HEAD_ID, head_name: "Utilities", head_code: "UTILITIES" };
const SUB_ROW = {
  id: SUB_ID,
  sub_head_name: "Electricity",
  active_status: 1,
  head_name: "Utilities",
  head_code: "UTILITIES",
};

interface Usage {
  budgetLines?: number;
  grns?: number;
  coverageReviews?: number;
}

/** Answers every read the service makes; records every write so the test can assert on it. */
function wireDb(usage: Usage, subHeadsOfHead: { id: string; sub_head_name: string }[] = []) {
  const writes: { sql: string; params: unknown[] }[] = [];
  tableExistsMock.mockResolvedValue(true);
  const countFor = (sql: string) => {
    if (sql.includes("finance_budget_line")) return usage.budgetLines ?? 0;
    if (sql.includes("grn_request")) return usage.grns ?? 0;
    return usage.coverageReviews ?? 0;
  };
  executeMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("COUNT(*) AS n")) return [[{ n: countFor(sql) }]];
    if (sql.includes("FROM finance_expense_sub_head_master sh")) return [[SUB_ROW]];
    if (sql.includes("FROM finance_expense_head_master")) return [[HEAD_ROW]];
    if (sql.includes("FROM finance_expense_sub_head_master WHERE head_id")) {
      return [subHeadsOfHead];
    }
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  });
  connectionExecuteMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  });
  getConnectionMock.mockResolvedValue({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: connectionExecuteMock,
  });
  return writes;
}

const sqlOf = (writes: { sql: string }[]) => writes.map((w) => w.sql.replace(/\s+/g, " ")).join(" | ");

describe("Expense Master delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a sub-head nothing references", async () => {
    const writes = wireDb({});
    const result = await financeExpenseMasterService.deleteSubHead(SUB_ID, ACTOR);

    expect(result).toMatchObject({ id: SUB_ID, name: "Electricity", removed: true });
    expect(sqlOf(writes)).toContain("DELETE FROM finance_expense_sub_head_master WHERE id = ?");
    expect(sqlOf(writes)).not.toContain("UPDATE");
  });

  it("retires — never removes — a sub-head that budget lines still name", async () => {
    const writes = wireDb({ budgetLines: 4 });
    const result = await financeExpenseMasterService.deleteSubHead(SUB_ID, ACTOR);

    expect(result.removed).toBe(false);
    expect(result.usage.budgetLines).toBe(4);
    expect(sqlOf(writes)).not.toContain("DELETE FROM finance_expense_sub_head_master");
    expect(sqlOf(writes)).toContain("active_status = 0");
  });

  it("retires a sub-head that only a coverage review references", async () => {
    const writes = wireDb({ coverageReviews: 1 });
    const result = await financeExpenseMasterService.deleteSubHead(SUB_ID, ACTOR);

    expect(result.removed).toBe(false);
    expect(sqlOf(writes)).not.toContain("DELETE FROM");
  });

  it("removes an unused head together with its unused sub-heads", async () => {
    const writes = wireDb({}, [{ id: SUB_ID, sub_head_name: "Electricity" }]);
    const result = await financeExpenseMasterService.deleteHead(HEAD_ID, ACTOR);

    expect(result.removed).toBe(true);
    const sql = sqlOf(writes);
    // The child rows must go first — finance_expense_sub_head_master has a foreign key to the head.
    expect(sql.indexOf("DELETE FROM finance_expense_sub_head_master WHERE head_id = ?"))
      .toBeLessThan(sql.indexOf("DELETE FROM finance_expense_head_master WHERE id = ?"));
  });

  it("retires a head when one of its sub-heads is still in use, leaving the sub-head rows alone", async () => {
    const writes = wireDb({ budgetLines: 2 }, [{ id: SUB_ID, sub_head_name: "Electricity" }]);
    const result = await financeExpenseMasterService.deleteHead(HEAD_ID, ACTOR);

    expect(result.removed).toBe(false);
    const sql = sqlOf(writes);
    expect(sql).not.toContain("DELETE FROM");
    expect(sql).toContain("UPDATE finance_expense_head_master");
    expect(sql).not.toContain("UPDATE finance_expense_sub_head_master");
  });

  it("writes an audit entry for both outcomes", async () => {
    wireDb({});
    await financeExpenseMasterService.deleteSubHead(SUB_ID, ACTOR);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "expense_sub_head_deleted", actor_user_id: ACTOR })
    );

    vi.clearAllMocks();
    wireDb({ grns: 1 });
    await financeExpenseMasterService.deleteSubHead(SUB_ID, ACTOR);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "expense_sub_head_retired" })
    );
  });

  it("rejects a missing id before touching the database", async () => {
    wireDb({});
    await expect(financeExpenseMasterService.deleteSubHead("", ACTOR)).rejects.toThrow(
      "Sub-head id is required"
    );
    await expect(financeExpenseMasterService.deleteHead("", ACTOR)).rejects.toThrow(
      "Head id is required"
    );
  });
});

describe("Expense Master edit/delete authorization", () => {
  const repoRoot = resolve(__dirname, "../../../../..");
  const routes = readFileSync(resolve(repoRoot, "backend/src/modules/finance/grn.routes.ts"), "utf8");
  const capabilities = readFileSync(
    resolve(repoRoot, "backend/src/modules/process-pnl/budget-coverage.routes.ts"),
    "utf8"
  );
  const page = readFileSync(
    resolve(repoRoot, "src/pages/finance/BranchBudgetManagementWorkspace.tsx"),
    "utf8"
  );

  it("gates delete on Super Admin at the API, not only in the UI", () => {
    expect(routes).toContain('const EXPENSE_MASTER_EDIT_ROLES: RoleKey[] = ["super_admin"]');
    expect(routes).toContain('"/expense-heads/:id"');
    expect(routes).toContain('"/expense-sub-heads/:id"');
    expect(routes).toContain("requireRole(...EXPENSE_MASTER_EDIT_ROLES)");
  });

  it("gates editing an existing head/sub-head on Super Admin", () => {
    expect(routes).toContain("assertSuperAdminForEdit(req)");
    expect(routes).toContain("Only a Super Admin can edit an existing expense head or sub-head");
  });

  it("exposes the Super-Admin-only capability the master panel gates on", () => {
    expect(capabilities).toContain("canEditExpenseMaster: isSuperAdmin");
    expect(page).toContain("canEdit={Boolean(capabilities?.canEditExpenseMaster)}");
  });

  it("keeps delete, edit and add-sub-head-under-a-head available in the master panel", () => {
    expect(page).toContain("onDeleteHead");
    expect(page).toContain("onDeleteSubHead");
    expect(page).toContain("deleteHead.mutateAsync");
    expect(page).toContain("deleteSubHead.mutateAsync");
    expect(page).toContain("Add sub-head");
    expect(page).toContain("Save sub-head");
    expect(page).toContain("Save head");
  });
});
