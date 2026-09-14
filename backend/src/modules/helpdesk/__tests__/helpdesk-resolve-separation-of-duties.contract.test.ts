import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Separation of duties on POST /api/helpdesk/tickets/:id/resolve (2026-08-24, migration 1558).
 *
 * WHAT WAS WRONG
 * helpdesk had no occurrence of "maker" or "checker" anywhere in the module, while every other
 * governed module here (GRN, imprest, budget review, cost centre, payroll sign-off) enforces
 * maker != checker and has a contract test for it. One holder of one HELPDESK_ADMIN_ROLES role
 * could POST /tickets on behalf of any employee, POST /tickets/:id/take to self-assign, and
 * POST /tickets/:id/resolve — three endpoints, one pair of eyes. Worse, helpdesk_ticket had no
 * created_by column at all, so the acting user survived only inside sensitive_action_log's
 * change_summary JSON, which writeSensitiveActionLog is explicitly allowed to drop on failure.
 * Nothing on the row could afterwards show that the same person did all three.
 *
 * /resolve also never checked assignment, which is how the live TKT-004 reached status='resolved'
 * with assigned_to NULL, resolved_at NULL and no resolution note.
 *
 * WHAT THIS PINS
 *  1. the raiser cannot resolve their own ticket (the actual maker-checker rule);
 *  2. a ticket with no assignee cannot be resolved at all;
 *  3. a non-assignee without admin/super_admin cannot resolve someone else's ticket;
 *  4. an admin CAN still close on an agent's behalf — deliberately allowed, see the route's own
 *     comment: refusing it would strand tickets whose assignee has gone home;
 *  5. a NULL raiser (the 4 rows predating migration 1558) is NOT treated as a violation;
 *  6. raised_by_user_id comes from the ACTING user, never from req.body — otherwise the maker
 *     could name themselves someone else and walk straight through rule 1.
 */

const { hasRoleForRequest, getEmployeeForUser } = vi.hoisted(() => ({
  hasRoleForRequest: vi.fn(async () => false),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-caller-1" })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRoleForRequest, getEmployeeForUser }));

const { resolveUserBusinessScope, buildProcessScopeCondition } = vi.hoisted(() => ({
  resolveUserBusinessScope: vi.fn(async () => ({ isSuperAdmin: false, isAdmin: false, isHr: false, roles: ["it"] })),
  buildProcessScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] })),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope, buildProcessScopeCondition }));

const { getUserRoleKeys } = vi.hoisted(() => ({ getUserRoleKeys: vi.fn(async () => ["it"]) }));
vi.mock("../../../shared/scopeAccess.js", () => ({ getUserRoleKeys }));

const { getTicket, updateTicket, createTicket } = vi.hoisted(() => ({
  getTicket: vi.fn(async () => ({ id: "t-1", employee_id: "emp-owner", comments: [] })),
  updateTicket: vi.fn(async () => ({ id: "t-1", status: "resolved" })),
  createTicket: vi.fn(async () => ({ id: "t-new" })),
}));
vi.mock("../helpdesk.service.js", () => ({
  helpdeskService: {
    getTicket, updateTicket, createTicket,
    listTickets: vi.fn(async () => []),
    reopenTicket: vi.fn(), takeTicket: vi.fn(), holdTicket: vi.fn(),
    addComment: vi.fn(), rateTicket: vi.fn(), listAgents: vi.fn(async () => []),
  },
  writeSensitiveAuditLog: vi.fn(async () => undefined),
  CATEGORY_OWNER_ROLES: {
    it: ["it", "branch_it", "it_admin"],
    hr: ["hr"], leave: ["hr"], payroll: ["hr"],
    attendance: ["admin"], admin: ["admin"], asset: ["admin"], general: ["admin"], other: ["admin"],
  },
}));

vi.mock("../helpdesk-sla.service.js", () => ({
  getSupportCommandCenter: vi.fn(async () => ({ stats: {} })),
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

vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn(async () => undefined) } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));

