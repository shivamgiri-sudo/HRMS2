import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Owner decision 2026-10-06: marking an exit "Exited" stamps employees.date_of_exit, which payroll,
 * salary days, F&F and the attendance window use as the end of employment. With no last working day
 * on record it used to stamp TODAY - the click date, not when the person stopped working. It must
 * refuse instead, and otherwise stamp exactly the last working day.
 */
const { dbExecute, connCommit, connRollback, connRelease, connBegin } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  connCommit: vi.fn(async () => undefined),
  connRollback: vi.fn(async () => undefined),
  connRelease: vi.fn(() => undefined),
  connBegin: vi.fn(async () => undefined),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: dbExecute,
    query: dbExecute,
    getConnection: vi.fn(async () => ({
      execute: dbExecute,
      query: dbExecute,
      beginTransaction: connBegin,
      commit: connCommit,
      rollback: connRollback,
      release: connRelease,
    })),
  },
}));

const { revokeSessionsForEmployee, deprovisionEmployeeAccess } = vi.hoisted(() => ({
  revokeSessionsForEmployee: vi.fn(async () => ({ refreshTokensRevoked: 0, deviceSessionsRevoked: 0 })),
  deprovisionEmployeeAccess: vi.fn(async () => ({ lmsMappingsRevoked: 0, leaveRequestsCancelled: 0, openAssetAssignments: 0, failures: [] })),
}));
vi.mock("../../../shared/sessionRevocation.js", () => ({ revokeSessionsForEmployee }));
vi.mock("../../../shared/employeeDeprovisioning.js", () => ({ deprovisionEmployeeAccess }));

vi.mock("../exit-intelligence.service.js", () => ({
  createDefaultClearanceTasks: vi.fn(async () => undefined),
  createExitHealthSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../exit.notifications.js", () => ({
  notifyResignationSubmitted: vi.fn(async () => undefined),
  notifyResignationDecision: vi.fn(async () => undefined),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }));


function mockDb(exitRow: Record<string, unknown>) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM exit_request er/.test(sql)) return [[exitRow], []];
    if (/SELECT status FROM exit_request WHERE id = \? FOR UPDATE/.test(sql)) return [[{ status: exitRow.status }], []];
    if (/UPDATE exit_request SET status/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/INSERT INTO exit_approval_log/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/UPDATE employees SET active_status = 0/.test(sql)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
}

const BASE = { id: "exit-1", employee_id: "emp-1", status: "admin_review", exit_type: "resignation", exit_sub_type: null };

beforeEach(() => { connCommit.mockClear(); connRollback.mockClear(); });

describe("updateExitStatus('exited') needs a real last working day", () => {
  it("refuses with 400 when no last working day was ever entered, and writes nothing", async () => {
    mockDb({ ...BASE, last_working_day_proposed: null, last_working_day_confirmed: null });
    const { exitService } = await import("../exit.service.js");
    await expect(exitService.updateExitStatus("exit-1", "exited", "done", "actor-1"))
      .rejects.toMatchObject({ statusCode: 400, code: "EXIT_LWD_REQUIRED" });
    const sqls = dbExecute.mock.calls.map(([s]: [string]) => String(s));
    expect(sqls.some((s) => /UPDATE employees SET active_status = 0/.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE exit_request SET status/.test(s))).toBe(false);
  });

  it("stamps the Exit Date with the confirmed last working day, not today", async () => {
    mockDb({ ...BASE, last_working_day_proposed: "2026-09-20", last_working_day_confirmed: "2026-09-14" });
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "exited", "done", "actor-1");
    const call = dbExecute.mock.calls.find(([s]: [string]) => /UPDATE employees SET active_status = 0/.test(String(s)));
    expect(call?.[1]).toContain("2026-09-14");
  });

  it("an LWD confirmed on the same action is accepted even when none was stored", async () => {
    mockDb({ ...BASE, last_working_day_proposed: null, last_working_day_confirmed: null });
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "exited", "done", "actor-1", undefined, { lastWorkingDayConfirmed: "2026-09-30" } as any);
    const call = dbExecute.mock.calls.find(([s]: [string]) => /UPDATE employees SET active_status = 0/.test(String(s)));
    expect(call?.[1]).toContain("2026-09-30");
  });
});
