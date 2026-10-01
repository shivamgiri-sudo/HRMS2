import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping for the ATS module (owner ruling 2026-10-01): hr, payroll_hr, manager, branch_head,
 * recruiter and every other non-org-wide role act only on candidates inside their own branch / assigned
 * scope; org-wide roles (super_admin, admin, ceo, coo, cfo, payroll_head, finance_head, accounts_head,
 * finance) are unaffected; a caller with no resolvable scope sees nothing.
 */
const { dbExecute, dbQuery, getConnection, roleKeys, assignmentScopes, canAccess, assertBh } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  dbQuery: vi.fn(),
  getConnection: vi.fn(),
  roleKeys: vi.fn(),
  assignmentScopes: vi.fn(),
  canAccess: vi.fn(),
  assertBh: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbQuery, getConnection } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  getUserRoleKeys: roleKeys,
  getUserAssignmentScopes: assignmentScopes,
  hasAnyRole: vi.fn(async () => false),
  hasScopedAccess: vi.fn(async () => false),
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=0", params: [] })),
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = req.authUser ?? { id: "u1", role: "hr", roles: ["hr"] }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

import {
  buildBranchNameScopeSql,
  buildCandidateScopeSql,
  branchInScope,
  narrowToAllowedBranch,
  pinDashboardBranch,
  resolveAtsBranchScope,
  scopeIsEmpty,
  type AtsBranchScope,
} from "../ats-branch-scope.js";

const scoped: AtsBranchScope = {
  orgWide: false, branchIds: ["b-1"], branchSpellings: ["b-1", "NOIDA-2", "Okaya Centre"], branchNames: ["NOIDA-2"], processNames: [],
};
const orgWide: AtsBranchScope = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
const empty: AtsBranchScope = { orgWide: false, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };

beforeEach(() => {
  dbExecute.mockReset(); dbQuery.mockReset(); roleKeys.mockReset(); assignmentScopes.mockReset(); canAccess.mockReset(); assertBh.mockReset();
  assignmentScopes.mockResolvedValue([]);
  dbExecute.mockResolvedValue([[], []]);
});

describe("ats-branch-scope helpers", () => {
  it("org-wide: 1=1, any requested branch passes", () => {
    expect(buildCandidateScopeSql(orgWide)).toEqual({ sql: "1=1", params: [] });
    expect(buildBranchNameScopeSql(orgWide, "x")).toEqual({ sql: "1=1", params: [] });
    expect(narrowToAllowedBranch(orgWide, "Anywhere")).toEqual({ branch: "Anywhere", forbidden: false });
    expect(pinDashboardBranch(orgWide, undefined)).toEqual({ ok: true, branch: undefined });
  });

  it("scoped: predicate lists every spelling of the caller's branch, with an optional alias", () => {
    const p = buildCandidateScopeSql(scoped, "c");
    expect(p.sql).toBe("(c.applied_for_branch IN (?,?,?))");
    expect(p.params).toEqual(["b-1", "NOIDA-2", "Okaya Centre"]);
    expect(buildBranchNameScopeSql(scoped, "branch_name").sql).toBe("branch_name IN (?,?,?)");
  });

  it("no resolvable scope: 1=0 (fail closed)", () => {
    expect(scopeIsEmpty(empty)).toBe(true);
    expect(buildCandidateScopeSql(empty).sql).toBe("1=0");
    expect(buildBranchNameScopeSql(empty, "x").sql).toBe("1=0");
    expect(pinDashboardBranch(empty, undefined)).toEqual({ ok: false });
  });

  it("a browser-supplied branch only NARROWS: foreign branch is forbidden, own branch is kept (case-insensitive)", () => {
    expect(narrowToAllowedBranch(scoped, "Pune")).toEqual({ branch: null, forbidden: true });
    expect(narrowToAllowedBranch(scoped, "noida-2")).toEqual({ branch: "noida-2", forbidden: false });
    expect(narrowToAllowedBranch(scoped, "")).toEqual({ branch: null, forbidden: false });
    expect(branchInScope(scoped, "Pune")).toBe(false);
    expect(branchInScope(scoped, "")).toBe(false);
  });

  it("dashboard branch is pinned for scoped callers, foreign branch refused", () => {
    expect(pinDashboardBranch(scoped, undefined)).toEqual({ ok: true, branch: "NOIDA-2" });
    expect(pinDashboardBranch(scoped, "Okaya Centre")).toEqual({ ok: true, branch: "Okaya Centre" });
    expect(pinDashboardBranch(scoped, "Pune")).toEqual({ ok: false });
  });
});