const AGENT = "u-agent-1";
const actor = { id: AGENT, role: "it" };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
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

/** Every /resolve test posts a valid body — the guard under test must be what refuses, not validation. */
const BODY = { resolution_note: "replaced the headset", root_cause: "hardware" };

beforeEach(() => {
  hasRoleForRequest.mockClear().mockResolvedValue(false);
  getEmployeeForUser.mockClear().mockResolvedValue({ id: "emp-caller-1" });
  getUserRoleKeys.mockClear().mockResolvedValue(["it"]);
  resolveUserBusinessScope.mockClear().mockResolvedValue({ isSuperAdmin: true, isAdmin: false, isHr: false, roles: ["it"] });
  buildProcessScopeCondition.mockClear().mockReturnValue({ sql: "1=1", params: [] });
  updateTicket.mockClear().mockResolvedValue({ id: "t-1", status: "resolved" });
  createTicket.mockClear().mockResolvedValue({ id: "t-new" });
});

describe("POST /tickets/:id/resolve — maker cannot be the checker", () => {
  it("refuses when the resolver is the person who raised the ticket", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: AGENT, assigned_to: AGENT });

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/raised this ticket/i);
    // The refusal must happen BEFORE any write — a 409 that still resolved the ticket is worthless.
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it("allows a different agent to resolve a ticket assigned to them", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: "u-someone-else", assigned_to: AGENT });

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(200);
    expect(updateTicket).toHaveBeenCalledWith("t-1", expect.objectContaining({
      status: "resolved",
      resolved_by_user_id: AGENT,
    }));
  });

  it("does not refuse a legacy ticket whose raiser was never recorded (raised_by_user_id NULL)", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: null, assigned_to: AGENT });

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(200);
    expect(updateTicket).toHaveBeenCalled();
  });
});

describe("POST /tickets/:id/resolve — a ticket is resolved by its owner", () => {
  it("refuses to resolve a ticket that has no assignee at all", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: "u-someone-else", assigned_to: null });

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no assignee/i);
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it("refuses a non-assignee who is not admin or super_admin", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: "u-someone-else", assigned_to: "u-other-agent" });
    hasRoleForRequest.mockResolvedValue(false);

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(403);
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it("still lets an admin close on the assignee's behalf, and records who actually did it", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: "u-someone-else", assigned_to: "u-other-agent" });
    hasRoleForRequest.mockImplementation(async (_u: any, ...roles: string[]) => roles.includes("admin"));

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(200);
    expect(updateTicket).toHaveBeenCalledWith("t-1", expect.objectContaining({ resolved_by_user_id: AGENT }));
  });

  it("an admin who raised the ticket is still refused — elevation does not buy past rule 1", async () => {
    getTicket.mockResolvedValue({ id: "t-1", employee_id: "emp-owner", raised_by_user_id: AGENT, assigned_to: "u-other-agent" });
    hasRoleForRequest.mockImplementation(async (_u: any, ...roles: string[]) => roles.includes("admin"));

    const res = await request(app()).post("/api/helpdesk/tickets/t-1/resolve").send(BODY);

    expect(res.status).toBe(409);
    expect(updateTicket).not.toHaveBeenCalled();
  });
});

describe("POST /tickets — the maker is the acting user, not whatever the body claims", () => {
  it("records raised_by_user_id from req.authUser even when the body says otherwise", async () => {
    hasRoleForRequest.mockResolvedValue(true); // admin path: creating on behalf of an employee

    await request(app()).post("/api/helpdesk/tickets").send({
      employee_id: "emp-subject",
      category: "it",
      subject: "laptop dead",
      description: "will not boot",
      raised_by_user_id: "u-somebody-i-am-not", // hostile body field
    });

    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: "emp-subject",
      raised_by_user_id: AGENT,
    }));
  });
});
