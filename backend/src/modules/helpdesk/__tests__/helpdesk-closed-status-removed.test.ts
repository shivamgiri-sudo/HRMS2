import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 'closed' removed as a live ticket status (2026-08-24). Confirmed live before this change:
 * helpdesk_ticket had exactly 4 rows total (open/in_progress/pending_info/resolved, one each),
 * zero ever in 'closed' - and no route ever set it. Grievances are a separate table/workflow
 * with their own real resolve-then-close model and are untouched by this.
 */

const { hasRoleForRequest, getEmployeeForUser } = vi.hoisted(() => ({
  hasRoleForRequest: vi.fn(async () => true),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-caller-1" })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRoleForRequest, getEmployeeForUser }));

vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: vi.fn(async () => ({ isSuperAdmin: true })),
  buildProcessScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] })),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({ getUserRoleKeys: vi.fn(async () => ["super_admin"]) }));

const { updateTicket, getTicket } = vi.hoisted(() => ({
  updateTicket: vi.fn(async () => ({ id: "t-1", updated: true })),
  getTicket: vi.fn(async () => ({ id: "t-1", employee_id: "emp-owner", comments: [] })),
}));
vi.mock("../helpdesk.service.js", () => ({
  helpdeskService: { updateTicket, getTicket, listTickets: vi.fn(), createTicket: vi.fn(), addComment: vi.fn(), takeTicket: vi.fn(), holdTicket: vi.fn(), reopenTicket: vi.fn(), rateTicket: vi.fn() },
  writeSensitiveAuditLog: vi.fn(async () => undefined),
  CATEGORY_OWNER_ROLES: { it: ["it"], hr: ["hr"], leave: ["hr"], payroll: ["hr"], attendance: ["admin"], admin: ["admin"], asset: ["admin"], general: ["admin"], other: ["admin"] },
}));

vi.mock("../helpdesk-sla.service.js", () => ({
  getHelpdeskDashboard: vi.fn(), getHelpdeskSlaSummary: vi.fn(), getCategoryBreakdown: vi.fn(),
  getOwnerWorkload: vi.fn(), getAgingBuckets: vi.fn(), getRootCauses: vi.fn(),
  getGrievanceDashboard: vi.fn(), getGrievanceCommandCenter: vi.fn(),
  getSupportCommandCenter: vi.fn(), getItDepthAnalysis: vi.fn(),
}));

const actor = { id: "u-admin", role: "super_admin" };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));

import { helpdeskRouter } from "../helpdesk.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/helpdesk", helpdeskRouter);
  return a;
}

beforeEach(() => {
  updateTicket.mockClear().mockResolvedValue({ id: "t-1", updated: true });
  getTicket.mockClear().mockResolvedValue({ id: "t-1", employee_id: "emp-owner", comments: [] });
});

describe("PATCH /tickets/:id — 'closed' is rejected outright", () => {
  it("400s and never calls updateTicket when status is 'closed'", async () => {
    const res = await request(app()).patch("/api/helpdesk/tickets/t-1").send({ status: "closed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/resolved/i);
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it("still works normally for a real status like 'in_progress'", async () => {
    const res = await request(app()).patch("/api/helpdesk/tickets/t-1").send({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(updateTicket).toHaveBeenCalledWith("t-1", { status: "in_progress" });
  });

  it("still works normally for 'resolved' via the generic PATCH path", async () => {
    const res = await request(app()).patch("/api/helpdesk/tickets/t-1").send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect(updateTicket).toHaveBeenCalledWith("t-1", { status: "resolved" });
  });
});