describe("resolveAtsBranchScope", () => {
  it.each(["super_admin", "admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"])(
    "%s is org-wide", async (role) => {
      roleKeys.mockResolvedValue([role]);
      expect((await resolveAtsBranchScope("u")).orgWide).toBe(true);
    });

  it("hr resolves to its own employee branch only", async () => {
    roleKeys.mockResolvedValue(["hr"]);
    dbExecute.mockImplementation(async (sql: string) => {
      if (/FROM employees/.test(sql)) return [[{ branch_id: "b-1" }], []];
      if (/FROM branch_master/.test(sql)) return [[{ branch_name: "NOIDA-2", branch_code: "N2" }], []];
      return [[], []];
    });
    const s = await resolveAtsBranchScope("u-hr");
    expect(s.orgWide).toBe(false);
    expect(s.branchIds).toEqual(["b-1"]);
    expect(s.branchSpellings).toEqual(expect.arrayContaining(["b-1", "NOIDA-2", "N2"]));
  });

  it("hr with no employee branch and no assignment sees nothing", async () => {
    roleKeys.mockResolvedValue(["hr"]);
    expect(scopeIsEmpty(await resolveAtsBranchScope("u-hr"))).toBe(true);
  });

  it("scope_type 'all' on a non-org-wide role does not widen anything", async () => {
    roleKeys.mockResolvedValue(["payroll_hr"]);
    assignmentScopes.mockResolvedValue([{ scope_type: "all", branch_id: "b-9", process_id: null }]);
    expect(scopeIsEmpty(await resolveAtsBranchScope("u-ph"))).toBe(true);
  });
});

/** Mounts a router with a fixed actor. */
function mount(router: express.Router, mountAt: string, actor = { id: "u-hr", role: "hr", roles: ["hr"] }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; next(); });
  app.use(mountAt, router);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.statusCode ?? 500).json({ message: String(err?.message) }));
  return app;
}

