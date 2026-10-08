import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /requests/:id: admin / hr passed the role gate and could open ANY feedback request. Owner ruling 2026-10-01:
 * admin is branch-scoped like hr - the subject employee must be inside the caller's scope (org-wide roles pass),
 * unless the caller is the request's reviewer.
 */
const h = vi.hoisted(() => ({
  hasRole: vi.fn(), getEmployeeForUser: vi.fn(), canAccessEmployeeRecord: vi.fn(), getRequestById: vi.fn(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: h.hasRole, getEmployeeForUser: h.getEmployeeForUser }));
vi.mock("../../dashboards/branch-scope-guards.js", () => ({
  canAccessEmployeeRecord: h.canAccessEmployeeRecord,
  employeeIdInScope: vi.fn(async () => null),
  employeeListScope: vi.fn(async () => null),
  OUTSIDE_SCOPE_MESSAGE: "outside",
}));
vi.mock("../performance-feedback.service.js", () => ({
  PerformanceFeedbackService: class { getRequestById = h.getRequestById; },
}));

import { performanceFeedbackController } from "../performance-feedback.controller.js";

function call() {
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  return performanceFeedbackController.getRequestById({ params: { id: "r1" }, authUser: { id: "u1" } } as any, res).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getEmployeeForUser.mockResolvedValue({ id: "emp-me" });
  h.getRequestById.mockResolvedValue({ id: "r1", employee_id: "emp-b", reviewer_id: "emp-x" });
});

describe("getRequestById", () => {
  it("admin / hr inside the subject's scope may open it", async () => {
    h.hasRole.mockResolvedValue(true); h.canAccessEmployeeRecord.mockResolvedValue(true);
    expect((await call()).statusCode).toBe(200);
  });
  it("admin / hr is refused for a subject outside their branch", async () => {
    h.hasRole.mockResolvedValue(true); h.canAccessEmployeeRecord.mockResolvedValue(false);
    const res = await call();
    expect(res.statusCode).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
  it("...unless they are the reviewer on the request", async () => {
    h.hasRole.mockResolvedValue(true); h.canAccessEmployeeRecord.mockResolvedValue(false);
    h.getRequestById.mockResolvedValue({ id: "r1", employee_id: "emp-b", reviewer_id: "emp-me" });
    expect((await call()).statusCode).toBe(200);
  });
  it("a non-privileged caller is unchanged: reviewer or subject only", async () => {
    h.hasRole.mockResolvedValue(false);
    expect((await call()).statusCode).toBe(403);
    h.getRequestById.mockResolvedValue({ id: "r1", employee_id: "emp-me", reviewer_id: "emp-x" });
    expect((await call()).statusCode).toBe(200);
    expect(h.canAccessEmployeeRecord).not.toHaveBeenCalled();
  });
});
