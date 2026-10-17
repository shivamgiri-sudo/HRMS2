import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner ruling 2026-10-17: an APR-judged day that COSEC would credit with more is NOT upgraded from
 * COSEC and NOT left silently — the reporting manager gets one pending decision per employee-date
 * and their choice is written onto the day (override + lock).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: vi.fn(async () => ({ roles: ["employee"] })),
  buildEmployeeScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] as unknown[] })),
  canViewEmployee: vi.fn(async () => true),
}));
const { createItem, resolveItems } = vi.hoisted(() => ({
  createItem: vi.fn(async () => undefined),
  resolveItems: vi.fn(async () => 0),
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem, resolveItems } }));

const engineMock = vi.hoisted(() => ({
  getBiometricEvidence: vi.fn(),
  getExceptionBucketMap: vi.fn(async () => new Map()),
}));
vi.mock("../attendance-engine.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../attendance-engine.service.js")>();
  return {
    ...original,
    resolveHalfDayFloorMinutes: vi.fn(async () => 270),
    attendanceEngineService: { ...original.attendanceEngineService, ...engineMock },
  };
});

let actor: { id: string; role: string; roles: string[]; isReadOnly?: boolean };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import {
  APR_COSEC_INBOX_ENTITY,
  APR_COSEC_ROLE,
  applyManagerDecision,
  cosecBeatsApr,
  raiseAprCosecDecision,
  raiseDecisionsForBulkRows,
} from "../apr-cosec-manager-decision.service.js";
import { mismatchReviewRouter } from "../mismatch-review.routes.js";
import { attendanceEngineService } from "../attendance-engine.service.js";

type Stub = {
  prior?: Record<string, unknown> | null;
  manager?: Record<string, unknown> | null;
  insertAffected?: number;
  pending?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
  closedMonth?: boolean;
  updateAffected?: number;
};

const calls: Array<{ sql: string; params: unknown[] }> = [];

function stubDb(s: Stub) {
  calls.length = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const q = sql.replace(/\s+/g, " ");
    if (q.startsWith("SELECT escalated_by_role, status FROM attendance_mismatch_escalation")) return [s.prior ? [s.prior] : []];
    if (q.includes("JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)")) return [s.manager ? [s.manager] : []];
    if (q.startsWith("SELECT employee_code, CONCAT")) return [[{ employee_code: "MAS57521", name: "Test Agent" }]];
    if (q.includes("FROM biometric_attendance_log")) return [[{ first_in: "2026-10-20 22:11", last_out: "2026-10-21 07:21" }]];
    if (q.startsWith("INSERT INTO attendance_mismatch_escalation")) return [{ affectedRows: s.insertAffected ?? 1 }];
    if (q.includes("FROM attendance_mismatch_escalation WHERE adr_id = ? AND escalated_by_role = ? AND status = 'pending'")) return [s.pending ? [s.pending] : []];
    if (q.includes("FROM attendance_daily_record WHERE id = ? LIMIT 1") && q.includes("source_system")) return [s.record ? [s.record] : []];
    if (q.includes("FROM salary_prep_run")) return [s.closedMonth ? [{ 1: 1 }] : []];
    if (q.startsWith("UPDATE attendance_daily_record")) return [{ affectedRows: s.updateAffected ?? 1 }];
    if (q.startsWith("SELECT id FROM attendance_daily_record")) return [[{ id: "adr-1" }]];
    if (q.startsWith("UPDATE attendance_mismatch_escalation")) return [{ affectedRows: 1 }];
    return [[]];
  });
}

const sqlOf = (prefix: string) => calls.filter((c) => c.sql.replace(/\s+/g, " ").trim().startsWith(prefix));

const raiseInput = {
  adrId: "adr-1",
  employeeId: "emp-1",
  recordDate: "2026-10-20",
  currentStatus: "absent",
  aprMinutes: 4,
  biometricMinutes: 551,
  biometricStatus: "present",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cosecBeatsApr", () => {
  it("is true only when COSEC ranks above the APR status and has minutes", () => {
    expect(cosecBeatsApr("absent", "present", 551)).toBe(true);
    expect(cosecBeatsApr("absent", "half_day", 300)).toBe(true);
    expect(cosecBeatsApr("half_day", "present", 600)).toBe(true);
    expect(cosecBeatsApr("present", "present", 600)).toBe(false);
    expect(cosecBeatsApr("half_day", "absent", 100)).toBe(false);
    expect(cosecBeatsApr("absent", "present", 0)).toBe(false);
    expect(cosecBeatsApr("leave_approved", "present", 600)).toBe(false);
  });
});