describe("candidate-id routers refuse an out-of-branch candidate (404) before touching the data", () => {
  vi.doMock("../candidate-access.js", async () => {
    const real = await vi.importActual<typeof import("../candidate-access.js")>("../candidate-access.js");
    return { ...real, canAccessCandidate: canAccess };
  });

  it("name-consistency: GET /:candidateId, recalculate and override all refused outside the branch", async () => {
    vi.resetModules();
    vi.doMock("../candidate-access.js", () => ({
      canAccessCandidate: canAccess,
      resolveCandidateScope: vi.fn(async () => ({ sql: "1=1", params: [] })),
    }));
    const { default: router } = await import("../name-consistency.routes.js").then((m: any) => ({ default: m.default ?? m.nameConsistencyRouter ?? m.router }));
    canAccess.mockResolvedValue(false);
    const app = mount(router, "/nc");
    expect((await request(app).get("/nc/cand-b")).status).toBe(404);
    expect((await request(app).post("/nc/cand-b/recalculate")).status).toBe(404);
    expect((await request(app).post("/nc/cand-b/override-request").send({ reason: "x" })).status).toBe(404);
    expect(dbExecute.mock.calls.filter((c) => /candidate_name_match/.test(String(c[0])))).toHaveLength(0);

    canAccess.mockResolvedValue(true);
    const ok = await request(app).get("/nc/cand-a");
    expect(ok.status).toBe(200);
  });

  it("name-consistency list is limited by the caller's candidate scope", async () => {
    vi.resetModules();
    vi.doMock("../candidate-access.js", () => ({
      canAccessCandidate: canAccess,
      resolveCandidateScope: vi.fn(async (_u: string, alias?: string) => ({ sql: `${alias}.applied_for_branch IN (?)`, params: ["NOIDA-2"] })),
    }));
    const mod: any = await import("../name-consistency.routes.js");
    const router = mod.default ?? mod.nameConsistencyRouter ?? mod.router;
    const res = await request(mount(router, "/nc")).get("/nc/");
    expect(res.status).toBe(200);
    const q = dbExecute.mock.calls.find((c) => /candidate_name_match_summary cnms/.test(String(c[0])))!;
    expect(String(q[0])).toContain("ac.applied_for_branch IN (?)");
    expect(q[1]).toEqual(["NOIDA-2"]);
  });

  it("payroll-hr: candidate route refused outside the branch; lists carry the scope predicate", async () => {
    vi.resetModules();
    vi.doMock("../candidate-access.js", () => ({
      canAccessCandidate: canAccess,
      candidateParamGuard: () => (req: any, res: any, next: any, id: string) =>
        canAccess(req.authUser.id, id).then((ok: boolean) => (ok ? next() : res.status(404).json({ success: false }))),
      resolveCandidateScope: vi.fn(async () => ({ sql: "c.applied_for_branch IN (?)", params: ["NOIDA-2"] })),
    }));
    const getPending = vi.fn(async () => []);
    vi.doMock("../payroll-hr.service.js", () => ({
      getPendingCandidates: getPending, getValidatedCandidates: vi.fn(async () => []), getCandidateForValidation: vi.fn(async () => ({ ok: 1 })),
      validateAndAssignSalary: vi.fn(), getValidationRecord: vi.fn(), notifyBranchHeadForApproval: vi.fn(), calculateSalaryBreakdown: vi.fn(),
    }));
    vi.doMock("../branch-head-scope.js", () => ({ resolveEmployeeIdForAuthUser: vi.fn(async () => "e1") }));
    const mod: any = await import("../payroll-hr.routes.js");
    const router = mod.default ?? mod.payrollHRRouter;
    const app = mount(router, "/p", { id: "u-ph", role: "payroll_hr", roles: ["payroll_hr"] });

    canAccess.mockResolvedValue(false);
    expect((await request(app).get("/p/candidate/cand-b")).status).toBe(404);
    expect((await request(app).post("/p/salary-proposal").send({ candidate_id: "cand-b", salary_slab_id: "s", proposed_gross_salary: 1, proposal_reason: "r" })).status).toBe(404);
    expect(dbExecute.mock.calls.filter((c) => /INSERT INTO salary_exception_proposal/.test(String(c[0])))).toHaveLength(0);

    await request(app).get("/p/pending-candidates");
    expect(getPending).toHaveBeenCalledWith({ sql: "c.applied_for_branch IN (?)", params: ["NOIDA-2"] });
  });
});

describe("ats-analytics: company-wide aggregates are refused to branch-scoped roles", () => {
  it("hr gets 403, ceo is unaffected", async () => {
    vi.resetModules();
    vi.doMock("../analytics.unified.service.js", () => ({
      getUnifiedCandidateCount: vi.fn(async () => ({ count: 1 })), getHiringTrends: vi.fn(), getSourceChannelROI: vi.fn(),
      getRecruiterTrends: vi.fn(), getPredictiveAnalytics: vi.fn(), getTimeToHireMetrics: vi.fn(), getCustomReport: vi.fn(),
    }));
    const { atsAnalyticsRouter } = await import("../ats-analytics.routes.js");

    roleKeys.mockResolvedValue(["hr"]);
    const hr = await request(mount(atsAnalyticsRouter, "/a", { id: "u-hr", role: "hr", roles: ["hr"] })).get("/a/candidate-count");
    expect(hr.status).toBe(403);

    roleKeys.mockResolvedValue(["ceo"]);
    const ceo = await request(mount(atsAnalyticsRouter, "/a", { id: "u-ceo", role: "ceo", roles: ["ceo"] })).get("/a/candidate-count");
    expect(ceo.status).toBe(200);
  });
});

