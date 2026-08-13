import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * roster-master.controller.ts previously enforced role only (requireRole in
 * roster-master.routes.ts), never scope: a wfm/process_manager user's employee_id or
 * process_id was trusted directly from the URL/body wherever supplied, letting them
 * approve week-off for, or generate a roster over, any process company-wide.
 *
 * Live-DB caveat (documented, not re-asserted here): roster_template/roster_assignment/
 * week_off_preference all held 0 rows in production at audit time — these routes were
 * reachable but never actually exercised. The fix closes the gap regardless.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { hasRole, hasProcessScope } = vi.hoisted(() => ({
  hasRole: vi.fn(),
  hasProcessScope: vi.fn(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole, hasProcessScope }));

const {
  approveWeekOffPreference,
  createTemplate,
  generateRoster,
} = vi.hoisted(() => ({
  approveWeekOffPreference: vi.fn().mockResolvedValue({ id: "pref-1", approved: 1 }),
  createTemplate: vi.fn().mockResolvedValue({ id: "tmpl-1" }),
  generateRoster: vi.fn().mockResolvedValue({ created: 1, skipped: 0, errors: [] }),
}));
vi.mock("../roster-master.service.js", () => ({
  rosterMasterService: { approveWeekOffPreference, createTemplate, generateRoster },
}));

import { rosterMasterController } from "../roster-master.controller.js";

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    authUser: { id: "caller-1" },
    params: {},
    body: {},
    query: {},
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("roster-master.controller scope enforcement", () => {
  beforeEach(() => {
    execute.mockReset();
    hasRole.mockReset();
    hasProcessScope.mockReset();
    approveWeekOffPreference.mockClear();
    createTemplate.mockClear();
    generateRoster.mockClear();
  });

  it("refuses to approve week-off for an employee outside the caller's process scope", async () => {
    hasRole.mockResolvedValue(false); // not admin/hr
    hasProcessScope.mockResolvedValue(false); // not scoped to this employee's process
    execute.mockResolvedValue([[{ process_id: "process-B", branch_id: null }], []]);

    const req = mockReq({ params: { employee_id: "emp-in-process-b" } });
    const res = mockRes();

    await expect(rosterMasterController.approveWeekOffPreference(req, res)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(approveWeekOffPreference).not.toHaveBeenCalled();
  });

  it("allows approval when the caller holds an explicit grant for the employee's process", async () => {
    hasRole.mockResolvedValue(false);
    hasProcessScope.mockResolvedValue(true);
    execute.mockResolvedValue([[{ process_id: "process-A", branch_id: null }], []]);

    const req = mockReq({ params: { employee_id: "emp-in-process-a" } });
    const res = mockRes();

    await rosterMasterController.approveWeekOffPreference(req, res);
    expect(approveWeekOffPreference).toHaveBeenCalledWith("emp-in-process-a", "caller-1");
  });

  it("allows approval unconditionally for admin/hr regardless of scope", async () => {
    hasRole.mockResolvedValue(true); // admin/hr bypass
    hasProcessScope.mockResolvedValue(false);
    execute.mockResolvedValue([[{ process_id: "process-anywhere", branch_id: null }], []]);

    const req = mockReq({ params: { employee_id: "emp-anywhere" } });
    const res = mockRes();

    await rosterMasterController.approveWeekOffPreference(req, res);
    expect(approveWeekOffPreference).toHaveBeenCalled();
  });

  it("refuses to generate a roster for a process outside the caller's scope", async () => {
    hasRole.mockResolvedValue(false);
    hasProcessScope.mockResolvedValue(false);

    const req = mockReq({ body: { process_id: "process-not-mine", template_id: "t1", start_date: "2026-08-17", end_date: "2026-08-23", employee_ids: ["e1"] } });
    const res = mockRes();

    await expect(rosterMasterController.generateRoster(req, res)).rejects.toMatchObject({ statusCode: 403 });
    expect(generateRoster).not.toHaveBeenCalled();
  });

  it("refuses to create a template for a process outside the caller's scope", async () => {
    hasRole.mockResolvedValue(false);
    hasProcessScope.mockResolvedValue(false);

    const req = mockReq({ body: { process_id: "process-not-mine", template_name: "x", pattern_type: "fixed", cycle_days: 7, pattern_json: {} } });
    const res = mockRes();

    await expect(rosterMasterController.createTemplate(req, res)).rejects.toMatchObject({ statusCode: 403 });
    expect(createTemplate).not.toHaveBeenCalled();
  });
});
