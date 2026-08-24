import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HRMS2 delta-audit, 2026-08-14 (P1, reports/dashboards cluster): the
 * it/branch_it/it_admin role family was bundled into HELPDESK_ADMIN_ROLES and
 * treated identically to admin/hr/super_admin — full company-wide ticket
 * visibility with no row scope, contradicting role.catalog.ts's own module
 * registry and the same anti-pattern the same-HEAD IJP fix (22bf769a) closed
 * for job postings. This pins the real fix: admin/hr/super_admin stay
 * org-wide; it/branch_it/it_admin now resolve through the same
 * resolveUserBusinessScope + buildProcessScopeCondition mechanism the rest of
 * this codebase already uses for its manager-tier roles, including the
 * fail-closed behavior for a role with no user_assignment_scope row.
 */

const { hasRoleForRequest, getEmployeeForUser } = vi.hoisted(() => ({
  hasRoleForRequest: vi.fn(async () => false),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-caller-1" })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRoleForRequest, getEmployeeForUser }));

const { resolveUserBusinessScope, buildProcessScopeCondition } = vi.hoisted(() => ({
  resolveUserBusinessScope: vi.fn(async () => ({ isSuperAdmin: false, isAdmin: false, isHr: false, roles: ["branch_it"] })),
  buildProcessScopeCondition: vi.fn(() => ({ sql: "e.branch_id = ?", params: ["branch-1"] })),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope, buildProcessScopeCondition }));

// 2026-08-24: resolveHelpdeskTicketScope now also reads the caller's real held roles (not
// hasRoleForRequest, which has "admin/super_admin passes any role check" baked in elsewhere on
// purpose — that would silently defeat a category check keyed off role membership) to compute
// which ticket categories the caller's role(s) own. Defaults to branch_it here, matching the
// `actor` identity below; individual tests override per case.
const { getUserRoleKeys } = vi.hoisted(() => ({
  getUserRoleKeys: vi.fn(async () => ["branch_it"]),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({ getUserRoleKeys }));

const { listTickets, getTicket, updateTicket, reopenTicket, takeTicket, holdTicket, addComment } = vi.hoisted(() => ({
  listTickets: vi.fn(async () => [{ id: "t-1" }]),
  getTicket: vi.fn(async () => ({ id: "t-1", employee_id: "emp-owner", comments: [] })),
  updateTicket: vi.fn(async () => ({ id: "t-1", updated: true })),
  reopenTicket: vi.fn(async () => ({ id: "t-1", status: "reopened" })),
  takeTicket: vi.fn(async () => ({ id: "t-1", assigned_to: "u-it-1" })),
  holdTicket: vi.fn(async () => ({ id: "t-1", status: "on_hold" })),
  addComment: vi.fn(async () => "comment-1"),
}));
vi.mock("../helpdesk.service.js", () => ({
  helpdeskService: { listTickets, getTicket, updateTicket, reopenTicket, takeTicket, holdTicket, addComment, rateTicket: vi.fn() },
  writeSensitiveAuditLog: vi.fn(async () => undefined),
  // Real mapping, not a stub — this IS the thing under test in the category-RBAC describe
  // block below, and routes.ts derives ROLE_OWNED_CATEGORIES from it at module load.
  CATEGORY_OWNER_ROLES: {
    it: ["it", "branch_it", "it_admin"],
    hr: ["hr"], leave: ["hr"], payroll: ["hr"],
    attendance: ["admin"], admin: ["admin"], asset: ["admin"], general: ["admin"], other: ["admin"],
  },
}));

const { getSupportCommandCenter } = vi.hoisted(() => ({
  getSupportCommandCenter: vi.fn(async () => ({ stats: { total_tickets: 0 } })),
}));
vi.mock("../helpdesk-sla.service.js", () => ({
  getSupportCommandCenter,
  getHelpdeskDashboard: vi.fn(async () => ({ stats: {} })),
  getHelpdeskSlaSummary: vi.fn(async () => ({ data: [] })),
  getCategoryBreakdown: vi.fn(async () => ({ data: [] })),
  getOwnerWorkload: vi.fn(async () => ({ data: [] })),
  getAgingBuckets: vi.fn(async () => ({ data: {} })),
  getRootCauses: vi.fn(async () => ({ data: [] })),
  getGrievanceDashboard: vi.fn(async () => ({ stats: {} })),
  getGrievanceCommandCenter: vi.fn(async () => ({ stats: {}, cases: [] })),
  getItDepthAnalysis: vi.fn(async () => ({ summary: {} })),
}));

const actor = { id: "u-it-1", role: "branch_it" };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { helpdeskRouter } from "../helpdesk.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/helpdesk", helpdeskRouter);
  return a;
}

beforeEach(() => {
  hasRoleForRequest.mockClear().mockResolvedValue(false);
  getEmployeeForUser.mockClear().mockResolvedValue({ id: "emp-caller-1" });
  resolveUserBusinessScope.mockClear().mockResolvedValue({ isSuperAdmin: false, isAdmin: false, isHr: false, roles: ["branch_it"] });
  buildProcessScopeCondition.mockClear().mockReturnValue({ sql: "e.branch_id = ?", params: ["branch-1"] });
  getUserRoleKeys.mockClear().mockResolvedValue(["branch_it"]);
  listTickets.mockClear().mockResolvedValue([{ id: "t-1" }]);
  getTicket.mockClear().mockResolvedValue({ id: "t-1", employee_id: "emp-owner", comments: [] });
  updateTicket.mockClear().mockResolvedValue({ id: "t-1", updated: true });
  takeTicket.mockClear().mockResolvedValue({ id: "t-1", assigned_to: "u-it-1" });
  holdTicket.mockClear().mockResolvedValue({ id: "t-1", status: "on_hold" });
  addComment.mockClear().mockResolvedValue("comment-1");
  getSupportCommandCenter.mockClear().mockResolvedValue({ stats: { total_tickets: 0 } });
});

describe("GET /api/helpdesk/tickets — row scope for branch_it/it/it_admin", () => {
  it("super_admin still gets 1=1 (fully unrestricted, unchanged)", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => roles.includes("super_admin"));
    await request(app()).get("/api/helpdesk/tickets");
    expect(listTickets).toHaveBeenCalledWith(expect.anything(), { sql: "1=1", params: [] });
    expect(resolveUserBusinessScope).not.toHaveBeenCalled();
    expect(getUserRoleKeys).not.toHaveBeenCalled();
  });

  it("2026-08-24: admin no longer gets 1=1 — now restricted to the categories its role owns", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.length === 1 && roles[0] === "super_admin") return false; // not super_admin
      return true; // passes both the 6-role HELPDESK_ADMIN_ROLES check and the 3-role org-wide check
    });
    getUserRoleKeys.mockResolvedValue(["admin"]);
    await request(app()).get("/api/helpdesk/tickets");
    const [, scope] = listTickets.mock.calls[0];
    expect(scope.sql).toBe("t.category IN (?,?,?,?,?)");
    expect(scope.params.sort()).toEqual(["admin", "asset", "attendance", "general", "other"].sort());
  });

  it("branch_it gets a real scope condition AND a category restriction, not unrestricted access", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.length === 1 && roles[0] === "super_admin") return false;
      if (roles.includes("admin") && roles.length === 3) return false; // the org-wide-only check
      return true; // the broader HELPDESK_ADMIN_ROLES check
    });
    await request(app()).get("/api/helpdesk/tickets");
    expect(resolveUserBusinessScope).toHaveBeenCalled();
    expect(listTickets).toHaveBeenCalledWith(expect.anything(), {
      sql: "(e.branch_id = ?) AND t.category IN (?)",
      params: ["branch-1", "it"],
    });
  });

  it("a caller holding both hr and admin sees the union of both roles' owned categories", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.length === 1 && roles[0] === "super_admin") return false;
      return true;
    });
    getUserRoleKeys.mockResolvedValue(["hr", "admin"]);
    await request(app()).get("/api/helpdesk/tickets");
    const [, scope] = listTickets.mock.calls[0];
    expect(scope.params.sort()).toEqual(
      ["hr", "leave", "payroll", "admin", "asset", "attendance", "general", "other"].sort(),
    );
  });

  it("a scoped IT role with no user_assignment_scope row fails closed (1=0), matching every other under-provisioned manager-tier role in this codebase", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.length === 1 && roles[0] === "super_admin") return false;
      if (roles.includes("admin") && roles.length === 3) return false;
      return true;
    });
    buildProcessScopeCondition.mockReturnValue({ sql: "1=0", params: [] });
    await request(app()).get("/api/helpdesk/tickets");
    expect(listTickets).toHaveBeenCalledWith(expect.anything(), { sql: "1=0", params: [] });
  });
});

