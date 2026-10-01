import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Job requisition branch scoping (owner policy 2026-10-01): a :branch / ?branch is not scope, it only narrows. */
const { dbExecute, roles, svc } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  roles: { value: ["hr"] as string[] },
  svc: {
    getOpenRequisitionsForBranch: vi.fn(async () => []),
    getProcessesForBranch: vi.fn(async () => []),
    getAvailableBatches: vi.fn(async () => []),
    getHandoverRecipientOptions: vi.fn(async () => []),
    getBranchScope: vi.fn(),
    isRequisitionVisible: vi.fn(async () => true),
  },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../job-requisition.service.js", () => ({ jobRequisitionService: svc }));
vi.mock("../../../shared/requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../shared/demoAuth.js", () => ({ demoRoleForUserId: () => null }));

const noida = { orgWide: false, branchIds: ["b-noida"], branchNames: ["NOIDA", "NDA"] };
beforeEach(() => {
  vi.clearAllMocks();
  svc.getBranchScope.mockResolvedValue(noida);
});
async function app() {
  const { jobRequisitionRouter } = await import("../job-requisition.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/job-requisition", jobRequisitionRouter); return a;
}

describe("job-requisition :branch endpoints", () => {
  it("open-for-branch / processes-for-branch: 403 for a foreign branch, 200 for own (case-insensitive)", async () => {
    const a = await app();
    expect((await request(a).get("/api/job-requisition/open-for-branch/DELHI")).status).toBe(403);
    expect((await request(a).get("/api/job-requisition/processes-for-branch/DELHI")).status).toBe(403);
    expect((await request(a).get("/api/job-requisition/open-for-branch/noida")).status).toBe(200);
    expect((await request(a).get("/api/job-requisition/processes-for-branch/NOIDA")).status).toBe(200);
    expect(svc.getOpenRequisitionsForBranch).toHaveBeenCalledTimes(1);
  });

  it("a user with no resolvable branch is refused everywhere", async () => {
    svc.getBranchScope.mockResolvedValue({ orgWide: false, branchIds: [], branchNames: [] });
    const a = await app();
    expect((await request(a).get("/api/job-requisition/open-for-branch/NOIDA")).status).toBe(403);
  });

  it("org-wide roles may name any branch", async () => {
    svc.getBranchScope.mockResolvedValue({ orgWide: true, branchIds: [], branchNames: [] });
    const a = await app();
    expect((await request(a).get("/api/job-requisition/open-for-branch/DELHI")).status).toBe(200);
  });

  it("batches/available: scope is passed to the service, a foreign ?branch is 403", async () => {
    const a = await app();
    expect((await request(a).get("/api/job-requisition/batches/available?branch=DELHI")).status).toBe(403);
    expect((await request(a).get("/api/job-requisition/batches/available")).status).toBe(200);
    expect(svc.getAvailableBatches).toHaveBeenCalledWith(expect.objectContaining({ branchIn: ["NOIDA", "NDA"] }));
    svc.getBranchScope.mockResolvedValue({ orgWide: true, branchIds: [], branchNames: [] });
    await request(a).get("/api/job-requisition/batches/available");
    expect(svc.getAvailableBatches).toHaveBeenLastCalledWith(expect.objectContaining({ branchIn: undefined }));
  });

  it("handover-recipients receives the caller's branch scope", async () => {
    const a = await app();
    expect((await request(a).get("/api/job-requisition/handover-recipients")).status).toBe(200);
    expect(svc.getHandoverRecipientOptions).toHaveBeenCalledWith(expect.any(Array), noida);
  });
});

describe("job-requisition-hr-scope", () => {
  it("coo/cfo/finance etc. are org-wide, hr and a non-exempt 'all' scope row are not", async () => {
    const { isOrgWideRoleSet } = await import("../job-requisition-hr-scope.js");
    for (const r of ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"]) {
      expect(isOrgWideRoleSet([r])).toBe(true);
    }
    expect(isOrgWideRoleSet(["hr"])).toBe(false);
    // admin is branch-scoped too (ORG_WIDE_EXEMPT_ROLES no longer lists it)
    expect(isOrgWideRoleSet(["admin"])).toBe(false);
  });
});
