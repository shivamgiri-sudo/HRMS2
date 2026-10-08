import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner ruling 2026-10-01: hr is branch-scoped in the helpdesk (tickets, aggregates, agents).
const { hasRoleForRequest, getEmployeeForUser } = vi.hoisted(() => ({
  hasRoleForRequest: vi.fn(async () => false),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-1" })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRoleForRequest, getEmployeeForUser }));

const { resolveUserBusinessScope, buildProcessScopeCondition } = vi.hoisted(() => ({
  resolveUserBusinessScope: vi.fn(async () => ({ roles: ["hr"], branchId: "br-own" })),
  buildProcessScopeCondition: vi.fn(() => ({ sql: "1=0", params: [] as unknown[] })),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope, buildProcessScopeCondition }));
vi.mock("../../../shared/scopeAccess.js", () => ({ getUserRoleKeys: vi.fn(async () => ["hr"]) }));

const { listTickets, listAgents } = vi.hoisted(() => ({
  listTickets: vi.fn(async () => []),
  listAgents: vi.fn(async () => []),
}));
vi.mock("../helpdesk.service.js", () => ({
  helpdeskService: { listTickets, listAgents },
  writeSensitiveAuditLog: vi.fn(),
  CATEGORY_OWNER_ROLES: { hr: ["hr"], general: ["admin"] },
}));

const sla = vi.hoisted(() => ({
  getHelpdeskSlaSummary: vi.fn(async () => ({ data: [] })),
  getOwnerWorkload: vi.fn(async () => ({ data: [] })),
  getRootCauses: vi.fn(async () => ({ data: [] })),
}));
vi.mock("../helpdesk-sla.service.js", () => ({
  ...sla,
  getSupportCommandCenter: vi.fn(), getHelpdeskDashboard: vi.fn(), getCategoryBreakdown: vi.fn(),
  getAgingBuckets: vi.fn(), getGrievanceDashboard: vi.fn(), getGrievanceCommandCenter: vi.fn(), getItDepthAnalysis: vi.fn(),
}));
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _r: any, next: any) => { req.authUser = { id: "u-hr" }; next(); } };
});
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

import { helpdeskRouter } from "../helpdesk.routes.js";

const app = () => { const a = express(); a.use(express.json()); a.use("/api/helpdesk", helpdeskRouter); return a; };

beforeEach(() => {
  vi.clearAllMocks();
  hasRoleForRequest.mockImplementation(async (_u, ...roles: string[]) => !(roles.length === 1 && ["admin", "super_admin"].includes(roles[0])));
  resolveUserBusinessScope.mockResolvedValue({ roles: ["hr"], branchId: "br-own" });
  buildProcessScopeCondition.mockReturnValue({ sql: "1=0", params: [] });
});

describe("helpdesk hr branch scoping", () => {
  it("tickets list: hr is limited to own branch (not 1=1) plus category restriction", async () => {
    await request(app()).get("/api/helpdesk/tickets?branch_id=other");
    const [, scope] = listTickets.mock.calls[0] as any;
    expect(scope.sql).toBe("(e.branch_id = ?) AND t.category IN (?)");
    expect(scope.params).toEqual(["br-own", "hr"]);
  });

  it("sla-summary / owner-workload / root-causes receive the branch scope", async () => {
    await request(app()).get("/api/helpdesk/sla-summary");
    await request(app()).get("/api/helpdesk/owner-workload");
    await request(app()).get("/api/helpdesk/root-causes");
    for (const fn of [sla.getHelpdeskSlaSummary, sla.getRootCauses]) {
      expect((fn.mock.calls[0] as any)[1]).toEqual({ sql: "e.branch_id = ?", params: ["br-own"] });
    }
    expect((sla.getOwnerWorkload.mock.calls[0] as any)[0]).toEqual({ sql: "e.branch_id = ?", params: ["br-own"] });
  });

  it("agents list receives the branch scope", async () => {
    await request(app()).get("/api/helpdesk/agents");
    expect((listAgents.mock.calls[0] as any)[1]).toEqual({ sql: "e.branch_id = ?", params: ["br-own"] });
  });

  it("admin stays unrestricted on aggregates and agents", async () => {
    hasRoleForRequest.mockResolvedValue(true);
    await request(app()).get("/api/helpdesk/sla-summary");
    await request(app()).get("/api/helpdesk/agents");
    expect((sla.getHelpdeskSlaSummary.mock.calls[0] as any)[1]).toEqual({ sql: "1=1", params: [] });
    expect((listAgents.mock.calls[0] as any)[1]).toEqual({ sql: "1=1", params: [] });
  });
});
