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
  listTickets.mockClear().mockResolvedValue([{ id: "t-1" }]);
  getTicket.mockClear().mockResolvedValue({ id: "t-1", employee_id: "emp-owner", comments: [] });
  updateTicket.mockClear().mockResolvedValue({ id: "t-1", updated: true });
  takeTicket.mockClear().mockResolvedValue({ id: "t-1", assigned_to: "u-it-1" });
  holdTicket.mockClear().mockResolvedValue({ id: "t-1", status: "on_hold" });
  addComment.mockClear().mockResolvedValue("comment-1");
  getSupportCommandCenter.mockClear().mockResolvedValue({ stats: { total_tickets: 0 } });
});

describe("GET /api/helpdesk/tickets — row scope for branch_it/it/it_admin", () => {
  it("admin/hr/super_admin still get 1=1 (unrestricted, unchanged)", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) =>
      roles.includes("admin") || roles.includes("hr") || roles.includes("super_admin")
        ? roles.some((r) => ["admin", "hr", "super_admin"].includes(r))
        : true // still passes the broader HELPDESK_ADMIN_ROLES check
    );
    await request(app()).get("/api/helpdesk/tickets");
    expect(listTickets).toHaveBeenCalledWith(expect.anything(), { sql: "1=1", params: [] });
    expect(resolveUserBusinessScope).not.toHaveBeenCalled();
  });

  it("branch_it gets a real scope condition passed to listTickets, not unrestricted access", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
      if (roles.includes("admin") && roles.length === 3) return false; // the org-wide-only check
      return true; // the broader HELPDESK_ADMIN_ROLES check
    });
    await request(app()).get("/api/helpdesk/tickets");
    expect(resolveUserBusinessScope).toHaveBeenCalled();
    expect(listTickets).toHaveBeenCalledWith(expect.anything(), { sql: "e.branch_id = ?", params: ["branch-1"] });
  });

  it("a scoped IT role with no user_assignment_scope row fails closed (1=0), matching every other under-provisioned manager-tier role in this codebase", async () => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
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
      if (roles.includes("admin") && roles.length === 3) return false;
      return true;
    });

    const res = await request(app()).get("/api/helpdesk/command-center");

    expect(res.status).toBe(200);
    expect(resolveUserBusinessScope).toHaveBeenCalled();
    expect(getSupportCommandCenter).toHaveBeenCalledWith(expect.anything(), { sql: "e.branch_id = ?", params: ["branch-1"] });
  });
});

describe("mutation routes — out-of-scope ticket is refused before any write", () => {
  beforeEach(() => {
    hasRoleForRequest.mockImplementation(async (_user, ...roles: string[]) => {
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
