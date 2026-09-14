import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Row scope on the Cost Centre API.
 *
 * CC_READ_ROLES admits branch_head and branch_admin, and neither holds global finance scope —
 * but no endpoint in cost-centre-management.routes.ts resolved a branch. list() applies its
 * branch_id filter only when the CLIENT sends one, so omitting it returned all 927 cost centres
 * across all 26 branches, with their clients, billing rates and approval trails.
 *
 * It was latent until migration 1129 seeded the FINANCE_COST_CENTRES page grants that had never
 * existed. Before that only super_admin could reach the page, so nothing branch-scoped could
 * call these endpoints. Granting the page is what made the gap reachable — which is why it is
 * fixed in the same breath.
 *
 * The write and approval endpoints are untouched: CC_CREATE_ROLES, CC_L1_APPROVAL_ROLES and
 * CC_L2_APPROVAL_ROLES contain only globally-scoped roles, so there is no branch to pin.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { list, getStatusCounts, getById, getApprovalHistory } = vi.hoisted(() => ({
  list: vi.fn(), getStatusCounts: vi.fn(), getById: vi.fn(), getApprovalHistory: vi.fn(),
}));
vi.mock("../cost-centre-management.service.js", () => ({
  costCentreManagementService: { list, getStatusCounts, getById, getApprovalHistory },
}));

const OWN = "branch-A";
const OTHER = "branch-B";

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { costCentreManagementRouter as router } from "../cost-centre-management.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  app.use("/api/finance/cost-centres", router);
  return app;
}

beforeEach(() => {
  execute.mockReset();
  // Whatever the scope resolver asks the database, this caller belongs to branch-A.
  execute.mockResolvedValue([[{ branch_id: OWN, id: OWN }], []]);
  list.mockReset().mockResolvedValue({ data: [], total: 0 });
  getStatusCounts.mockReset().mockResolvedValue({});
  getById.mockReset().mockResolvedValue({ id: "cc1", branch_id: OTHER });
  getApprovalHistory.mockReset().mockResolvedValue([]);
});

describe("GET / (list)", () => {
  it("pins a branch_head to their own branch when they ask for none", async () => {
    const res = await request(appFor("branch_head")).get("/api/finance/cost-centres");
    expect(res.status).toBe(200);
    // The defect exactly: no branch_id meant every branch.
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ branch_id: OWN }));
  });

  it("refuses a branch_head who names another branch", async () => {
    const res = await request(appFor("branch_admin"))
      .get(`/api/finance/cost-centres?branch_id=${OTHER}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("leaves a global finance role unrestricted", async () => {
    const res = await request(appFor("finance_head")).get("/api/finance/cost-centres");
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ branch_id: undefined }));
  });
});

describe("GET /status-counts", () => {
  it("counts only the caller's branch, so the badges match the tabs", async () => {
    const res = await request(appFor("branch_head")).get("/api/finance/cost-centres/status-counts");
    expect(res.status).toBe(200);
    expect(getStatusCounts).toHaveBeenCalledWith(OWN);
  });

  it("counts everything for a global role", async () => {
    await request(appFor("finance")).get("/api/finance/cost-centres/status-counts");
    expect(getStatusCounts).toHaveBeenCalledWith(undefined);
  });
});

describe("GET /:id and /:id/history", () => {
  it("refuses a record belonging to another branch", async () => {
    // A uuid is not an access control, and the record carries client and billing rates.
    const res = await request(appFor("branch_head")).get("/api/finance/cost-centres/cc1");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses that record's approval history too", async () => {
    // The history holds reviewer commentary and rejection reasons.
    const res = await request(appFor("branch_head")).get("/api/finance/cost-centres/cc1/history");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getApprovalHistory).not.toHaveBeenCalled();
  });

  it("serves a record from the caller's own branch", async () => {
    getById.mockResolvedValue({ id: "cc1", branch_id: OWN });
    const res = await request(appFor("branch_head")).get("/api/finance/cost-centres/cc1");
    expect(res.status).toBe(200);
  });

  it("serves any record to a global finance role", async () => {
    const res = await request(appFor("finance_head")).get("/api/finance/cost-centres/cc1");
    expect(res.status).toBe(200);
  });
});
