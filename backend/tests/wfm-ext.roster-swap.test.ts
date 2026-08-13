import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Round 2 (2026-08-13): the shift-swap workflow previously only flipped
 * wfm_roster_swap_request.status — approving a swap never touched
 * wfm_roster_assignment at all, so nothing was actually swapped. These tests
 * pin the fixed behavior: counterpart acceptance is required before manager
 * approval can apply anything, the two assignment rows are genuinely
 * exchanged (the core claim under test), the whole apply is one transaction
 * (a failure after the row lock rolls back cleanly), and a second approval
 * call against an already-applied request is refused rather than re-running
 * the swap.
 */

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection },
  pingDb: vi.fn(),
}));
vi.mock("../src/shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn().mockResolvedValue(false),
  hasProcessScope: vi.fn().mockResolvedValue(true),
}));
vi.mock("../src/modules/roster/roster-lock-guard.js", () => ({
  checkEmployeeDateNotLocked: vi.fn().mockResolvedValue({ blocked: false }),
}));
vi.mock("../src/modules/wfm/shift-scheduling.util.js", () => ({
  rosterAssignmentColumns: vi.fn().mockResolvedValue(new Set(["shift_version_id", "scheduled_minutes"])),
}));
vi.mock("../src/modules/wfm/rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn().mockResolvedValue(false), // off by default; individual tests opt in
  validateMinimumRest: vi.fn(),
  logRestOverride: vi.fn().mockResolvedValue(undefined),
}));

import { rosterSwapService } from "../src/modules/wfm-extensions/wfm-ext.service.js";
import { getEmployeeForUser, hasRole } from "../src/shared/accessGuard.js";
import { checkEmployeeDateNotLocked } from "../src/modules/roster/roster-lock-guard.js";
import { isRestPolicyFeatureActive, validateMinimumRest } from "../src/modules/wfm/rest-policy.service.js";

const mockGetEmployeeForUser = getEmployeeForUser as ReturnType<typeof vi.fn>;
const mockHasRole = hasRole as ReturnType<typeof vi.fn>;
const mockLockCheck = checkEmployeeDateNotLocked as ReturnType<typeof vi.fn>;
const mockRestActive = isRestPolicyFeatureActive as ReturnType<typeof vi.fn>;
const mockValidateRest = validateMinimumRest as ReturnType<typeof vi.fn>;

const SWAP_ID = "swap-1";
const REQUESTER = "emp-req";
const TARGET = "emp-tgt";
const SWAP_DATE = "2026-05-20";

const REQ_ASSIGNMENT = {
  id: "assign-req", employee_id: REQUESTER, roster_date: SWAP_DATE, is_week_off: 0,
  shift_id: "shift-morning", shift_version_id: "shift-morning-v1",
  shift_start_time: "06:00:00", shift_end_time: "14:00:00", scheduled_minutes: 480,
};
const TGT_ASSIGNMENT = {
  id: "assign-tgt", employee_id: TARGET, roster_date: SWAP_DATE, is_week_off: 0,
  shift_id: "shift-evening", shift_version_id: "shift-evening-v1",
  shift_start_time: "14:00:00", shift_end_time: "22:00:00", scheduled_minutes: 480,
};

function makeConn(swapRow: Record<string, unknown>) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const conn = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      const text = String(sql);
      if (/SELECT \* FROM wfm_roster_swap_request WHERE id = \? FOR UPDATE/i.test(text)) return [[swapRow], []];
      if (/FROM employees WHERE id = \?/i.test(text)) return [[{ process_id: "proc-1" }], []];
      if (/FROM wfm_roster_assignment WHERE employee_id = \? AND roster_date = \?/i.test(text)) {
        const empId = params[0];
        if (empId === REQUESTER) return [[REQ_ASSIGNMENT], []];
        if (empId === TARGET) return [[TGT_ASSIGNMENT], []];
        return [[], []];
      }
      if (/UPDATE wfm_roster_assignment SET/i.test(text)) return [{ affectedRows: 1 }, []];
      if (/UPDATE wfm_roster_swap_request SET/i.test(text)) return [{ affectedRows: 1 }, []];
      return [[], []];
    }),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
  return { conn, executed };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasRole.mockResolvedValue(false);
  mockLockCheck.mockResolvedValue({ blocked: false });
  mockRestActive.mockResolvedValue(false);
});

