import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  execute: vi.fn(),
  notify: vi.fn(),
  validateMinimumRest: vi.fn(),
  isRestPolicyFeatureActive: vi.fn(),
  logRestOverride: vi.fn(),
  checkAssignmentDateNotLocked: vi.fn(),
  checkEmployeeDateNotLocked: vi.fn(),
  logSensitiveAction: vi.fn(),
  syncCycleToRta: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute } }));
vi.mock("../../roster-requests/roster-requests.notify.js", () => ({ notifyRosterRequest: m.notify }));
vi.mock("../../wfm/rest-policy.service.js", () => ({
  validateMinimumRest: m.validateMinimumRest,
  isRestPolicyFeatureActive: m.isRestPolicyFeatureActive,
  logRestOverride: m.logRestOverride,
}));
vi.mock("../roster-lock-guard.js", () => ({
  checkAssignmentDateNotLocked: m.checkAssignmentDateNotLocked,
  checkEmployeeDateNotLocked: m.checkEmployeeDateNotLocked,
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: m.logSensitiveAction }));
vi.mock("../rta-sync.service.js", () => ({ rtaSyncService: { syncCycleToRta: m.syncCycleToRta } }));

import { resolveDispute } from "../dispute-resolution.service.js";

const { execute, notify } = m;
const row = { id: "rda-1", employee_id: "e1", roster_date: "2026-10-05", cycle_id: "c1", shift_template_id: "t-old", process_id: "p1", branch_id: "b1", cycle_status: "published" };
const allow = async () => true;
let liveRow: Record<string, unknown> | null;
let cycleRow: Record<string, unknown>;

const writes = () => execute.mock.calls.filter(([sql]) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql));
const rdaUpdate = () => execute.mock.calls.find(([sql]) => /UPDATE roster_daily_assignment/.test(sql));
const wraUpdate = () => execute.mock.calls.find(([sql]) => /UPDATE wfm_roster_assignment/.test(sql));

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  liveRow = { id: "wra-1", is_week_off: 0 };
  cycleRow = row;
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/FROM employees WHERE user_id/.test(sql)) return [params?.[0] === "u1" ? [{ id: "emp-u1" }] : [], []];
    if (/SELECT rda\.\*/.test(sql)) return [[cycleRow], []];
    if (/FROM wfm_shift_template/.test(sql)) return [[{ id: "t-new", start_time: "14:00:00", end_time: "23:00:00" }], []];
    if (/SELECT[\s\S]*FROM wfm_roster_assignment/.test(sql)) return [liveRow ? [liveRow] : [], []];
    return [{ affectedRows: 1 }, []];
  });
  m.isRestPolicyFeatureActive.mockResolvedValue(true);
  m.validateMinimumRest.mockResolvedValue({ ok: true, requiredRestMinutes: 660 });
  m.checkAssignmentDateNotLocked.mockResolvedValue({ blocked: false });
  m.checkEmployeeDateNotLocked.mockResolvedValue({ blocked: false });
  m.syncCycleToRta.mockResolvedValue({ records_synced: 1 });
});

describe("resolveDispute", () => {
  it("400s with the handler's body when the resolution is blank", async () => {
    await expect(resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "  ", canOwn: allow }))
      .rejects.toMatchObject({ statusCode: 400, body: { error: "dispute_resolution is required" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("404s for an unknown assignment", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveDispute({ assignmentId: "x", userId: "u1", resolution: "ok", canOwn: allow }))
      .rejects.toMatchObject({ statusCode: 404, body: { error: "Assignment not found" } });
  });

  it("403s when the caller does not own the roster", async () => {
    await expect(resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "ok", canOwn: async () => false }))
      .rejects.toMatchObject({ statusCode: 403, body: { success: false, message: "Forbidden: roster ownership required to resolve disputes" } });
  });

  it("409s on a locked cycle before writing", async () => {
    execute.mockResolvedValueOnce([[{ ...row, cycle_status: "attendance_locked" }], []]);
    await expect(resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "ok", canOwn: allow }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applies the new shift, notifies the employee and returns before/after", async () => {
    const r = await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: " moved ", newShiftTemplateId: "t-new", canOwn: allow });
    const [sql, params] = rdaUpdate()!;
    expect(sql).toMatch(/shift_template_id = \?/);
    expect(params).toEqual(["emp-u1", "moved", "t-new", "rda-1"]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ["e1"], kind: "dispute", sourceId: "rda-1" }));
    expect(r).toMatchObject({ previousShiftTemplateId: "t-old", shiftTemplateId: "t-new", resolution: "moved" });
  });

  it("writes the resolver's EMPLOYEE id (FK to employees), not the user id", async () => {
    await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "keep", canOwn: allow });
    const [, params] = rdaUpdate()!;
    expect(params[0]).toBe("emp-u1");
    expect(params[0]).not.toBe("u1");
  });

  it("writes NULL when the resolver has no employee record", async () => {
    await resolveDispute({ assignmentId: "rda-1", userId: "u-noemp", resolution: "keep", canOwn: allow });
    const [, params] = rdaUpdate()!;
    expect(params[0]).toBeNull();
  });

  it("keeps the original shift when no new shift is given", async () => {
    await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "keep", canOwn: allow });
    const [sql, params] = rdaUpdate()!;
    expect(sql).not.toMatch(/shift_template_id = \?/);
    expect(params).toEqual(["emp-u1", "keep", "rda-1"]);
  });
});