describe("recruiter hiring activity: hr is no longer org-wide", () => {
  it("isOrgWideRole follows the owner's list", async () => {
    vi.resetModules();
    const { isOrgWideRole } = await import("../recruiter-hiring.service.js");
    for (const r of ["super_admin", "admin", "ceo", "payroll_head", "finance"]) expect(isOrgWideRole(r)).toBe(true);
    for (const r of ["hr", "ho_hr", "branch_head", "recruiter", "manager", "payroll_hr", undefined, ""]) expect(isOrgWideRole(r as string)).toBe(false);
  });
});

describe("branch-head scope: hr is branch-scoped, org-wide roles unrestricted", () => {
  const load = async () => {
    vi.resetModules();
    vi.doUnmock("../branch-head-scope.js");
    return import("../branch-head-scope.js");
  };

  it("admin / ceo stay unrestricted", async () => {
    const { resolveBranchHeadScope } = await load();
    for (const r of ["admin", "ceo", "payroll_head"]) {
      roleKeys.mockResolvedValue([r]);
      expect((await resolveBranchHeadScope("u")).unrestricted).toBe(true);
    }
  });

  it("hr with no assignment falls back to its OWN employee branch (was: unrestricted)", async () => {
    roleKeys.mockResolvedValue(["hr"]);
    dbExecute.mockImplementation(async (sql: string) => {
      if (/branch_head_assignments/.test(sql)) return [[], []];
      if (/SELECT id FROM employees/.test(sql)) return [[{ id: "emp-1" }], []];
      if (/SELECT branch_id FROM employees/.test(sql)) return [[{ branch_id: "b-1" }], []];
      return [[], []];
    });
    const { resolveBranchHeadScope } = await load();
    const s = await resolveBranchHeadScope("u-hr");
    expect(s.unrestricted).toBe(false);
    expect(s.branchIds).toEqual(["b-1"]);
  });

  it("hr with no resolvable branch sees nothing", async () => {
    roleKeys.mockResolvedValue(["hr"]);
    const { resolveBranchHeadScope, buildCandidateBranchPredicate } = await load();
    const s = await resolveBranchHeadScope("u-hr");
    expect(buildCandidateBranchPredicate(s, { candidate: "c" }).sql).toBe("1 = 0");
  });
});

