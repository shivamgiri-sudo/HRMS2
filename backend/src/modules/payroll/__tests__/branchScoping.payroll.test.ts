import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping for the payroll family (owner ruling 2026-10-01): hr / payroll / payroll_hr and other
 * non-exempt roles see and change only their own branch / assigned scope; ORG_WIDE_EXEMPT_ROLES are
 * unaffected; a browser branch filter can only narrow; no resolvable scope => nothing (fail closed).
 *
 * The real shared helpers (enterpriseScope / scopeAccess) run against a mocked db so the whole chain
 * (roles -> assignments -> predicate) is exercised, not stubbed.
 */
const { dbExecute, dbQuery } = vi.hoisted(() => ({ dbExecute: vi.fn(), dbQuery: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbQuery } }));
vi.mock("../../../shared/requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../shared/demoAuth.js", () => ({ demoRoleForUserId: () => null }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

type Scenario = {
  roles: string[];
  assignments: Array<{ role_key: string; scope_type: string; branch_id?: string | null; process_id?: string | null }>;
  ownBranch: string | null;
  /** employee ids -> branch id (for canViewEmployee lookups) */
  employees: Record<string, string>;
};
const sc: Scenario = { roles: [], assignments: [], ownBranch: null, employees: {} };
const sqlLog: Array<{ sql: string; params: unknown[] }> = [];

function respond(sql: string, params: unknown[] = []): [unknown[], unknown[]] {
  sqlLog.push({ sql, params });
  if (/FROM user_roles WHERE user_id/.test(sql)) return [sc.roles.map((role_key) => ({ role_key })), []];
  if (/FROM user_assignment_scope/.test(sql)) {
    return [sc.assignments.map((a) => ({ id: "a", lob_id: null, department_id: null, manager_employee_id: null, client_id: null, process_id: null, branch_id: null, ...a })), []];
  }
  if (/FROM employees\s+WHERE user_id = \?\s+AND active_status = 1\s+ORDER BY/.test(sql)) {
    return [sc.ownBranch ? [{ id: "emp-self", employee_code: "E1", branch_id: sc.ownBranch }] : [], []];
  }
  if (/SELECT id, branch_id, process_id, lob_id, department_id, reporting_manager_id\s+FROM employees/.test(sql)) {
    const id = String(params[0]);
    return [sc.employees[id] ? [{ id, branch_id: sc.employees[id] }] : [], []];
  }
  if (/SELECT branch_id FROM employees WHERE user_id/.test(sql)) return [sc.ownBranch ? [{ branch_id: sc.ownBranch }] : [], []];
  return [[], []];
}

beforeEach(() => {
  sqlLog.length = 0;
  sc.roles = []; sc.assignments = []; sc.ownBranch = null; sc.employees = {};
  dbExecute.mockReset(); dbQuery.mockReset();
  dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => respond(sql, params));
  dbQuery.mockImplementation(async (sql: string, params?: unknown[]) => respond(sql, params));
});

const req = { authUser: { id: "u1" } };

describe("payroll-branch-scope helpers", () => {
  it("org-wide roles are unrestricted", async () => {
    const h = await import("../payroll-branch-scope.js");
    for (const role of ["payroll_head", "finance", "super_admin", "ceo"]) {
      sc.roles = [role];
      expect(await h.visibleBranchIdsFor(req)).toBeNull();
      expect((await h.employeeScopeFor(req)).sql).toBe("1=1");
      expect((await h.narrowBranch(req, "any-branch")).ok).toBe(true);
    }
  });

  it("admin is branch-scoped, not org-wide (owner ruling 2026-10-01)", async () => {
    const h = await import("../payroll-branch-scope.js");
    sc.roles = ["admin"]; sc.ownBranch = "A";
    expect(await h.visibleBranchIdsFor(req)).not.toBeNull();
    expect((await h.employeeScopeFor(req)).sql).not.toBe("1=1");
    expect((await h.narrowBranch(req, "B")).ok).toBe(false);
  });

  it("hr is limited to its assigned branch and cannot widen with a browser branch id", async () => {
    const h = await import("../payroll-branch-scope.js");
    sc.roles = ["hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "hr", scope_type: "branch", branch_id: "A" }];
    expect(Array.from((await h.visibleBranchIdsFor(req))!)).toEqual(["A"]);
    expect(await h.narrowBranch(req, "B")).toEqual({ ok: false, branchIds: [] });
    expect(await h.narrowBranch(req, "A")).toEqual({ ok: true, branchIds: ["A"] });
    const cond = await h.employeeScopeFor(req, "e");
    expect(cond.sql).toMatch(/e\.branch_id = \?/);
    expect(cond.params).toContain("A");
  });

  it("an 'all' assignment on a non-exempt role means its own branch, not the company", async () => {
    const h = await import("../payroll-branch-scope.js");
    sc.roles = ["payroll_hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "payroll_hr", scope_type: "all" }];
    expect(Array.from((await h.visibleBranchIdsFor(req))!)).toEqual(["A"]);
  });

  it("a user with no resolvable scope sees nothing", async () => {
    const h = await import("../payroll-branch-scope.js");
    sc.roles = ["hr"]; sc.ownBranch = null; sc.assignments = [];
    const visible = await h.visibleBranchIdsFor(req);
    expect(visible).not.toBeNull();
    expect(visible!.size).toBe(0);
    expect((await h.narrowBranch(req, undefined)).ok).toBe(false);
    expect((await h.employeeScopeFor(req)).sql).toBe("1=0");
    expect(await h.canSeeEmployee(req, "emp-x")).toBe(false);
  });

  it("canSeeEmployee honours branch membership", async () => {
    const h = await import("../payroll-branch-scope.js");
    sc.roles = ["hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "hr", scope_type: "branch", branch_id: "A" }];
    sc.employees = { "emp-a": "A", "emp-b": "B" };
    expect(await h.canSeeEmployee(req, "emp-a")).toBe(true);
    expect(await h.canSeeEmployee(req, "emp-b")).toBe(false);
  });
});

function mount(router: express.Router, base: string) {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  app.use((err: any, _q: any, res: any, _n: any) => res.status(500).json({ error: String(err?.message ?? err) }));
  return app;
}

describe("bank-payment-readiness: resolveVisibleBranchIds fails closed", () => {
  const items = async () => {
    const { bankPaymentReadinessRouter } = await import("../bank-payment-readiness.routes.js");
    return request(mount(bankPaymentReadinessRouter, "/bank")).get("/bank/salary-transfer/items?run_id=r1");
  };
  const itemsSql = () => sqlLog.find((l) => /FROM salary_transfer_batch_item i/.test(l.sql));

  it("a non-org-wide user with zero assignment rows and no branch gets nothing (was: everything)", async () => {
    sc.roles = ["payroll_hr"]; sc.assignments = []; sc.ownBranch = null;
    const res = await items();
    expect(res.status).toBe(200);
    expect(itemsSql()!.sql).toMatch(/AND 1=0/);
  });

  it("a branch user is limited to its own branch", async () => {
    sc.roles = ["payroll_hr"]; sc.assignments = []; sc.ownBranch = "A";
    await items();
    expect(itemsSql()!.sql).toMatch(/e\.branch_id IN \(\?\)/);
    expect(itemsSql()!.params).toEqual(["r1", "A"]);
  });

  it("an org-wide role keeps the unfiltered query", async () => {
    sc.roles = ["finance"];
    await items();
    expect(itemsSql()!.sql).not.toMatch(/e\.branch_id IN/);
    expect(itemsSql()!.sql).not.toMatch(/1=0/);
  });
});

describe("per-employee reads are refused outside the caller's branch", () => {
  beforeEach(() => {
    sc.roles = ["hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "hr", scope_type: "branch", branch_id: "A" }];
    sc.employees = { "emp-a": "A", "emp-b": "B" };
  });

  it("loans: GET /employee/:id", async () => {
    const { loansRouter } = await import("../loans.routes.js");
    const app = mount(loansRouter, "/loans");
    expect((await request(app).get("/loans/employee/emp-b")).status).toBe(403);
    expect((await request(app).get("/loans/employee/emp-a")).status).toBe(200);
  });

  it("loans list is filtered by the caller's scope predicate", async () => {
    const { loansRouter } = await import("../loans.routes.js");
    await request(mount(loansRouter, "/loans")).get("/loans");
    const q = sqlLog.find((l) => /FROM employee_loans el/.test(l.sql) && /COUNT/.test(l.sql));
    expect(q!.sql).toMatch(/e\.branch_id = \?/);
    expect(q!.params).toContain("A");
  });

  it("payslip lines (compat) carry the scope predicate", async () => {
    const { payrollLinesCompatRouter } = await import("../payroll-lines.compat.routes.js");
    await request(mount(payrollLinesCompatRouter, "/p")).get("/p/runs/r1/lines");
    const q = sqlLog.find((l) => /FROM salary_prep_line spl/.test(l.sql) && /COUNT/.test(l.sql));
    expect(q!.sql).toMatch(/e\.branch_id = \?/);
    // run id, the caller's own employee, then the branch - repeated once because the own-branch clamp
    // (eda08483f) also ANDs the branch on the caller's employee record to every assignment row.
    expect(q!.params.slice(0, 2)).toEqual(["r1", "emp-self"]);
    expect(q!.params.slice(2).every((p: unknown) => p === "A")).toBe(true);
    expect(q!.params.length).toBeGreaterThanOrEqual(3);
  });

  it("noc: GET /required/:employeeId", async () => {
    const { nocRouter } = await import("../noc.routes.js");
    sc.roles = ["hr", "payroll"];
    const app = mount(nocRouter, "/noc");
    expect((await request(app).get("/noc/required/emp-b")).status).toBe(403);
  });

  it("tds certificate part A status: payroll role outside branch is refused", async () => {
    const { tdsCertificatePartARouter } = await import("../tds-certificate-part-a.routes.js");
    sc.roles = ["payroll"];
    const app = mount(tdsCertificatePartARouter, "/tds");
    expect((await request(app).get("/tds/emp-b/2026")).status).toBe(403);
  });

  it("org-wide payroll_head passes the same guard", async () => {
    const { loansRouter } = await import("../loans.routes.js");
    sc.roles = ["payroll_head"];
    expect((await request(mount(loansRouter, "/loans")).get("/loans/employee/emp-b")).status).toBe(200);
  });
});

describe("pf creation: client branch id may only narrow", () => {
  it("branchId outside the caller's scope is refused", async () => {
    const { pfCreationRouter } = await import("../pf-creation.routes.js");
    sc.roles = ["payroll_hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "payroll_hr", scope_type: "branch", branch_id: "A" }];
    const app = mount(pfCreationRouter, "/pf");
    expect((await request(app).get("/pf/queue?branchId=B")).status).toBe(403);
    expect((await request(app).get("/pf/queue?branchId=A")).status).toBe(200);
  });

  it("generate-from-joiners without a branch is refused for a branch user", async () => {
    const { pfCreationRouter } = await import("../pf-creation.routes.js");
    sc.roles = ["payroll_hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "payroll_hr", scope_type: "branch", branch_id: "A" }];
    const res = await request(mount(pfCreationRouter, "/pf")).post("/pf/queue/generate-from-joiners").send({});
    expect(res.status).toBe(403);
  });
});

describe("config flags (client branch_id)", () => {
  it("GET refuses a branch outside scope and PUT refuses company-wide flags for a branch user", async () => {
    const { payrollMoreRouter } = await import("../payroll-more.routes.js");
    sc.roles = ["payroll"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "payroll", scope_type: "branch", branch_id: "A" }];
    const app = mount(payrollMoreRouter, "/more");
    expect((await request(app).get("/more/config-flags?branch_id=B")).status).toBe(403);
    expect((await request(app).get("/more/config-flags?branch_id=A")).status).toBe(200);
    expect((await request(app).put("/more/config-flags").send({ config_key: "k", config_value: "v" })).status).toBe(403);
    expect((await request(app).put("/more/config-flags").send({ branch_id: "B", config_key: "k", config_value: "v" })).status).toBe(403);
  });

  it("org-wide payroll_head can still write a company-wide flag", async () => {
    const { payrollMoreRouter } = await import("../payroll-more.routes.js");
    sc.roles = ["payroll_head"];
    const res = await request(mount(payrollMoreRouter, "/more")).put("/more/config-flags").send({ config_key: "k", config_value: "v" });
    expect(res.status).toBe(200);
  });
});

describe("other modules sharing the helper", () => {
  beforeEach(() => {
    sc.roles = ["hr"]; sc.ownBranch = "A";
    sc.assignments = [{ role_key: "hr", scope_type: "branch", branch_id: "A" }];
    sc.employees = { "emp-a": "A", "emp-b": "B" };
  });

  it("salary-revision: raising a revision for another branch's employee is refused", async () => {
    const { salaryRevisionRouter } = await import("../../salary-revision/salary-revision.routes.js");
    const res = await request(mount((salaryRevisionRouter as any), "/rev")).post("/rev").send({
      employee_id: "emp-b", requested_effective_from: "2026-10-01", reason: "x",
    });
    expect(res.status).toBe(403);
  });

  it("salary-increment: creating for another branch's employee is refused", async () => {
    const { salaryIncrementRouter } = await import("../../salary-increment/salaryIncrement.routes.js");
    const res = await request(mount(salaryIncrementRouter, "/inc")).post("/inc").send({
      employee_id: "emp-b", proposed_ctc: 100, effective_from: "2026-10-01",
    });
    expect(res.status).toBe(403);
  });

  it("salary-change: employee salary profile read is refused outside the branch", async () => {
    const { salaryChangeRouter } = await import("../../salary-change/salary-change.routes.js");
    const res = await request(mount(salaryChangeRouter, "/sc")).get("/sc/employee/emp-b");
    expect(res.status).toBe(403);
  });

  it("payroll-head-review: journey of another branch's employee is refused", async () => {
    const { payrollHeadReviewRouter: router } = await import("../../payroll-head-review/payroll-head-review.routes.js");
    const res = await request(mount(router as any, "/phr")).get("/phr/emp-b");
    expect(res.status).toBe(403);
  });

  it("compliance: maternity approve for another branch's employee is refused", async () => {
    dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FROM maternity_benefit_record|maternity_benefit_record m/.test(sql)) return [[{ id: "m1", employee_id: "emp-b", status: "applied" }], []];
      return respond(sql, params);
    });
    const { complianceRouter } = await import("../../compliance/compliance.routes.js");
    const res = await request(mount(complianceRouter, "/c")).post("/c/maternity/m1/approve");
    expect(res.status).toBe(403);
  });

  it("incentives: a batch outside the caller's branch is refused", async () => {
    const { incentivesRouter } = await import("../../incentives/incentives.routes.js");
    const res = await request(mount(incentivesRouter, "/i")).get("/i/batches/b-other");
    expect(res.status).toBe(403);
  });
});