describe("resolveDispute — dispute bridge (shift change)", () => {
  const change = (over: Record<string, unknown> = {}) =>
    resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "moved", newShiftTemplateId: "t-new", canOwn: allow, ...over });

  it("runs the rest check for the NEW shift, excluding the live row", async () => {
    await change();
    expect(m.validateMinimumRest).toHaveBeenCalledWith(
      { employeeId: "e1", processId: "p1", branchId: "b1", forDate: "2026-10-05" },
      { startTime: "14:00", endTime: "23:00" },
      "wra-1",
    );
  });

  it("passes a null exclude id when there is no live row", async () => {
    liveRow = null;
    await change();
    expect(m.validateMinimumRest).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
  });

  it("409s on insufficient rest before any write", async () => {
    m.validateMinimumRest.mockResolvedValue({ ok: false, reason: "INSUFFICIENT_REST", actualRestMinutes: 300, requiredRestMinutes: 660, canOverride: false });
    await expect(change()).rejects.toMatchObject({ statusCode: 409, body: { error: expect.stringMatching(/insufficient rest/i) } });
    expect(writes()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(m.syncCycleToRta).not.toHaveBeenCalled();
  });

  it("409s when no rest policy is configured, like the swap path", async () => {
    m.validateMinimumRest.mockResolvedValue({ ok: false, reason: "REST_POLICY_MISSING", policy: null });
    await expect(change({ restOverrideReason: "emergency" })).rejects.toMatchObject({ statusCode: 409 });
    expect(writes()).toEqual([]);
  });

  it("allows an overridable rest shortfall with a reason and logs the override", async () => {
    m.validateMinimumRest.mockResolvedValue({
      ok: false, reason: "INSUFFICIENT_REST", actualRestMinutes: 600, requiredRestMinutes: 660, canOverride: true,
      against: "previous", neighborShift: { date: "2026-10-05", time: "04:00" }, policy: { id: "pol-1" },
    });
    const r = await change({ restOverrideReason: "emergency cover" });
    expect(m.logRestOverride).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "e1", rosterDate: "2026-10-05", source: "dispute_resolution", reason: "emergency cover",
      previousShiftEndAt: "2026-10-05 04:00:00", nextShiftStartAt: "2026-10-05 14:00:00", policyId: "pol-1", approvedBy: "u1",
    }));
    expect(r.restOverrideUsed).toBe(true);
    expect(rdaUpdate()).toBeDefined();
  });

  it("skips the rest check when the rest-policy feature is not active", async () => {
    m.isRestPolicyFeatureActive.mockResolvedValue(false);
    await change();
    expect(m.validateMinimumRest).not.toHaveBeenCalled();
    expect(rdaUpdate()).toBeDefined();
  });

  it("400s for an unknown shift template before any write", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT rda\.\*/.test(sql)) return [[row], []];
      return [[], []];
    });
    await expect(change()).rejects.toMatchObject({ statusCode: 400, body: { error: "Shift template not found" } });
    expect(writes()).toEqual([]);
  });

  it("409s on a payroll-locked date before any write", async () => {
    m.checkAssignmentDateNotLocked.mockResolvedValue({ blocked: true, error: "locked for payroll" });
    await expect(change()).rejects.toMatchObject({ statusCode: 409, body: { error: "locked for payroll" } });
    expect(m.checkAssignmentDateNotLocked).toHaveBeenCalledWith(expect.anything(), "wra-1");
    expect(writes()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("falls back to the employee/date lock check when there is no live row", async () => {
    liveRow = null;
    m.checkEmployeeDateNotLocked.mockResolvedValue({ blocked: true, error: "locked" });
    await expect(change()).rejects.toMatchObject({ statusCode: 409 });
    expect(m.checkEmployeeDateNotLocked).toHaveBeenCalledWith(expect.anything(), "e1", "2026-10-05");
    expect(writes()).toEqual([]);
  });

  it("mirrors the new shift into the live roster row", async () => {
    const r = await change();
    const [sql, params] = wraUpdate()!;
    expect(sql).toMatch(/SET shift_template_id = \?/);
    expect(sql).toMatch(/WHERE employee_id = \? AND roster_date = \?/);
    expect(params).toEqual(["t-new", "14:00:00", "23:00:00", "e1", "2026-10-05"]);
    expect(r).toMatchObject({ mirrored: true });
    expect(r.warnings).toEqual([]);
  });

  it("warns, and does not insert, when there is no live roster row", async () => {
    liveRow = null;
    const r = await change();
    expect(wraUpdate()).toBeUndefined();
    expect(execute.mock.calls.some(([sql]) => /INSERT INTO wfm_roster_assignment/.test(sql))).toBe(false);
    expect(r.mirrored).toBe(false);
    expect(r.warnings).toContain("no live roster row to mirror");
  });

  it("a failed mirror is non-fatal and reported as a warning", async () => {
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p?: unknown[]) => {
      if (/UPDATE wfm_roster_assignment/.test(sql)) throw new Error("boom");
      return base(sql, p);
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await change();
    err.mockRestore();
    expect(r.mirrored).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/mirror/i);
  });

  it("writes a ROSTER_DISPUTE_RESOLVED audit row", async () => {
    await change();
    expect(m.logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      actor_user_id: "u1", action_type: "ROSTER_DISPUTE_RESOLVED", module_key: "WFM",
      entity_type: "roster_daily_assignment", entity_id: "rda-1",
      change_summary: expect.objectContaining({ before_shift_template_id: "t-old", after_shift_template_id: "t-new", newShiftTemplateId: "t-new", mirrored: true }),
    }));
  });

  it("resyncs RTA for a published cycle", async () => {
    const r = await change();
    expect(m.syncCycleToRta).toHaveBeenCalledWith("c1", "manual_resync", "u1", undefined);
    expect(r.rtaResynced).toBe(true);
  });

  it("does not resync RTA for a cycle that was never published", async () => {
    cycleRow = { ...row, cycle_status: "draft" };
    const r = await change();
    expect(m.syncCycleToRta).not.toHaveBeenCalled();
    expect(r.rtaResynced).toBe(false);
  });

  it("an RTA resync failure does not fail the resolution", async () => {
    m.syncCycleToRta.mockRejectedValue(new Error("rta down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await change();
    err.mockRestore();
    expect(r.rtaResynced).toBe(false);
    expect(rdaUpdate()).toBeDefined();
    expect(notify).toHaveBeenCalled();
  });
});

