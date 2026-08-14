import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test, 2026-08-14: listPostings/listApplicationsForPosting were gated only by
 * requireRole('branch_head', 'process_manager', 'operations_manager', ...) — role
 * membership, not row scope. CLAUDE.md is explicit: "Sensitive operations must enforce
 * role and row scope at API/query level." A branch_head at Branch A handed (or guessing)
 * any posting UUID could see every applicant's name/email/mobile/employee_code company-
 * wide, and GET /postings returned every posting org-wide regardless of the caller's own
 * branch/process. branchId/processId in the filters object were caller-supplied query
 * params, not derived from the caller's identity, so a manager could simply omit them.
 *
 * These assert the SQL sent to the DB actually carries a scope predicate built from the
 * CALLER's own resolved business scope (buildProcessScopeCondition, the same mechanism
 * job-requisition.service.ts already uses for this exact role set), not merely "some
 * WHERE clause exists."
 */

const dbExecute = vi.fn(async (sql: string) => {
  if (/^SELECT COUNT/.test(sql.trim())) return [[{ total: 0 }], []];
  return [[], []];
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { resolveUserBusinessScope } = vi.hoisted(() => ({ resolveUserBusinessScope: vi.fn() }));
vi.mock("../../../shared/enterpriseScope.js", async (importOriginal) => ({
  // buildProcessScopeCondition stays real — it's the pure logic under test. Only the DB
  // lookup (resolveUserBusinessScope) is mocked, so each case can hand it a scope shape
  // directly instead of seeding user_assignment_scope rows.
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserBusinessScope,
}));

function baseScope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "u-1", roles: [], employeeId: "emp-1", employeeCode: "E1",
    branchId: null, processId: null, lobId: null, departmentId: null,
    isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
    assignments: [],
    ...overrides,
  };
}

beforeEach(() => { dbExecute.mockClear(); resolveUserBusinessScope.mockReset(); });

describe("listPostings — row scope, not just a role gate", () => {
  it("HR gets an unscoped 1=1 condition (org-wide view preserved)", async () => {
    resolveUserBusinessScope.mockResolvedValue(baseScope({ isHr: true }));
    const { listPostings } = await import("../ijp.service.js");

    await listPostings("u-hr", { limit: 50, offset: 0 });

    const [sql] = dbExecute.mock.calls[0];
    expect(sql).toContain("(1=1)");
  });

  it("a branch_head with a real branch assignment is restricted to that branch in the SQL", async () => {
    resolveUserBusinessScope.mockResolvedValue(baseScope({
      roles: ["branch_head"],
      assignments: [{ scopeType: "branch", branchId: "branch-A", processId: null, lobId: null, departmentId: null, managerEmployeeId: null }],
    }));
    const { listPostings } = await import("../ijp.service.js");

    await listPostings("u-bh", { limit: 50, offset: 0 });

    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toContain("p.branch_id = ?");
    expect(params).toContain("branch-A");
  });

  it("a manager-tier role with NO assignment resolves to 1=0 (fail-closed, not fail-open)", async () => {
    resolveUserBusinessScope.mockResolvedValue(baseScope({ roles: ["operations_manager"], assignments: [] }));
    const { listPostings } = await import("../ijp.service.js");

    await listPostings("u-ops", { limit: 50, offset: 0 });

    const [sql] = dbExecute.mock.calls[0];
    expect(sql).toContain("(1=0)");
  });
});

describe("listApplicationsForPosting — same scope predicate applied to the applicant list", () => {
  it("scopes on the posting's own branch/process (p.branch_id / p.process_id), and joins ijp_posting into the count query too", async () => {
    resolveUserBusinessScope.mockResolvedValue(baseScope({
      roles: ["process_manager"],
      assignments: [{ scopeType: "process", processId: "process-B", branchId: null, lobId: null, departmentId: null, managerEmployeeId: null }],
    }));
    const { listApplicationsForPosting } = await import("../ijp.service.js");

    await listApplicationsForPosting("u-pm", "posting-1", { limit: 50, offset: 0 });

    const [countSql, countParams] = dbExecute.mock.calls[0];
    expect(countSql).toContain("JOIN ijp_posting p ON p.id = a.posting_id");
    expect(countSql).toContain("p.process_id = ?");
    expect(countParams).toContain("process-B");
  });
});