describe("support command-center aggregates — same row scope as ticket lists", () => {
  it("passes the resolved branch/process scope into KPI aggregation for scoped support roles", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.length === 1 && roles[0] === "super_admin") return false;
      if (roles.includes("admin") && roles.length === 3) return false;
      return true;
    });

    const res = await request(app()).get("/api/helpdesk/command-center");

    expect(res.status).toBe(200);
    expect(resolveUserBusinessScope).toHaveBeenCalled();
    expect(getSupportCommandCenter).toHaveBeenCalledWith(expect.anything(), {
      sql: "(e.branch_id = ?) AND t.category IN (?)",
      params: ["branch-1", "it"],
    });
  });
});

describe("mutation routes — out-of-scope ticket is refused before any write", () => {
  beforeEach(() => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.length === 1 && roles[0] === "super_admin") return false;
      if (roles.includes("admin") && roles.length === 3) return false; // scoped IT, not org-wide
      return true;
    });
  });

  it("PATCH /tickets/:id 404s and never calls updateTicket when the scoped fetch returns null", async () => {
    getTicket.mockResolvedValueOnce(null); // out of scope
    const res = await request(app()).patch("/api/helpdesk/tickets/t-1").send({ status: "in_progress" });
    expect(res.status).toBe(404);
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it("POST /tickets/:id/assign 404s and never calls updateTicket for an out-of-scope ticket", async () => {
    getTicket.mockResolvedValueOnce(null);
    const res = await request(app()).post("/api/helpdesk/tickets/t-1/assign").send({ assigned_to: "u-2" });
    expect(res.status).toBe(404);
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it("PATCH /tickets/:id proceeds when the ticket is in scope", async () => {
    const res = await request(app()).patch("/api/helpdesk/tickets/t-1").send({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(updateTicket).toHaveBeenCalled();
  });

  it("POST /tickets/:id/take 404s and never calls takeTicket when the scoped fetch returns null", async () => {
    getTicket.mockImplementation(async (_id: string, scope?: { sql: string; params: unknown[] }) =>
      scope ? null : ({ id: "t-1", employee_id: "emp-owner", comments: [] })
    );
    const res = await request(app()).post("/api/helpdesk/tickets/t-1/take").send({});
    expect(res.status).toBe(404);
    expect(takeTicket).not.toHaveBeenCalled();
  });

  it("POST /tickets/:id/hold 404s and never calls holdTicket when the scoped fetch returns null", async () => {
    getTicket.mockResolvedValueOnce(null);
    const res = await request(app()).post("/api/helpdesk/tickets/t-1/hold").send({ reason: "Waiting for vendor" });
    expect(res.status).toBe(404);
    expect(holdTicket).not.toHaveBeenCalled();
  });

  it("POST /tickets/:id/comments 404s and never adds an internal comment outside the scoped ticket", async () => {
    getTicket.mockImplementation(async (_id: string, scope?: { sql: string; params: unknown[] }) =>
      scope ? null : ({ id: "t-1", employee_id: "emp-owner", comments: [] })
    );
    const res = await request(app())
      .post("/api/helpdesk/tickets/t-1/comments")
      .send({ text: "Internal diagnosis", is_internal: true });
    expect(res.status).toBe(404);
    expect(addComment).not.toHaveBeenCalled();
  });
});
