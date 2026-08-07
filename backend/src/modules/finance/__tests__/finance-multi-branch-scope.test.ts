import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finance can see more than one branch.
 *
 * Until now resolveFinanceBranchScope answered with a single `string | undefined`: either every
 * branch, or exactly the one on the caller's employee row. There was no way to say "this user
 * covers NOIDA, NOIDA-2 and AHMEDABAD and nothing else", even though user_assignment_scope has
 * modelled N rows per user since 003_access_control.sql and buildScopeWhereClause already ORs
 * them together for employees, payroll, ATS and roster.
 *
 * These tests pin the three things that make the widening safe rather than merely possible:
 *   - a grant is only honoured when the row both names a branch AND declares a branch-bearing
 *     scope_type, so a process-scoped row cannot leak a branch nobody granted;
 *   - the employee-branch fallback survives, because user_assignment_scope is empty for most
 *     users and dropping it would lock every branch user out of finance on deploy day;
 *   - the single-branch adapter THROWS for a multi-branch caller instead of returning
 *     undefined, because undefined means "no WHERE clause" — i.e. every branch in the company.
 *     Failing closed is the whole point.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

type ScopeRow = {
  id?: string;
  role_key?: string;
  scope_type: string;
  branch_id: string | null;
  process_id?: string | null;
  lob_id?: string | null;
  department_id?: string | null;
  manager_employee_id?: string | null;
};

/**
 * Routes each query to the right fixture by looking at the SQL. Both getUserAssignmentScopes
 * and getUserBranchId go through the same mocked db.execute, so a single blanket
 * mockResolvedValue would feed employee rows to the scope query and vice versa.
 */
function mockDb(options: { scopes?: ScopeRow[]; employeeBranchId?: string | null }) {
  execute.mockImplementation(async (sql: string) => {
    if (/FROM\s+user_assignment_scope/i.test(sql)) {
      return [options.scopes ?? [], []];
    }
    if (/FROM\s+employees/i.test(sql)) {
      return [options.employeeBranchId ? [{ branch_id: options.employeeBranchId }] : [], []];
    }
    return [[], []];
  });
}

const BRANCH_USER = { userId: "u1", primaryRole: "branch_admin", userRoles: ["branch_admin", "employee"] };

beforeEach(() => {
  execute.mockReset();
});

describe("resolveFinanceBranchScopeSet", () => {
  it("returns every branch for a global finance role, without querying grants at all", async () => {
    mockDb({ employeeBranchId: "branch-own" });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    expect(
      await resolveFinanceBranchScopeSet({ userId: "u9", primaryRole: "finance_head", userRoles: ["finance_head"] }),
    ).toEqual({ mode: "all" });
    expect(execute, "a global role must not need a scope lookup").not.toHaveBeenCalled();
  });

  it("returns all three granted branches for a multi-branch user", async () => {
    mockDb({
      scopes: [
        { scope_type: "branch", branch_id: "noida" },
        { scope_type: "branch", branch_id: "noida-2" },
        { scope_type: "branch_process", branch_id: "ahmedabad", process_id: "p1" },
      ],
      employeeBranchId: "noida",
    });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    const scope = await resolveFinanceBranchScopeSet(BRANCH_USER);
    expect(scope.mode).toBe("branches");
    expect(scope.mode === "branches" && [...scope.branchIds].sort()).toEqual([
      "ahmedabad",
      "noida",
      "noida-2",
    ]);
  });

  it("unions grants with the employee branch rather than replacing it", async () => {
    // A grant is an addition. If it replaced, one row pointing at another branch would
    // silently remove someone's access to their own — a regression dressed as a feature.
    mockDb({
      scopes: [{ scope_type: "branch", branch_id: "ahmedabad" }],
      employeeBranchId: "noida",
    });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    const scope = await resolveFinanceBranchScopeSet(BRANCH_USER);
    expect(scope.mode === "branches" && [...scope.branchIds].sort()).toEqual(["ahmedabad", "noida"]);
  });

  it("ignores a process-scoped grant that happens to carry a branch id", async () => {
    // The row grants a PROCESS. Its branch_id is context, not a grant, and widening on it
    // would hand out a whole branch nobody authorised.
    mockDb({
      scopes: [{ scope_type: "process", branch_id: "ahmedabad", process_id: "p1" }],
      employeeBranchId: "noida",
    });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    expect(await resolveFinanceBranchScopeSet(BRANCH_USER)).toEqual({
      mode: "branches",
      branchIds: ["noida"],
    });
  });

  it("falls back to the employee branch when the user has no grants", async () => {
    // user_assignment_scope is empty for most users; 103_user_assignment_scope_seed.sql has
    // never been registered in MIGRATION_MANIFEST. Without this fallback every branch user
    // loses finance access the moment multi-branch ships.
    mockDb({ scopes: [], employeeBranchId: "branch-own" });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    expect(await resolveFinanceBranchScopeSet(BRANCH_USER)).toEqual({
      mode: "branches",
      branchIds: ["branch-own"],
    });
  });

  it("IGNORES scope_type='all' — a grant may enumerate branches, never globalise finance", async () => {
    // 36 live rows carry scope_type='all', 9 of them alongside a branch_id, and
    // user_assignment_scope has no module column: those were granted so somebody could see
    // every employee or every roster. Honouring one here would hand a branch user every
    // branch's spend — the exact escalation finance-branch-bound-scope.test.ts was written
    // to prevent. In finance, "all branches" comes from hasGlobalFinanceScope alone.
    mockDb({ scopes: [{ scope_type: "all", branch_id: null }], employeeBranchId: "noida" });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    expect(await resolveFinanceBranchScopeSet(BRANCH_USER)).toEqual({
      mode: "branches",
      branchIds: ["noida"],
    });
  });

  it("ignores scope_type='all' even when the row also carries a branch id", async () => {
    // The 9 live rows shaped exactly like this. The branch_id on an 'all' row is not a
    // branch grant, so it must not widen finance either.
    mockDb({
      scopes: [{ scope_type: "all", branch_id: "ahmedabad" }],
      employeeBranchId: "noida",
    });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    expect(await resolveFinanceBranchScopeSet(BRANCH_USER)).toEqual({
      mode: "branches",
      branchIds: ["noida"],
    });
  });

  it("narrows to a requested branch that is inside the granted set", async () => {
    mockDb({
      scopes: [
        { scope_type: "branch", branch_id: "noida" },
        { scope_type: "branch", branch_id: "ahmedabad" },
      ],
    });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    expect(
      await resolveFinanceBranchScopeSet({ ...BRANCH_USER, requestedBranchId: "ahmedabad" }),
    ).toEqual({ mode: "branches", branchIds: ["ahmedabad"] });
  });

  it("refuses a requested branch outside the granted set", async () => {
    mockDb({
      scopes: [
        { scope_type: "branch", branch_id: "noida" },
        { scope_type: "branch", branch_id: "ahmedabad" },
      ],
    });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    await expect(
      resolveFinanceBranchScopeSet({ ...BRANCH_USER, requestedBranchId: "delhi" }),
    ).rejects.toThrow(/only access finance records for your assigned branch/i);
  });

  it("never yields an empty branch list — it throws instead", async () => {
    // An empty list would render as `IN ()`, a SQL error, and the obvious guard against that
    // (`if (ids.length) filter()`) turns "entitled to nothing" into "entitled to everything".
    mockDb({ scopes: [], employeeBranchId: null });
    const { resolveFinanceBranchScopeSet } = await import("../finance-access-scope.js");
    await expect(resolveFinanceBranchScopeSet(BRANCH_USER)).rejects.toThrow(
      /not mapped to an active employee branch/i,
    );
  });
});