describe("resolveDispute — acknowledgement only (no shift change)", () => {
  it("does no rest check, lock check, mirror or RTA resync, but still audits", async () => {
    const r = await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "ack", canOwn: allow });
    expect(m.validateMinimumRest).not.toHaveBeenCalled();
    expect(m.checkAssignmentDateNotLocked).not.toHaveBeenCalled();
    expect(m.checkEmployeeDateNotLocked).not.toHaveBeenCalled();
    expect(wraUpdate()).toBeUndefined();
    expect(m.syncCycleToRta).not.toHaveBeenCalled();
    expect(r).toMatchObject({ mirrored: false, rtaResynced: false, warnings: [] });
    expect(m.logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "ROSTER_DISPUTE_RESOLVED", change_summary: expect.objectContaining({ newShiftTemplateId: null, mirrored: false }),
    }));
  });

  it("an unchanged shift id counts as no shift change", async () => {
    await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "same", newShiftTemplateId: "t-old", canOwn: allow });
    expect(m.syncCycleToRta).not.toHaveBeenCalled();
  });

  it("stamps dispute_resolved_at with NOW() (IST session), not a UTC param", async () => {
    await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "ack", canOwn: allow });
    const [sql, params] = rdaUpdate()! as [string, unknown[]];
    expect(sql).toContain("dispute_resolved_at = NOW()");
    expect(params).toHaveLength(3);
    expect(params.some((p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:/.test(p))).toBe(false);
    expect(params[params.length - 1]).toBe("rda-1");
  });
});
