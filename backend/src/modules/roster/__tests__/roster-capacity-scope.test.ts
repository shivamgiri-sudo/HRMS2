import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * roster-capacity.routes.ts's /preference/submit carried no role requirement at all —
 * just requireAuth — and trusted employee_id/process_id straight from the body: any
 * authenticated user, including a plain employee, could submit (and, depending on
 * capacity, get auto-approved) a week-off preference impersonating any other employee
 * in any process. Fixed by self-locking to the caller's own mapped employee record.
 *
 * config/:processId/:dayOfWeek and /allocate were role-gated (wfm/admin) but never
 * scope-checked — a wfm user in one process could edit capacity config or allocate a
 * week-off slot in a process they don't own.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { hasRole, hasProcessScope, getEmployeeForUser } = vi.hoisted(() => ({
  hasRole: vi.fn(),
  hasProcessScope: vi.fn(),
  getEmployeeForUser: vi.fn(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole, hasProcessScope, getEmployeeForUser }));

const { updateCapacityConfig, allocateWeekOff, submitWeekOffPreference, getNotifications, markNotificationRead } = vi.hoisted(() => ({
  updateCapacityConfig: vi.fn().mockResolvedValue({ id: "cfg-1" }),
  allocateWeekOff: vi.fn().mockResolvedValue({ id: "alloc-1" }),
  submitWeekOffPreference: vi.fn().mockResolvedValue({ preference_id: "pref-1", auto_approved: false, notification: "" }),
  getNotifications: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../roster-capacity.service.js", () => ({
  rosterCapacityService: { updateCapacityConfig, allocateWeekOff, submitWeekOffPreference, getNotifications, markNotificationRead },
}));

import { rosterCapacityController } from "../roster-capacity.controller.js";

function mockReq(overrides: Record<string, unknown> = {}) {
  return { authUser: { id: "caller-1" }, params: {}, body: {}, query: {}, ...overrides } as any;
}
function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("roster-capacity.controller scope enforcement", () => {
  beforeEach(() => {
    execute.mockReset();
    hasRole.mockReset();
    hasProcessScope.mockReset();
    getEmployeeForUser.mockReset();
    updateCapacityConfig.mockClear();
    allocateWeekOff.mockClear();
    submitWeekOffPreference.mockClear();
    getNotifications.mockClear();
    markNotificationRead.mockClear();
  });

  it("self-locks preference submission to the caller's own employee id and process, ignoring any body-supplied values", async () => {
    getEmployeeForUser.mockResolvedValue({ id: "self-emp-1", employee_code: "MAS001" });
    execute.mockResolvedValue([[{ process_id: "self-process" }], []]);

    const req = mockReq({
      body: { employee_id: "someone-elses-id", process_id: "someone-elses-process", preferred_day: 0, alternate_day: null },
    });
    const res = mockRes();

    await rosterCapacityController.submitWeekOffPreference(req, res);

    expect(submitWeekOffPreference).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "self-emp-1", process_id: "self-process" }),
    );
    // Never the impersonated ids the body tried to supply.
    const call = submitWeekOffPreference.mock.calls[0][0];
    expect(call.employee_id).not.toBe("someone-elses-id");
    expect(call.process_id).not.toBe("someone-elses-process");
  });

  it("rejects preference submission when the caller has no mapped employee record", async () => {
    getEmployeeForUser.mockResolvedValue(null);
    const req = mockReq({ body: { preferred_day: 0 } });
    const res = mockRes();

    await rosterCapacityController.submitWeekOffPreference(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(submitWeekOffPreference).not.toHaveBeenCalled();
  });

  it("refuses to update capacity config for a process outside the caller's scope", async () => {
    hasRole.mockResolvedValue(false);
    hasProcessScope.mockResolvedValue(false);

    const req = mockReq({ params: { processId: "not-mine", dayOfWeek: "1" }, body: { max_weekoff_count: 5 } });
    const res = mockRes();

    await rosterCapacityController.updateCapacityConfig(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(updateCapacityConfig).not.toHaveBeenCalled();
  });

  it("allows capacity config update when the caller holds scope over the process", async () => {
    hasRole.mockResolvedValue(false);
    hasProcessScope.mockResolvedValue(true);

    const req = mockReq({ params: { processId: "mine", dayOfWeek: "1" }, body: { max_weekoff_count: 5 } });
    const res = mockRes();

    await rosterCapacityController.updateCapacityConfig(req, res);
    expect(updateCapacityConfig).toHaveBeenCalled();
  });

  it("refuses to allocate a week-off slot for a process outside the caller's scope", async () => {
    hasRole.mockResolvedValue(false);
    hasProcessScope.mockResolvedValue(false);

    const req = mockReq({ body: { process_id: "not-mine", day_of_week: 1, allocation_date: "2026-08-17", employee_id: "e1", preference_id: null } });
    const res = mockRes();

    await rosterCapacityController.allocateWeekOff(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(allocateWeekOff).not.toHaveBeenCalled();
  });

  it("refuses to read another employee's notification history (no auth check existed at all before this fix)", async () => {
    hasRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: "self-emp-1", employee_code: "MAS001" });

    const req = mockReq({ params: { employeeId: "someone-elses-employee-id" } });
    const res = mockRes();

    await rosterCapacityController.getNotifications(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getNotifications).not.toHaveBeenCalled();
  });

  it("allows reading the caller's own notification history", async () => {
    hasRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: "self-emp-1", employee_code: "MAS001" });

    const req = mockReq({ params: { employeeId: "self-emp-1" } });
    const res = mockRes();

    await rosterCapacityController.getNotifications(req, res);
    expect(getNotifications).toHaveBeenCalledWith("self-emp-1", false);
  });

  it("allows admin/hr/wfm to read any employee's notification history", async () => {
    hasRole.mockResolvedValue(true);

    const req = mockReq({ params: { employeeId: "any-employee-id" } });
    const res = mockRes();

    await rosterCapacityController.getNotifications(req, res);
    expect(getNotifications).toHaveBeenCalled();
  });

  it("refuses to mark another employee's notification read", async () => {
    hasRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: "self-emp-1", employee_code: "MAS001" });
    execute.mockResolvedValue([[{ employee_id: "someone-elses-employee-id" }], []]);

    const req = mockReq({ params: { notificationId: "notif-1" } });
    const res = mockRes();

    await rosterCapacityController.markNotificationRead(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it("allows marking the caller's own notification read", async () => {
    hasRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: "self-emp-1", employee_code: "MAS001" });
    execute.mockResolvedValue([[{ employee_id: "self-emp-1" }], []]);

    const req = mockReq({ params: { notificationId: "notif-1" } });
    const res = mockRes();

    await rosterCapacityController.markNotificationRead(req, res);
    expect(markNotificationRead).toHaveBeenCalledWith("notif-1");
  });
});
