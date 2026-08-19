import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Contract test for the cost_centre transfer type.
 *
 * Verifies:
 * - createTransfer() validates cost_centre and new_reporting_manager_id
 * - updateTransfer() applies cost_centre_id and reporting_manager_id on approval
 * - updateTransfer() writes to employee_job_history with correct from/to values
 * - createTransfer() rejects an unknown cost_centre to_value
 */

const { execute, connExecute, getConnection } = vi.hoisted(() => {
  const connExecute = vi.fn();
  return {
    execute: vi.fn(),
    connExecute,
    getConnection: vi.fn(async () => ({
      execute: connExecute,
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(() => undefined),
    })),
  };
});

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const { mobilityService } = await import("../mobility.service.js");

// ── Test constants ────────────────────────────────────────────────────────────

const EMPLOYEE_ID = "emp-cc-test";
const CC_FROM_ID  = "cc-from-uuid";
const CC_TO_ID    = "cc-to-uuid";
const MANAGER_ID  = "mgr-uuid";
const OLD_MGR_ID  = "old-mgr-uuid";
const APPROVER_ID = "approver-uuid";
const TRANSFER_ID = "tr-cc-test";
const TODAY = new Date().toISOString().slice(0, 10);

function ccTransferRow(over: Record<string, unknown> = {}) {
  return {
    id: TRANSFER_ID,
    employee_id: EMPLOYEE_ID,
    transfer_type: "cost_centre",
    from_value: CC_FROM_ID,
    to_value: CC_TO_ID,
    effective_date: TODAY,
    status: "pending",
    applied_at: null,
    new_reporting_manager_id: MANAGER_ID,
    reason: "Project reassignment",
    ...over,
  };
}

const EMP_SNAP = {
  branch_id: "br-1",
  department_id: "dept-1",
  process_id: "proc-1",
  reporting_manager_id: OLD_MGR_ID,
};

/**
 * Wire the transaction connection mock for an updateTransfer() call.
 *
 * connExecute matches SQL patterns in the order they appear in the approval flow:
 * 1. SELECT * FROM transfer_record FOR UPDATE
 * 2. UPDATE transfer_record SET status
 * 3. UPDATE transfer_record SET applied_at (claim)
 * 4. SELECT id FROM cost_centre_master (applyTransferOn resolver)
 * 5. UPDATE employees SET cost_centre_id
 * 6. SELECT branch_id, department_id, process_id, reporting_manager_id (empSnap)
 * 7. UPDATE employees SET reporting_manager_id
 * 8. INSERT INTO employee_job_history
 * 9. INSERT INTO employee_journey_log
 */
function wireConn(
  row: Record<string, unknown> | null,
  opts: {
    statusAffectedRows?: number;
    claimAffectedRows?: number;
  } = {}
) {
  const commit   = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const release  = vi.fn(() => undefined);

  connExecute.mockReset();
  connExecute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/SELECT \* FROM transfer_record WHERE id = \? FOR UPDATE/.test(s))
      return [row ? [row] : [], []];
    if (/UPDATE transfer_record SET status/.test(s))
      return [{ affectedRows: opts.statusAffectedRows ?? 1 }, []];
    if (/UPDATE transfer_record SET applied_at = NOW\(\) WHERE id = \? AND applied_at IS NULL/.test(s))
      return [{ affectedRows: opts.claimAffectedRows ?? 1 }, []];
    if (/cost_centre_master WHERE id = \?/.test(s))
      return [[{ id: CC_TO_ID }], []];
    if (/UPDATE employees SET cost_centre_id/.test(s))
      return [{ affectedRows: 1 }, []];
    if (/SELECT branch_id, department_id, process_id, reporting_manager_id/.test(s))
      return [[EMP_SNAP], []];
    if (/UPDATE employees SET reporting_manager_id/.test(s))
      return [{ affectedRows: 1 }, []];
    if (/INSERT INTO employee_job_history/.test(s))
      return [{ affectedRows: 1 }, []];
    if (/INSERT INTO employee_journey_log/.test(s))
      return [{ affectedRows: 1 }, []];
    return [[], []];
  });

  getConnection.mockReset();
  getConnection.mockResolvedValue({
    execute: connExecute,
    beginTransaction: vi.fn(async () => undefined),
    commit,
    rollback,
    release,
  } as never);

  // Post-commit re-fetch
  execute.mockReset();
  execute.mockImplementation(async () => [[{ ...ccTransferRow(), status: "completed" }], []]);

  return { commit, rollback, release };
}