describe("raiseAprCosecDecision", () => {
  it("raises one pending decision for the reporting manager with both readings", async () => {
    stubDb({ manager: { id: "mgr-emp", user_id: "mgr-user", name: "Boss" } });
    await expect(raiseAprCosecDecision(raiseInput)).resolves.toBe("raised");

    const [ins] = sqlOf("INSERT INTO attendance_mismatch_escalation");
    expect(ins).toBeDefined();
    expect(ins!.sql).toMatch(/WHERE NOT EXISTS/);
    expect(ins!.params).toEqual(expect.arrayContaining(["adr-1", "emp-1", "2026-10-20", "system", APR_COSEC_ROLE, "mgr-emp", "mgr-user"]));
    const note = String(ins!.params[8]);
    expect(note).toContain("APR net login 0h 04m (4 min) = absent");
    expect(note).toContain("COSEC 9h 11m (551 min) = present");
    expect(note).toContain("first punch 2026-10-20 22:11");

    expect(createItem).toHaveBeenCalledTimes(1);
    const item = (createItem.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(item).toMatchObject({ user_id: "mgr-user", entity_type: APR_COSEC_INBOX_ENTITY, entity_id: "adr-1", type: "attendance_validation" });
    expect(String(item.title)).toContain("MAS57521");
  });

  it("is idempotent: an existing system decision for the day raises nothing", async () => {
    stubDb({ prior: { escalated_by_role: APR_COSEC_ROLE, status: "resolved" }, manager: { id: "m", user_id: "u", name: "B" } });
    await expect(raiseAprCosecDecision(raiseInput)).resolves.toBe("exists");
    expect(sqlOf("INSERT INTO attendance_mismatch_escalation")).toHaveLength(0);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("does not stack on a WFM escalation that is still open", async () => {
    stubDb({ prior: { escalated_by_role: "wfm", status: "pending" } });
    await expect(raiseAprCosecDecision(raiseInput)).resolves.toBe("already_escalated");
  });

  it("returns no_manager when the employee has no reporting manager with a login", async () => {
    stubDb({ manager: null });
    await expect(raiseAprCosecDecision(raiseInput)).resolves.toBe("no_manager");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("raises nothing when COSEC does not beat APR", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    await expect(raiseAprCosecDecision({ ...raiseInput, currentStatus: "present" })).resolves.toBe("not_needed");
    expect(calls).toHaveLength(0);
  });

  it("never throws — a DB fault is reported as unavailable", async () => {
    execute.mockRejectedValue(new Error("boom"));
    await expect(raiseAprCosecDecision(raiseInput)).resolves.toBe("unavailable");
  });
});

describe("applyManagerDecision", () => {
  const record = {
    id: "adr-1", employee_id: "emp-1", record_date: "2026-10-20", attendance_status: "absent", lwp_value: 1,
    is_locked: 1, override_by: null, regularization_id: null, source_system: "apr_bulk",
  };

  it("writes the manager's status as a locked override and closes the decision", async () => {
    stubDb({ pending: { id: "esc-1" }, record });
    const out = await applyManagerDecision({ adrId: "adr-1", actorUserId: "mgr-user", actorRole: "employee", status: "present", note: "was on floor" });
    expect(out).toMatchObject({ status: "present", lwpValue: 0 });

    const [upd] = sqlOf("UPDATE attendance_daily_record");
    expect(upd!.sql).toMatch(/is_locked\s*= 1/);
    expect(upd!.sql).toMatch(/source_system = 'apr_bulk' AND override_by IS NULL AND regularization_id IS NULL/);
    expect(upd!.params.slice(0, 3)).toEqual(["present", 0, "mgr-user"]);
    const [esc] = sqlOf("UPDATE attendance_mismatch_escalation");
    expect(esc!.params).toEqual(["present", "was on floor", "esc-1"]);
    expect(resolveItems).toHaveBeenCalledWith({ entity_type: APR_COSEC_INBOX_ENTITY, entity_id: "adr-1" });
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "ATTENDANCE_APR_COSEC_MANAGER_DECISION" }));
  });

  it("half day carries lwp 0.5 and absent 1.0", async () => {
    stubDb({ pending: { id: "esc-1" }, record });
    await expect(applyManagerDecision({ adrId: "adr-1", actorUserId: "u", actorRole: "employee", status: "half_day" })).resolves.toMatchObject({ lwpValue: 0.5 });
    stubDb({ pending: { id: "esc-1" }, record });
    await expect(applyManagerDecision({ adrId: "adr-1", actorUserId: "u", actorRole: "employee", status: "absent" })).resolves.toMatchObject({ lwpValue: 1 });
  });

  it("rejects a status outside present / half day / absent", async () => {
    stubDb({ pending: { id: "esc-1" }, record });
    await expect(applyManagerDecision({ adrId: "adr-1", actorUserId: "u", actorRole: "employee", status: "holiday" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses anyone the decision is not assigned to", async () => {
    stubDb({ pending: null, record });
    await expect(applyManagerDecision({ adrId: "adr-1", actorUserId: "other", actorRole: "employee", status: "present" })).rejects.toMatchObject({ status: 403 });
    expect(sqlOf("UPDATE attendance_daily_record")).toHaveLength(0);
  });

  it("refuses a day already corrected / frozen for payroll", async () => {
    stubDb({ pending: { id: "esc-1" }, record: { ...record, override_by: "payroll-user" } });
    await expect(applyManagerDecision({ adrId: "adr-1", actorUserId: "u", actorRole: "employee", status: "present" })).rejects.toMatchObject({ status: 409 });
    expect(sqlOf("UPDATE attendance_daily_record")).toHaveLength(0);
  });

  it("refuses a month whose payroll is finalized", async () => {
    stubDb({ pending: { id: "esc-1" }, record, closedMonth: true });
    await expect(applyManagerDecision({ adrId: "adr-1", actorUserId: "u", actorRole: "employee", status: "present" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("POST /api/wfm/mismatches/:id/manager-decision", () => {
  function app(role: string) {
    actor = { id: "mgr-user", role, roles: [role] };
    const a = express();
    a.use(express.json());
    a.use("/api/wfm/mismatches", mismatchReviewRouter);
    return a;
  }

  it("lets a reporting manager with only the employee role decide their assigned day", async () => {
    stubDb({
      pending: { id: "esc-1" },
      record: { id: "adr-1", employee_id: "emp-1", record_date: "2026-10-20", attendance_status: "absent", lwp_value: 1, is_locked: 0, override_by: null, regularization_id: null, source_system: "apr.ReportDate" },
    });
    const res = await request(app("employee")).post("/api/wfm/mismatches/adr-1/manager-decision").send({ status: "present" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ decided: true, status: "present" });
  });

  it("returns 403 when the caller has no pending decision on the day", async () => {
    stubDb({ pending: null });
    const res = await request(app("employee")).post("/api/wfm/mismatches/adr-1/manager-decision").send({ status: "present" });
    expect(res.status).toBe(403);
  });
});

describe("engine hook: raiseManagerDecisionIfNeeded", () => {
  const result: any = {
    employeeId: "emp-1", date: "2026-10-22", status: "absent", diallerMinutes: 123,
    biometricMinutes: 665, biometricStatus: "present", managerDecisionRequired: true,
  };

  it("raises only for a write that landed on an unlocked row", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    await attendanceEngineService.raiseManagerDecisionIfNeeded(result, { id: "adr-9", is_locked: 0, attendance_status: "absent" } as any);
    expect(sqlOf("INSERT INTO attendance_mismatch_escalation")).toHaveLength(1);

    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    await attendanceEngineService.raiseManagerDecisionIfNeeded(result, { id: "adr-9", is_locked: 1, attendance_status: "absent" } as any);
    await attendanceEngineService.raiseManagerDecisionIfNeeded({ ...result, managerDecisionRequired: false }, { id: "adr-9", is_locked: 0, attendance_status: "absent" } as any);
    await attendanceEngineService.raiseManagerDecisionIfNeeded(result, { id: "adr-9", is_locked: 0, attendance_status: "present" } as any);
    expect(calls).toHaveLength(0);
  });

  it("asks the question of an APR bulk-upload day when COSEC arrives after the upload", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    engineMock.getBiometricEvidence.mockResolvedValue({ minutes: 665, sourceSystem: "wfm_attendance_session", sourceReference: null });
    const bulkRow = { id: "adr-9", is_locked: 1, attendance_status: "absent", source_system: "apr_bulk", override_by: null, regularization_id: null, dialler_minutes: 123 };
    await attendanceEngineService.raiseManagerDecisionIfNeeded({ ...result, managerDecisionRequired: false }, bulkRow as any);
    expect(sqlOf("INSERT INTO attendance_mismatch_escalation")).toHaveLength(1);

    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    await attendanceEngineService.raiseManagerDecisionIfNeeded(result, { ...bulkRow, override_by: "wfm-user" } as any);
    await attendanceEngineService.raiseManagerDecisionIfNeeded(result, { ...bulkRow, attendance_status: "present" } as any);
    expect(calls).toHaveLength(0);
  });
});

describe("raiseDecisionsForBulkRows", () => {
  it("raises for an uploaded absent / half day that COSEC qualifies above, and skips the rest", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    engineMock.getBiometricEvidence.mockImplementation(async (_e: string, date: string) => ({
      minutes: date === "2026-10-22" ? 665 : date === "2026-10-23" ? 100 : 600,
      sourceSystem: "wfm_attendance_session", sourceReference: null,
    }));
    const counts = await raiseDecisionsForBulkRows([
      { employeeId: "emp-1", date: "2026-10-22", status: "absent", aprMinutes: 123 },   // COSEC present -> raise
      { employeeId: "emp-1", date: "2026-10-23", status: "absent", aprMinutes: 133 },   // COSEC 100 = absent -> no
      { employeeId: "emp-1", date: "2026-10-24", status: "present", aprMinutes: 500 },  // APR present -> not a candidate
    ]);
    expect(counts.raised).toBe(1);
    expect(counts.not_needed).toBe(1);
    expect(engineMock.getBiometricEvidence).toHaveBeenCalledTimes(2);
    const [upd] = sqlOf("UPDATE attendance_daily_record");
    expect(upd!.sql).toMatch(/mismatch_flag = 1/);
    expect(upd!.sql).not.toMatch(/attendance_status\s*=\s*\?,/);
    expect(upd!.params.slice(0, 3)).toEqual([665, "present", "absent"]);
  });
});

describe("rollout cutover — new days only (APR_COSEC_MANAGER_DECISION_FROM, default 2026-10-18)", () => {
  it("defaults to 2026-10-18 and accepts a valid env override, refusing a malformed one", async () => {
    const { aprCosecManagerDecisionFrom, managerDecisionApplies } = await import("../apr-cosec-cutover.js");
    const prev = process.env.APR_COSEC_MANAGER_DECISION_FROM;
    try {
      delete process.env.APR_COSEC_MANAGER_DECISION_FROM;
      expect(aprCosecManagerDecisionFrom()).toBe("2026-10-18");
      expect(managerDecisionApplies("2026-10-17")).toBe(false);
      expect(managerDecisionApplies("2026-10-18")).toBe(true);
      process.env.APR_COSEC_MANAGER_DECISION_FROM = "2026-11-01";
      expect(managerDecisionApplies("2026-10-25")).toBe(false);
      expect(managerDecisionApplies("2026-11-01")).toBe(true);
      process.env.APR_COSEC_MANAGER_DECISION_FROM = "1/11/2026";
      expect(aprCosecManagerDecisionFrom()).toBe("2026-10-18");
    } finally {
      if (prev === undefined) delete process.env.APR_COSEC_MANAGER_DECISION_FROM;
      else process.env.APR_COSEC_MANAGER_DECISION_FROM = prev;
    }
  });

  it("raises no manager item for a day before the cutover", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    await expect(raiseAprCosecDecision({ ...raiseInput, recordDate: "2026-10-05" })).resolves.toBe("not_needed");
    expect(calls).toHaveLength(0);
  });

  it("APR bulk upload: pre-cutover rows are not even read against COSEC", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    engineMock.getBiometricEvidence.mockResolvedValue({ minutes: 665, sourceSystem: "wfm_attendance_session", sourceReference: null });
    const counts = await raiseDecisionsForBulkRows([
      { employeeId: "emp-1", date: "2026-10-05", status: "absent", aprMinutes: 123 },
      { employeeId: "emp-1", date: "2026-10-17", status: "half_day", aprMinutes: 300 },
      { employeeId: "emp-1", date: "2026-10-18", status: "absent", aprMinutes: 10 },
    ]);
    expect(counts.raised).toBe(1);
    expect(engineMock.getBiometricEvidence).toHaveBeenCalledTimes(1);
    expect(engineMock.getBiometricEvidence).toHaveBeenCalledWith("emp-1", "2026-10-18");
  });

  it("engine hook: a pre-cutover bulk-locked day raises nothing", async () => {
    stubDb({ manager: { id: "m", user_id: "u", name: "B" } });
    const bulkRow = { id: "adr-9", is_locked: 1, attendance_status: "absent", source_system: "apr_bulk", override_by: null, regularization_id: null, dialler_minutes: 123 };
    await attendanceEngineService.raiseManagerDecisionIfNeeded(
      { employeeId: "emp-1", date: "2026-10-05", status: "absent", biometricMinutes: 665, biometricStatus: "present", managerDecisionRequired: false } as any,
      bulkRow as any,
    );
    expect(calls).toHaveLength(0);
  });
});