describe("financeBranchFilter", () => {
  it("emits one placeholder per branch, with matching params", async () => {
    const { financeBranchFilter } = await import("../finance-access-scope.js");
    const filter = financeBranchFilter(
      { mode: "branches", branchIds: ["noida", "noida-2", "ahmedabad"] },
      "g.branch_id",
    );
    expect(filter.sql).toBe("g.branch_id IN (?, ?, ?)");
    expect(filter.params).toEqual(["noida", "noida-2", "ahmedabad"]);
    expect(
      (filter.sql.match(/\?/g) ?? []).length,
      "placeholder count must equal param count or mysql2 throws at bind time",
    ).toBe(filter.params.length);
  });

  it("degrades to a no-op predicate for global scope", async () => {
    const { financeBranchFilter } = await import("../finance-access-scope.js");
    expect(financeBranchFilter({ mode: "all" }, "g.branch_id")).toEqual({ sql: "1=1", params: [] });
  });
});

describe("resolveFinanceBranchScope — the single-branch adapter", () => {
  it("still returns undefined for a global role, exactly as before", async () => {
    mockDb({});
    const { resolveFinanceBranchScope } = await import("../finance-access-scope.js");
    expect(
      await resolveFinanceBranchScope({ userId: "u9", primaryRole: "finance_head", userRoles: ["finance_head"] }),
    ).toBeUndefined();
  });

  it("still returns the one branch for a single-branch user, exactly as before", async () => {
    mockDb({ scopes: [], employeeBranchId: "branch-own" });
    const { resolveFinanceBranchScope } = await import("../finance-access-scope.js");
    expect(await resolveFinanceBranchScope(BRANCH_USER)).toBe("branch-own");
  });

  it("THROWS for a multi-branch user rather than returning undefined", async () => {
    // undefined here would mean "no WHERE clause" in branchBudgetService.list — every branch
    // in the company, handed to a user granted three. Failing closed is mandatory until each
    // router is migrated to financeBranchFilter.
    mockDb({
      scopes: [
        { scope_type: "branch", branch_id: "noida" },
        { scope_type: "branch", branch_id: "ahmedabad" },
      ],
    });
    const { resolveFinanceBranchScope } = await import("../finance-access-scope.js");
    await expect(resolveFinanceBranchScope(BRANCH_USER)).rejects.toThrow(
      /does not support multi-branch access yet/i,
    );
  });
});

describe("assertFinanceRecordBranch — multi-branch record guard", () => {
  const multiBranch = {
    scopes: [
      { scope_type: "branch", branch_id: "noida" },
      { scope_type: "branch", branch_id: "ahmedabad" },
    ],
  };

  it("allows a record in either granted branch", async () => {
    mockDb(multiBranch);
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({ ...BRANCH_USER, recordBranchId: "noida" }),
    ).resolves.toBeUndefined();
    await expect(
      assertFinanceRecordBranch({ ...BRANCH_USER, recordBranchId: "ahmedabad" }),
    ).resolves.toBeUndefined();
  });

  it("denies a record in a third branch", async () => {
    mockDb(multiBranch);
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({ ...BRANCH_USER, recordBranchId: "delhi" }),
    ).rejects.toThrow(/cannot access a finance record from another branch/i);
  });

  it("still denies a record whose branch is unknown", async () => {
    mockDb(multiBranch);
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({ ...BRANCH_USER, recordBranchId: null }),
    ).rejects.toThrow(/cannot access a finance record from another branch/i);
  });
});