const connSqlIssued = () => connExecute.mock.calls.map(([s]: [string]) => String(s));

beforeEach(() => {
  logSensitiveAction.mockReset();
  execute.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Cost Centre Transfer", () => {
  it("creates a cost_centre transfer with new_reporting_manager_id", async () => {
    // SELECT cost_centre_master → found
    execute.mockResolvedValueOnce([[{ id: CC_TO_ID }], []]);
    // SELECT employees for manager → found
    execute.mockResolvedValueOnce([[{ id: MANAGER_ID }], []]);
    // INSERT transfer_record
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    // SELECT back the created row
    execute.mockResolvedValueOnce([[{
      id: TRANSFER_ID,
      transfer_type: "cost_centre",
      new_reporting_manager_id: MANAGER_ID,
      status: "pending",
    }], []]);

    const transfer = await mobilityService.createTransfer({
      employee_id: EMPLOYEE_ID,
      transfer_type: "cost_centre",
      from_value: CC_FROM_ID,
      to_value: CC_TO_ID,
      effective_date: TODAY,
      reason: "Project reassignment",
      initiated_by: APPROVER_ID,
      new_reporting_manager_id: MANAGER_ID,
    });

    expect(transfer.transfer_type).toBe("cost_centre");
    expect(transfer.new_reporting_manager_id).toBe(MANAGER_ID);
  });

  it("updates employee cost_centre_id and reporting_manager_id on approval", async () => {
    const { commit, rollback } = wireConn(ccTransferRow());

    const approved = await mobilityService.updateTransfer(TRANSFER_ID, {
      action: "approved",
      approved_by: APPROVER_ID,
    });

    expect(approved.status).toBe("completed");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    const issued = connSqlIssued();
    expect(issued.some((s) => /UPDATE employees SET cost_centre_id/.test(s))).toBe(true);
    expect(issued.some((s) => /UPDATE employees SET reporting_manager_id/.test(s))).toBe(true);
  });

  it("writes to employee_job_history on cost_centre transfer approval", async () => {
    wireConn(ccTransferRow());

    await mobilityService.updateTransfer(TRANSFER_ID, {
      action: "approved",
      approved_by: APPROVER_ID,
    });

    const jobHistoryCall = connExecute.mock.calls.find(
      ([s]: [string]) => /INSERT INTO employee_job_history/.test(String(s))
    );
    expect(jobHistoryCall).toBeDefined();

    // Params layout (16 entries — 'cost_centre_change' is literal in SQL):
    // [0]=id  [1]=employee_id  [2]=effective_date
    // [3]=from_cost_centre_id  [4]=to_cost_centre_id
    // [5]=from_manager_id  [6]=to_manager_id
    // ...
    const args = jobHistoryCall![1] as unknown[];
    expect(args[1]).toBe(EMPLOYEE_ID);   // employee_id
    expect(args[3]).toBe(CC_FROM_ID);    // from_cost_centre_id (from_value on record)
    expect(args[4]).toBe(CC_TO_ID);      // to_cost_centre_id (to_value on record)
    expect(args[5]).toBe(OLD_MGR_ID);    // from_manager_id (old — empSnap before cascade)
    expect(args[6]).toBe(MANAGER_ID);    // to_manager_id (new)
  });

  it("rejects transfer with invalid cost_centre to_value", async () => {
    // SELECT cost_centre_master → not found
    execute.mockResolvedValueOnce([[], []]);

    await expect(
      mobilityService.createTransfer({
        employee_id: EMPLOYEE_ID,
        transfer_type: "cost_centre",
        from_value: CC_FROM_ID,
        to_value: "00000000-0000-0000-0000-000000000000",
        effective_date: TODAY,
        initiated_by: APPROVER_ID,
        new_reporting_manager_id: MANAGER_ID,
      })
    ).rejects.toThrow(/not found in cost_centre_master/);
  });
});