describe("rosterSwapService.respond — counterpart acceptance step", () => {
  it("rejects a response from anyone other than the swap_with_emp_id employee", async () => {
    mockGetEmployeeForUser.mockResolvedValue({ id: "someone-else" });
    (await import("../src/db/mysql.js")).db.execute = vi.fn().mockResolvedValue([[{ id: SWAP_ID, status: "pending", swap_with_emp_id: TARGET, counterpart_status: "pending" }], []]);
    await expect(rosterSwapService.respond(SWAP_ID, "accepted", "user-x")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("accepts and records counterpart_status when the real counterpart responds", async () => {
    mockGetEmployeeForUser.mockResolvedValue({ id: TARGET });
    const dbMock = (await import("../src/db/mysql.js")).db;
    let updateCalled = false;
    dbMock.execute = vi.fn(async (sql: string) => {
      if (/UPDATE wfm_roster_swap_request SET counterpart_status/i.test(sql)) { updateCalled = true; return [{ affectedRows: 1 }, []]; }
      return [[{ id: SWAP_ID, status: "pending", swap_with_emp_id: TARGET, counterpart_status: "pending" }], []];
    });
    await rosterSwapService.respond(SWAP_ID, "accepted", "user-target");
    expect(updateCalled).toBe(true);
  });

  it("rejects responding twice", async () => {
    mockGetEmployeeForUser.mockResolvedValue({ id: TARGET });
    (await import("../src/db/mysql.js")).db.execute = vi.fn().mockResolvedValue([[{ id: SWAP_ID, status: "pending", swap_with_emp_id: TARGET, counterpart_status: "accepted" }], []]);
    await expect(rosterSwapService.respond(SWAP_ID, "accepted", "user-target")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("rosterSwapService.applyApprovedSwap — the actual roster mutation", () => {
  it("blocks approval when the counterpart has not accepted yet", async () => {
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "pending", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("a privileged caller CAN force-apply without counterpart acceptance", async () => {
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "pending", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    const result = await rosterSwapService.applyApprovedSwap(SWAP_ID, "admin-1", undefined, { forceWithoutCounterpartAcceptance: true });
    expect(result.applied).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("actually exchanges the two assignments' shift_id/times/shift_version_id — the core fix", async () => {
    const { conn, executed } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    const result = await rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1");
    expect(result).toMatchObject({ status: "approved", applied: true });

    const updates = executed.filter((e) => /UPDATE wfm_roster_assignment SET/i.test(e.sql));
    expect(updates).toHaveLength(2);
    // Requester's row (assign-req) must receive the TARGET's shift data, and vice versa.
    const reqUpdate = updates.find((u) => u.params[u.params.length - 1] === "assign-req");
    const tgtUpdate = updates.find((u) => u.params[u.params.length - 1] === "assign-tgt");
    expect(reqUpdate?.params).toContain("shift-evening"); // requester now has target's shift_id
    expect(reqUpdate?.params).toContain("shift-evening-v1"); // and its pinned version
    expect(tgtUpdate?.params).toContain("shift-morning");
    expect(tgtUpdate?.params).toContain("shift-morning-v1");
  });

  it("blocks when either employee has no assignment on the swap date", async () => {
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: "no-assignment-emp", swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("blocks swapping a week-off day — nothing to exchange", async () => {
    const weekOffReq = { ...REQ_ASSIGNMENT, is_week_off: 1 };
    const conn = {
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = String(sql);
        if (/FOR UPDATE/i.test(text)) return [[{ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE }], []];
        if (/FROM employees WHERE id = \?/i.test(text)) return [[{ process_id: "proc-1" }], []];
        if (/FROM wfm_roster_assignment WHERE employee_id = \? AND roster_date = \?/i.test(text)) {
          return params[0] === REQUESTER ? [[weekOffReq], []] : [[TGT_ASSIGNMENT], []];
        }
        return [[], []];
      }),
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    };
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("blocks when the roster date is attendance/payroll-locked", async () => {
    mockLockCheck.mockResolvedValue({ blocked: true, error: "locked" });
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("blocks on insufficient rest with no override reason supplied", async () => {
    mockRestActive.mockResolvedValue(true);
    mockValidateRest.mockResolvedValue({ ok: false, reason: "INSUFFICIENT_REST", canOverride: true, actualRestMinutes: 30, requiredRestMinutes: 480, against: "previous" });
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("applies with an emergency override when the policy allows it and a reason is given", async () => {
    mockRestActive.mockResolvedValue(true);
    mockValidateRest.mockResolvedValue({
      ok: false, reason: "INSUFFICIENT_REST", canOverride: true, actualRestMinutes: 30, requiredRestMinutes: 480,
      against: "previous", neighborShift: { date: SWAP_DATE, time: "05:00" }, policy: { id: "policy-1" },
    });
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    const result = await rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1", undefined, { restOverrideReason: "emergency coverage" });
    expect(result.applied).toBe(true);
    expect(result.restOverrideUsed).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("refuses a second approval against an already-approved request — idempotency guard", async () => {
    const { conn } = makeConn({ id: SWAP_ID, status: "approved", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("blocks cross-process swaps for a non-privileged approver", async () => {
    const conn = {
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = String(sql);
        if (/FOR UPDATE/i.test(text)) return [[{ id: SWAP_ID, status: "pending", counterpart_status: "accepted", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE }], []];
        if (/FROM employees WHERE id = \?/i.test(text)) {
          return params[0] === REQUESTER ? [[{ process_id: "proc-A" }], []] : [[{ process_id: "proc-B" }], []];
        }
        return [[], []];
      }),
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    };
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("always releases the connection, even when a guard throws", async () => {
    const { conn } = makeConn({ id: SWAP_ID, status: "pending", counterpart_status: "pending", requester_emp_id: REQUESTER, swap_with_emp_id: TARGET, swap_date: SWAP_DATE });
    getConnection.mockResolvedValue(conn);
    await expect(rosterSwapService.applyApprovedSwap(SWAP_ID, "manager-1")).rejects.toBeDefined();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe("rosterSwapService.review — rejection path idempotency", () => {
  it("rejects cleanly and is idempotent against a second call", async () => {
    const dbMock = (await import("../src/db/mysql.js")).db;
    let calls = 0;
    dbMock.execute = vi.fn(async (sql: string) => {
      if (/UPDATE wfm_roster_swap_request SET status = 'rejected'/i.test(sql)) {
        calls++;
        return [{ affectedRows: calls === 1 ? 1 : 0 }, []];
      }
      return [[], []];
    });
    const first = await rosterSwapService.review(SWAP_ID, "rejected", "manager-1");
    expect(first.status).toBe("rejected");
    await expect(rosterSwapService.review(SWAP_ID, "rejected", "manager-1")).rejects.toMatchObject({ statusCode: 409 });
  });
});