describe("processBranchHeadApproval decides scope BEFORE any write", () => {
  it("throws 403 and never opens a transaction when the candidate is outside the branch", async () => {
    vi.resetModules();
    vi.doMock("../branch-head-scope.js", () => ({
      resolveBranchHeadScope: vi.fn(), buildCandidateBranchPredicate: vi.fn(),
      assertBranchHeadCanSeeCandidate: assertBh,
    }));
    vi.doMock("../ats.email.service.js", () => ({ sendSelectedEmail: vi.fn(), sendRejectedEmail: vi.fn() }));
    vi.doMock("../ats.onboarding.service.js", () => ({ approveOffer: vi.fn(), rejectOffer: vi.fn() }));
    vi.doMock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));
    vi.doMock("../bgv-address-verification.routes.js", () => ({ autoSendAddressBgvLink: vi.fn() }));
    dbExecute.mockResolvedValue([[{ candidate_id: "cand-b", employment_type: "onroll", offer_id: null }], []]);
    assertBh.mockRejectedValue(Object.assign(new Error("not in your branch"), { statusCode: 403 }));
    const { processBranchHeadApproval } = await import("../branch-head-approval.service.js");

    await expect(processBranchHeadApproval({ approval_id: "a1", branch_head_id: "e1", branch_head_user_id: "u-hr", approval_status: "approved" } as any))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(assertBh).toHaveBeenCalledWith("u-hr", "cand-b");
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe("reconciliation rows are filtered to the caller's branch", () => {
  it("org-wide: rows untouched; scoped: only rows whose candidate/employee is in scope; empty scope: nothing", async () => {
    vi.resetModules();
    vi.doMock("../../../shared/enterpriseScope.js", () => ({
      resolveUserBusinessScope: vi.fn(async () => ({})),
      buildEmployeeScopeCondition: vi.fn(() => ({ sql: "e.branch_id = ?", params: ["b-1"] })),
    }));
    const { scopeReconciliationRows } = await import("../reconciliation-scope.js");
    const rows = [
      { candidate_id: "c-in" }, { candidate_id: "c-out" }, { employee_id: "e-in" }, { employee_id: "e-out" }, { note: "no ids" },
    ];

    roleKeys.mockResolvedValue(["admin"]);
    expect(await scopeReconciliationRows("u-admin", rows)).toHaveLength(5);

    roleKeys.mockResolvedValue(["hr"]);
    dbExecute.mockImplementation(async (sql: string) => {
      if (/FROM employees WHERE user_id/.test(sql)) return [[{ branch_id: "b-1" }], []];
      if (/FROM branch_master/.test(sql)) return [[{ branch_name: "NOIDA-2", branch_code: null }], []];
      if (/FROM ats_candidate c WHERE c.id IN/.test(sql)) return [[{ id: "c-in" }], []];
      if (/FROM employees e WHERE e.id IN/.test(sql)) return [[{ id: "e-in" }], []];
      return [[], []];
    });
    expect(await scopeReconciliationRows("u-hr", rows)).toEqual([{ candidate_id: "c-in" }, { employee_id: "e-in" }]);

    roleKeys.mockResolvedValue(["hr"]);
    dbExecute.mockResolvedValue([[], []]);
    expect(await scopeReconciliationRows("u-nobranch", rows)).toEqual([]);
  });
});

describe("fraud alert review is refused outside the branch", () => {
  it("PATCH /:alertId/review returns 403 and writes nothing", async () => {
    vi.resetModules();
    vi.doMock("../candidate-access.js", () => ({
      canAccessCandidate: canAccess,
      candidateParamGuard: () => (_q: any, _s: any, next: any) => next(),
      resolveCandidateScope: vi.fn(async () => ({ sql: "1=1", params: [] })),
    }));
    vi.doMock("../face-match.service.js", () => ({ detectFaceBbox: vi.fn(), compareFaces: vi.fn() }));
    vi.doMock("../onboardingDocumentPath.js", () => ({ resolveOnboardingDocumentFile: vi.fn() }));
    vi.doMock("../name-consistency.routes.js", () => ({ recalculateNameMatch: vi.fn() }));
    vi.doMock("../../integrations/luckpay/luckpay-status.service.js", () => ({ getLatestDigilockerFile: vi.fn() }));
    vi.doMock("../digilocker-face-photo.js", () => ({ getDigilockerFacePhotoBuffer: vi.fn() }));
    vi.doMock("../fraud-identity.service.js", () => ({ buildIdentityComparison: vi.fn() }));
    const mod: any = await import("../fraud-alerts.routes.js");
    const router = mod.default;
    dbExecute.mockImplementation(async (sql: string) => (/SELECT candidate_id FROM candidate_fraud_alert/.test(sql) ? [[{ candidate_id: "cand-b" }], []] : [[], []]));
    canAccess.mockResolvedValue(false);
    const res = await request(mount(router, "/f", { id: "u-hr", role: "hr", roles: ["hr"] }))
      .patch("/f/alert-1/review").send({ status: "dismissed", notes: "ok" });
    expect(res.status).toBe(403);
    expect(dbExecute.mock.calls.filter((c) => /UPDATE candidate_fraud_alert/.test(String(c[0])))).toHaveLength(0);
  });
});
